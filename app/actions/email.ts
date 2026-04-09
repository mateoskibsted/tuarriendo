'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { google } from 'googleapis'
import { revalidatePath } from 'next/cache'
import { extractTextFromPayload, decodeBase64Url } from '@/lib/utils/email-parser'
import { getUFValue } from '@/lib/utils/uf'
import type { PagoSugerido } from '@/lib/types'

async function getAuthContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { user, admin: createAdminClient() }
}

function buildOAuthClient(connection: {
  access_token: string
  refresh_token?: string | null
  expires_at?: string | null
}) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    // redirect_uri only used during token exchange, not scanning
    'https://tuarriendo-ten.vercel.app/api/auth/gmail/callback'
  )
  oauth2Client.setCredentials({
    access_token: connection.access_token,
    refresh_token: connection.refresh_token ?? undefined,
    expiry_date: connection.expires_at
      ? new Date(connection.expires_at).getTime()
      : undefined,
  })
  return oauth2Client
}

/** Normalize text: lowercase, remove accents and punctuation */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Extract all CLP amounts from email content (e.g. $1.500.000 → 1500000) */
function extractAmounts(content: string): number[] {
  const matches = [...content.matchAll(/\$\s*([\d]{1,3}(?:[.,][\d]{3})*)/g)]
  return matches
    .map(m => parseInt(m[1].replace(/[.,]/g, ''), 10))
    .filter(n => !isNaN(n) && n > 0)
}

/** Check if tenant name appears in email content.
 *  Requires at least the first 2 significant words (nombre + primer apellido). */
function nameMatchesContent(tenantName: string, content: string): boolean {
  const contentNorm = normalizeText(content)
  const words = normalizeText(tenantName).split(' ').filter(w => w.length >= 3)
  if (words.length === 0) return false
  // Require the first 2 words minimum (or all if there are fewer than 2)
  const required = words.slice(0, 2)
  return required.every(word => contentNorm.includes(word))
}

/** Rule-based matching: name + amount must both match */
function matchEmails(
  emails: Array<{ idx: number; rawContent: string }>,
  tenants: Array<{
    idx: number
    contratoId?: string
    propiedadId?: string
    nombre: string
    monto_clp: number
  }>
): Array<{ emailIdx: number; tenantIdx: number; confianza: 'alta' | 'media'; monto_clp: number }> {
  const results: Array<{ emailIdx: number; tenantIdx: number; confianza: 'alta' | 'media'; monto_clp: number }> = []

  for (const email of emails) {
    const amounts = extractAmounts(email.rawContent)

    for (const tenant of tenants) {
      const nameMatch = nameMatchesContent(tenant.nombre, email.rawContent)
      if (!nameMatch) continue

      // Find an amount that matches within ±15%
      const expected = tenant.monto_clp
      const matchedAmount = amounts.find(a => {
        if (expected === 0) return false
        return Math.abs(a - expected) / expected <= 0.15
      })

      if (matchedAmount === undefined) continue

      const confianza: 'alta' | 'media' = Math.abs(matchedAmount - expected) / expected <= 0.05
        ? 'alta'
        : 'media'

      results.push({ emailIdx: email.idx, tenantIdx: tenant.idx, confianza, monto_clp: matchedAmount })
    }
  }

  return results
}

/** Recursively find the first text/html part in a Gmail payload */
function findHtmlPart(payload: {
  mimeType?: string | null
  body?: { data?: string | null } | null
  parts?: unknown[]
} | null | undefined): string | null {
  if (!payload) return null
  if (payload.mimeType === 'text/html' && payload.body?.data) return payload.body.data
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findHtmlPart(part as Parameters<typeof findHtmlPart>[0])
      if (found) return found
    }
  }
  return null
}

export async function desconectarEmail() {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const { error } = await admin
    .from('email_connections')
    .delete()
    .eq('arrendador_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/arrendador/email')
  return { success: true }
}

export async function escanearEmails(): Promise<{ error?: string; sugerencias?: PagoSugerido[] }> {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const { data: connection } = await admin
    .from('email_connections')
    .select('*')
    .eq('arrendador_id', user.id)
    .single()

  if (!connection) return { error: 'No hay correo conectado' }

  // Load active properties
  const { data: propiedades } = await admin
    .from('propiedades')
    .select('id, valor_uf, moneda')
    .eq('arrendador_id', user.id)
    .eq('activa', true)

  const propiedadIds = (propiedades ?? []).map((p: { id: string }) => p.id)
  if (propiedadIds.length === 0) return { sugerencias: [] }

  // Load active formal contracts with tenant info
  const { data: contratos } = await admin
    .from('contratos')
    .select('id, propiedad_id, propiedades(nombre, valor_uf, moneda), profiles!contratos_arrendatario_id_fkey(nombre, rut)')
    .in('propiedad_id', propiedadIds)
    .eq('activo', true)

  // Load propiedades with informal arrendatarios
  const { data: propiedadesInformales } = await admin
    .from('propiedades')
    .select('id, nombre, valor_uf, moneda, arrendatario_informal_nombre, arrendatario_informal_rut')
    .in('id', propiedadIds)
    .eq('activa', true)
    .not('arrendatario_informal_nombre', 'is', null)

  // Build tenant list for AI (formal + informal)
  const tenants: Array<{
    idx: number
    contratoId?: string
    propiedadId?: string
    nombre: string
    rut: string
    propiedadNombre: string
    monto: number
    moneda: string
  }> = []

  let idx = 1
  for (const c of contratos ?? []) {
    const profile = (c as unknown as { profiles?: { nombre: string; rut: string } }).profiles
    const propiedad = (c as unknown as { propiedades?: { nombre: string; valor_uf: number; moneda: string } }).propiedades
    if (!profile?.nombre) continue
    tenants.push({
      idx: idx++,
      contratoId: c.id,
      nombre: profile.nombre,
      rut: profile.rut ?? '',
      propiedadNombre: propiedad?.nombre ?? '',
      monto: propiedad?.valor_uf ?? 0,
      moneda: propiedad?.moneda ?? 'UF',
    })
  }

  for (const p of propiedadesInformales ?? []) {
    if (!p.arrendatario_informal_nombre) continue
    tenants.push({
      idx: idx++,
      propiedadId: p.id,
      nombre: p.arrendatario_informal_nombre,
      rut: p.arrendatario_informal_rut ?? '',
      propiedadNombre: p.nombre,
      monto: p.valor_uf ?? 0,
      moneda: p.moneda ?? 'UF',
    })
  }

  if (tenants.length === 0) return { sugerencias: [] }

  // Exclude tenants that already have a confirmed payment this month
  const periodoActual = new Date().toISOString().slice(0, 7)
  const { data: pagosYaRegistrados } = await admin
    .from('pagos')
    .select('contrato_id, propiedad_id')
    .eq('periodo', periodoActual)
    .eq('estado', 'pagado')

  const contratosPagados = new Set((pagosYaRegistrados ?? []).map((p: { contrato_id: string | null }) => p.contrato_id).filter(Boolean))
  const propiedadesPagadas = new Set((pagosYaRegistrados ?? []).map((p: { propiedad_id: string | null }) => p.propiedad_id).filter(Boolean))

  const tenantsSinPagar = tenants.filter(t =>
    !(t.contratoId && contratosPagados.has(t.contratoId)) &&
    !(t.propiedadId && propiedadesPagadas.has(t.propiedadId))
  )

  if (tenantsSinPagar.length === 0) return { sugerencias: [] }

  // Get current UF value for CLP conversion
  const ufValue = await getUFValue()

  // Convert all tenant amounts to CLP
  const tenantsConCLP = tenantsSinPagar.map(t => ({
    ...t,
    monto_clp: t.moneda === 'UF' ? Math.round(t.monto * ufValue) : t.monto,
    monto_original: t.monto,
  }))

  // Connect to Gmail
  const oauth2Client = buildOAuthClient(connection)
  oauth2Client.on('tokens', async (newTokens) => {
    if (newTokens.access_token) {
      await admin.from('email_connections').update({
        access_token: newTokens.access_token,
        expires_at: newTokens.expiry_date
          ? new Date(newTokens.expiry_date).toISOString()
          : undefined,
      }).eq('arrendador_id', user.id)
    }
  })

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  // Search for bank transfer emails in the last 30 days
  const query = 'subject:(transferencia OR depósito OR deposito OR abono OR "pago recibido") newer_than:30d'
  let messageList
  try {
    const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 30 })
    messageList = res.data.messages ?? []
  } catch {
    return { error: 'Error al leer correos. Reconecta tu cuenta de Gmail.' }
  }

  if (messageList.length === 0) return { sugerencias: [] }

  // Fetch and parse each email
  const parsedEmails: Array<{
    idx: number
    emailId: string
    asunto: string
    fecha: string
    rawContent: string
  }> = []

  for (const msg of messageList) {
    if (!msg.id) continue
    try {
      const res = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' })
      const msgData = res.data
      const headers = msgData.payload?.headers ?? []
      const subject = headers.find(h => h.name === 'Subject')?.value ?? ''
      const dateHeader = headers.find(h => h.name === 'Date')?.value ?? ''

      // Try plain text first, fall back to stripped HTML
      const plainText = extractTextFromPayload(msgData.payload ?? {})

      // Also get raw HTML for fallback (BICE and others send HTML-only)
      let rawContent = plainText
      if (!plainText || plainText.length < 50) {
        const htmlPart = findHtmlPart(msgData.payload)
        if (htmlPart) {
          rawContent = decodeBase64Url(htmlPart)
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
        }
      }

      parsedEmails.push({
        idx: parsedEmails.length + 1,
        emailId: msg.id,
        asunto: subject,
        fecha: dateHeader,
        rawContent,
      })
    } catch {
      continue
    }
  }

  // Rule-based matching: name + amount must both appear in the email
  const matches = matchEmails(parsedEmails, tenantsConCLP)

  // Build final suggestions from AI matches only
  const sugerencias: PagoSugerido[] = matches.map(match => {
    const email = parsedEmails.find(e => e.idx === match.emailIdx)
    const tenant = tenantsConCLP.find(t => t.idx === match.tenantIdx)
    if (!email || !tenant) return null

    return {
      emailId: email.emailId,
      fecha: email.fecha,
      asunto: email.asunto,
      monto_clp: match.monto_clp,
      contrato_id: tenant.contratoId,
      propiedad_id: tenant.propiedadId,
      arrendatario_nombre: tenant.nombre,
      propiedad_nombre: tenant.propiedadNombre,
      confianza: match.confianza,
      periodo: periodoActual,
    }
  }).filter(Boolean) as PagoSugerido[]

  // Sort: alta first
  sugerencias.sort((a, b) => (a.confianza === 'alta' ? -1 : 1))

  return { sugerencias }
}

export async function confirmarPagoEmail(
  contratoId: string,
  montoCLP: number,
  periodo: string,
  emailId?: string,
) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const { data: contrato } = await admin
    .from('contratos')
    .select('id, propiedad_id, propiedades(arrendador_id)')
    .eq('id', contratoId)
    .single()

  const arrendadorId = (contrato as unknown as { propiedades?: { arrendador_id: string } } | null)
    ?.propiedades?.arrendador_id

  if (!contrato || arrendadorId !== user.id) return { error: 'No autorizado' }

  const { data: existing } = await admin
    .from('pagos')
    .select('id')
    .eq('contrato_id', contratoId)
    .eq('periodo', periodo)
    .single()

  const payload = {
    contrato_id: contratoId,
    periodo,
    valor_uf: 0,
    valor_clp: montoCLP,
    estado: 'pagado',
    fecha_pago: new Date().toISOString(),
    notas: 'Registrado automáticamente desde correo',
    email_origen: emailId ? `https://mail.google.com/mail/u/0/#all/${emailId}` : null,
  }

  if (existing) {
    await admin.from('pagos').update(payload).eq('id', existing.id)
  } else {
    await admin.from('pagos').insert(payload)
  }

  revalidatePath('/arrendador')
  revalidatePath('/arrendador/email')
  return { success: true }
}

export async function confirmarPagoEmailInformal(
  propiedadId: string,
  montoCLP: number,
  periodo: string,
  emailId?: string,
) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  // Verify ownership
  const { data: propiedad } = await admin
    .from('propiedades')
    .select('id')
    .eq('id', propiedadId)
    .eq('arrendador_id', user.id)
    .single()

  if (!propiedad) return { error: 'No autorizado' }

  const { data: existing } = await admin
    .from('pagos')
    .select('id')
    .eq('propiedad_id', propiedadId)
    .eq('periodo', periodo)
    .maybeSingle()

  const payload = {
    propiedad_id: propiedadId,
    contrato_id: null,
    periodo,
    valor_uf: 0,
    valor_clp: montoCLP,
    estado: 'pagado',
    fecha_pago: new Date().toISOString(),
    notas: 'Registrado automáticamente desde correo',
    email_origen: emailId ? `https://mail.google.com/mail/u/0/#all/${emailId}` : null,
  }

  if (existing) {
    await admin.from('pagos').update(payload).eq('id', existing.id)
  } else {
    await admin.from('pagos').insert(payload)
  }

  revalidatePath('/arrendador')
  revalidatePath(`/arrendador/propiedades/${propiedadId}`)
  return { success: true }
}
