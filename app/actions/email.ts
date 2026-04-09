'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { google } from 'googleapis'
import Anthropic from '@anthropic-ai/sdk'
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

/** Use Claude to match emails against tenants, requiring name + amount to both match. */
async function matchEmailsWithAI(
  emails: Array<{
    idx: number
    asunto: string
    rawContent: string  // HTML or plain text, truncated
    monto_clp?: number
  }>,
  tenants: Array<{
    idx: number
    contratoId?: string
    propiedadId?: string
    nombre: string
    rut: string
    propiedadNombre: string
    monto_clp: number   // always in CLP for comparison
    monto_original: number
    moneda: string
  }>
): Promise<Array<{ emailIdx: number; tenantIdx: number; confianza: 'alta' | 'media'; monto_clp?: number }>> {
  if (emails.length === 0 || tenants.length === 0) return []

  const client = new Anthropic()

  const tenantsText = tenants.map(t =>
    `[${t.idx}] Nombre: "${t.nombre}" | Monto mensual: $${t.monto_clp.toLocaleString('es-CL')} CLP (${t.monto_original} ${t.moneda}) | Propiedad: ${t.propiedadNombre}`
  ).join('\n')

  const emailsText = emails.map(e =>
    `[${e.idx}] Asunto: ${e.asunto}\nContenido:\n${e.rawContent.slice(0, 600)}`
  ).join('\n\n---\n\n')

  const prompt = `Eres un asistente que detecta pagos de arriendo en correos bancarios chilenos.

ARRENDATARIOS Y MONTOS ESPERADOS:
${tenantsText}

CORREOS BANCARIOS RECIBIDOS:
${emailsText}

TAREA: Para cada correo, determina si es un pago de arriendo de algún arrendatario.

REGLAS ESTRICTAS — un correo es un pago solo si cumple AMBAS condiciones:
1. El nombre del remitente en el correo coincide (exacto o muy similar) con el nombre del arrendatario
2. El monto transferido en el correo es similar al monto mensual esperado (±10%)

Si solo coincide el nombre pero no el monto, o solo el monto pero no el nombre: NO incluir.
Si el correo es de pagos propios (compras, servicios, sueldos salientes): NO incluir.

Responde ÚNICAMENTE con JSON válido:
[
  {
    "email": <número>,
    "arrendatario": <número>,
    "monto_detectado": <monto en CLP extraído del correo, o null>,
    "confianza": "alta" (nombre exacto + monto exacto) o "media" (nombre similar + monto aproximado)
  }
]

Si no hay coincidencias válidas, responde con: []`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '[]'
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      email: number
      arrendatario: number
      monto_detectado?: number | null
      confianza: string
    }>

    return parsed
      .filter(r => r.confianza === 'alta' || r.confianza === 'media')
      .map(r => ({
        emailIdx: r.email,
        tenantIdx: r.arrendatario,
        confianza: r.confianza as 'alta' | 'media',
        monto_clp: r.monto_detectado ?? undefined,
      }))
  } catch {
    return []
  }
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

  // Get current UF value for CLP conversion
  const ufValue = await getUFValue()

  // Convert all tenant amounts to CLP
  const tenantsConCLP = tenants.map(t => ({
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
  const periodoActual = new Date().toISOString().slice(0, 7)
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

  // Use Claude AI to match emails with tenants (name + amount required)
  const matches = await matchEmailsWithAI(parsedEmails, tenantsConCLP)

  // Build final suggestions from AI matches only
  const sugerencias: PagoSugerido[] = matches.map(match => {
    const email = parsedEmails.find(e => e.idx === match.emailIdx)
    const tenant = tenantsConCLP.find(t => t.idx === match.tenantIdx)
    if (!email || !tenant) return null

    return {
      emailId: email.emailId,
      fecha: email.fecha,
      asunto: email.asunto,
      monto_clp: match.monto_clp ?? tenant.monto_clp,
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
