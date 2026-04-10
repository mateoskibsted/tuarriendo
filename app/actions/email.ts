'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { google } from 'googleapis'
import { revalidatePath } from 'next/cache'
import { extractTextFromPayload, decodeBase64Url } from '@/lib/utils/email-parser'
import { getUFValue, getUFValueForDate } from '@/lib/utils/uf'
import { todayInChile } from '@/lib/utils/date'
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

const MESES_ES: Record<string, number> = {
  ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5,
  jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11,
}

/**
 * Try to extract the exact transfer datetime from an email body.
 * Banks like BICE include "9 abr 2026 - 14:46 h" in the body.
 * Returns an ISO string in UTC. Falls back to the email Date header.
 */
function extractTransferDateISO(rawContent: string, emailDateHeader: string): string {
  // Pattern: "9 abr 2026 - 14:46" or "9 abr 2026 14:46"
  const m = rawContent.match(
    /(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\s+(\d{4})\s*[-–]?\s*(\d{1,2}):(\d{2})/i
  )
  if (m) {
    const day = parseInt(m[1])
    const month = MESES_ES[m[2].toLowerCase()]
    const year = parseInt(m[3])
    const hour = parseInt(m[4])
    const min = parseInt(m[5])
    if (month !== undefined) {
      // Chile is UTC-4 permanently since 2024
      const utcMs = Date.UTC(year, month, day, hour + 4, min, 0)
      return new Date(utcMs).toISOString()
    }
  }
  // Fallback: use the email Date header (RFC 2822, handles timezone automatically)
  const d = new Date(emailDateHeader)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

/**
 * Returns true only if the tenant name appears as SENDER (incoming transfer to arrendador).
 * In BICE and most Chilean bank emails:
 *   - Incoming: tenant name is under "Cuenta de origen"
 *   - Outgoing: tenant name is under "Cuenta de destino"
 * Also filters generic outgoing keywords.
 */
function isTenantSender(tenantName: string, subject: string, rawContent: string): boolean {
  const combined = (subject + ' ' + rawContent)
  const combinedNorm = combined.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Hard exclusion: clear outgoing transfer keywords
  const outgoingKeywords = [
    'realizaste una transferencia',
    'efectuaste una transferencia',
    'has realizado una transferencia',
    'transferencia enviada',
    'tu transferencia fue realizada',
    'has transferido',
    'transferiste',
  ]
  if (outgoingKeywords.some(k => combinedNorm.includes(k))) return false

  // BICE/Chilean banks: check if name appears near "cuenta de destino" (outgoing)
  // vs "cuenta de origen" (incoming). Search normalized text for these anchors.
  const nameNorm = tenantName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(' ')[0]
  const destIdx = combinedNorm.indexOf('cuenta de destino')
  const origIdx = combinedNorm.indexOf('cuenta de origen')

  if (destIdx !== -1 || origIdx !== -1) {
    // Find where the tenant name appears relative to these anchors
    const nameIdx = combinedNorm.indexOf(nameNorm)
    if (nameIdx === -1) return false

    // If name is closer to "cuenta de destino" → outgoing → exclude
    // If name is closer to "cuenta de origen" → incoming → include
    if (destIdx !== -1 && origIdx !== -1) {
      const distToDest = Math.abs(nameIdx - destIdx)
      const distToOrig = Math.abs(nameIdx - origIdx)
      return distToOrig < distToDest  // closer to origen = incoming
    }
    if (destIdx !== -1 && origIdx === -1) return false  // only dest anchor found = outgoing
    if (origIdx !== -1 && destIdx === -1) return true   // only origen anchor found = incoming
  }

  // No structural anchors found — fall back to incoming (let amount matching decide)
  return true
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
    monto_total_esperado: number  // base + multa acumulada
  }>
): Array<{
  emailIdx: number
  tenantIdx: number
  confianza: 'alta' | 'media'
  monto_clp: number
  monto_faltante: number
}> {
  const results: Array<{
    emailIdx: number
    tenantIdx: number
    confianza: 'alta' | 'media'
    monto_clp: number
    monto_faltante: number
  }> = []

  for (const email of emails) {
    const amounts = extractAmounts(email.rawContent)

    for (const tenant of tenants) {
      // Check name appears as SENDER (incoming), not recipient (outgoing)
      if (!isTenantSender(tenant.nombre, '', email.rawContent)) continue

      const base = tenant.monto_clp
      const total = tenant.monto_total_esperado

      // Candidate match: amount must be within ±15% of BASE amount only
      // (using total would allow false positives when fine inflates expected amount)
      const matchedAmount = amounts.find(a => {
        if (base === 0) return false
        return Math.abs(a - base) / base <= 0.15
      })

      if (matchedAmount === undefined) continue

      // Completeness: does the received amount cover the full debt (base + fine)?
      const monto_faltante = Math.max(0, total - matchedAmount)
      const coversTotal = monto_faltante <= 100  // tolerance $100
      const confianza: 'alta' | 'media' = coversTotal ? 'alta' : 'media'

      results.push({ emailIdx: email.idx, tenantIdx: tenant.idx, confianza, monto_clp: matchedAmount, monto_faltante })
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
    .select('id, propiedad_id, dia_pago, propiedades(nombre, valor_uf, moneda, multa_monto, multa_moneda), profiles!contratos_arrendatario_id_fkey(nombre, rut)')
    .in('propiedad_id', propiedadIds)
    .eq('activo', true)

  // Load propiedades with informal arrendatarios
  const { data: propiedadesInformales } = await admin
    .from('propiedades')
    .select('id, nombre, valor_uf, moneda, dia_vencimiento, multa_monto, multa_moneda, arrendatario_informal_nombre, arrendatario_informal_rut')
    .in('id', propiedadIds)
    .eq('activa', true)
    .not('arrendatario_informal_nombre', 'is', null)

  // Build tenant list (formal + informal)
  const tenants: Array<{
    idx: number
    contratoId?: string
    propiedadId?: string
    nombre: string
    rut: string
    propiedadNombre: string
    monto: number
    moneda: string
    diaPago?: number | null
    multaMonto?: number | null
  }> = []

  let idx = 1
  for (const c of contratos ?? []) {
    const profile = (c as unknown as { profiles?: { nombre: string; rut: string } }).profiles
    const propiedad = (c as unknown as { propiedades?: { nombre: string; valor_uf: number; moneda: string; multa_monto?: number | null } }).propiedades
    if (!profile?.nombre) continue
    tenants.push({
      idx: idx++,
      contratoId: c.id,
      nombre: profile.nombre,
      rut: profile.rut ?? '',
      propiedadNombre: propiedad?.nombre ?? '',
      monto: propiedad?.valor_uf ?? 0,
      moneda: propiedad?.moneda ?? 'UF',
      diaPago: (c as unknown as { dia_pago?: number | null }).dia_pago,
      multaMonto: propiedad?.multa_monto,
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
      diaPago: p.dia_vencimiento,
      multaMonto: p.multa_monto,
    })
  }

  if (tenants.length === 0) return { sugerencias: [] }

  // Exclude tenants that already have a confirmed payment this month
  const periodoActual = new Date().toISOString().slice(0, 7)
  const { data: pagosYaRegistrados } = await admin
    .from('pagos')
    .select('contrato_id, propiedad_id')
    .eq('periodo', periodoActual)
    .in('estado', ['pagado', 'atrasado', 'incompleto'])

  const contratosPagados = new Set((pagosYaRegistrados ?? []).map((p: { contrato_id: string | null }) => p.contrato_id).filter(Boolean))
  const propiedadesPagadas = new Set((pagosYaRegistrados ?? []).map((p: { propiedad_id: string | null }) => p.propiedad_id).filter(Boolean))

  const tenantsSinPagar = tenants.filter(t =>
    !(t.contratoId && contratosPagados.has(t.contratoId)) &&
    !(t.propiedadId && propiedadesPagadas.has(t.propiedadId))
  )

  if (tenantsSinPagar.length === 0) return { sugerencias: [] }

  // Get current UF value for CLP conversion
  const ufValue = await getUFValue()

  // Calculate total expected (base + fine if overdue) for each tenant
  const [year, month] = periodoActual.split('-').map(Number)
  const hoy = todayInChile()

  const tenantsConCLP = tenantsSinPagar.map(t => {
    const monto_clp = t.moneda === 'UF' ? Math.round(t.monto * ufValue) : t.monto
    let multa = 0
    if (t.diaPago && t.multaMonto) {
      const venc = new Date(year, month - 1, t.diaPago)
      // Fine starts the day AFTER the due date
      if (hoy > venc) {
        const dias = Math.floor((hoy.getTime() - venc.getTime()) / 86400000)
        multa = dias * t.multaMonto
      }
    }
    return { ...t, monto_clp, monto_total_esperado: monto_clp + multa }
  })

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
        fecha: extractTransferDateISO(rawContent, dateHeader),
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
      monto_total_esperado: tenant.monto_total_esperado,
      monto_faltante: match.monto_faltante > 0 ? match.monto_faltante : undefined,
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
  emailFecha?: string,
) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const { data: contrato } = await admin
    .from('contratos')
    .select('id, propiedad_id, dia_pago, valor_uf, propiedades(arrendador_id, valor_uf, moneda, multa_monto, multa_moneda)')
    .eq('id', contratoId)
    .single()

  const arrendadorId = (contrato as unknown as { propiedades?: { arrendador_id: string } } | null)
    ?.propiedades?.arrendador_id

  if (!contrato || arrendadorId !== user.id) return { error: 'No autorizado' }

  const diaPago = (contrato as unknown as { dia_pago?: number }).dia_pago
  const propiedadData = (contrato as unknown as {
    propiedades?: { valor_uf?: number | null; moneda?: string | null; multa_monto?: number | null; multa_moneda?: string | null }
  }).propiedades

  // Base amount in CLP
  const ufValue = await getUFValue()
  const moneda = propiedadData?.moneda ?? 'UF'
  const valorBase = propiedadData?.valor_uf ?? 0
  const montoBaseCLP = moneda === 'CLP' ? valorBase : Math.round(valorBase * ufValue)

  // Atraso calculation
  let diasAtraso = 0
  let multaTotal = 0
  if (diaPago) {
    const [year, month] = periodo.split('-').map(Number)
    const fechaVencimiento = new Date(year, month - 1, diaPago)
    const hoy = todayInChile()
    if (hoy > fechaVencimiento) {
      diasAtraso = Math.floor((hoy.getTime() - fechaVencimiento.getTime()) / 86400000)
      multaTotal = propiedadData?.multa_monto ? diasAtraso * propiedadData.multa_monto : 0
    }
  }

  // Build notas based on amount received vs expected
  const faltanteBase = montoBaseCLP > 0 ? montoBaseCLP - montoCLP : 0
  const notasParts: string[] = [`Monto recibido: $${montoCLP.toLocaleString('es-CL')} CLP`]
  if (faltanteBase > 0) notasParts.push(`Faltan $${faltanteBase.toLocaleString('es-CL')} del monto base`)
  if (diasAtraso > 0) notasParts.push(`${diasAtraso} día(s) de atraso`)
  if (multaTotal > 0) {
    const monedaMulta = propiedadData?.multa_moneda ?? 'CLP'
    notasParts.push(`Multa pendiente: $${multaTotal.toLocaleString('es-CL')} ${monedaMulta}`)
  }
  const notas = notasParts.join('. ')

  // Estado:
  // - 'pagado': a tiempo y monto completo
  // - 'atrasado': tarde pero monto cubre base+multa (verde en UI)
  // - 'incompleto': monto recibido no cubre la deuda total
  const montoTotalEsperado = montoBaseCLP + multaTotal
  const esPagoCompleto = montoCLP >= montoTotalEsperado - 100  // tolerancia $100
  let estado: string
  if (diasAtraso > 0) {
    estado = esPagoCompleto ? 'atrasado' : 'incompleto'
  } else {
    estado = esPagoCompleto ? 'pagado' : 'incompleto'
  }

  const { data: existing } = await admin
    .from('pagos')
    .select('id')
    .eq('contrato_id', contratoId)
    .eq('periodo', periodo)
    .maybeSingle()

  const fechaPago = emailFecha ? new Date(emailFecha).toISOString() : new Date().toISOString()

  // UF value on the exact payment date for historical accuracy
  const ufValorDia = moneda !== 'CLP' ? await getUFValueForDate(fechaPago) : null

  const payload = {
    contrato_id: contratoId,
    periodo,
    valor_uf: moneda !== 'CLP' ? valorBase : 0,
    valor_clp: montoCLP,
    uf_valor_dia: ufValorDia,
    estado,
    fecha_pago: fechaPago,
    notas,
    email_origen: emailId ? `https://mail.google.com/mail/u/0/#all/${emailId}` : null,
  }

  let dbError
  if (existing) {
    const { error } = await admin.from('pagos').update(payload).eq('id', existing.id)
    dbError = error
  } else {
    const { error } = await admin.from('pagos').insert(payload)
    dbError = error
  }

  if (dbError) return { error: dbError.message }

  // Fetch the contrato's propiedad_id to revalidate the property page
  const { data: contratoProp } = await admin
    .from('contratos')
    .select('propiedad_id')
    .eq('id', contratoId)
    .single()

  revalidatePath('/arrendador')
  revalidatePath('/arrendador/email')
  if (contratoProp?.propiedad_id) {
    revalidatePath(`/arrendador/propiedades/${contratoProp.propiedad_id}`)
  }
  return { success: true }
}

export async function confirmarPagoEmailInformal(
  propiedadId: string,
  montoCLP: number,
  periodo: string,
  emailId?: string,
  emailFecha?: string,
) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const { data: propiedad } = await admin
    .from('propiedades')
    .select('id, valor_uf, moneda, dia_vencimiento, multa_monto, multa_moneda')
    .eq('id', propiedadId)
    .eq('arrendador_id', user.id)
    .single()

  if (!propiedad) return { error: 'No autorizado' }

  // Base amount in CLP
  const ufValue = await getUFValue()
  const moneda = propiedad.moneda ?? 'UF'
  const valorBase = propiedad.valor_uf ?? 0
  const montoBaseCLP = moneda === 'CLP' ? valorBase : Math.round(valorBase * ufValue)

  // Atraso calculation
  let diasAtraso = 0
  let multaTotal = 0
  if (propiedad.dia_vencimiento) {
    const [year, month] = periodo.split('-').map(Number)
    const fechaVencimiento = new Date(year, month - 1, propiedad.dia_vencimiento)
    const hoy = todayInChile()
    if (hoy > fechaVencimiento) {
      diasAtraso = Math.floor((hoy.getTime() - fechaVencimiento.getTime()) / 86400000)
      multaTotal = propiedad.multa_monto ? diasAtraso * propiedad.multa_monto : 0
    }
  }

  // Build notas based on amount received vs expected
  const faltanteBase = montoBaseCLP > 0 ? montoBaseCLP - montoCLP : 0
  const notasParts: string[] = [`Monto recibido: $${montoCLP.toLocaleString('es-CL')} CLP`]
  if (faltanteBase > 0) notasParts.push(`Faltan $${faltanteBase.toLocaleString('es-CL')} del monto base`)
  if (diasAtraso > 0) notasParts.push(`${diasAtraso} día(s) de atraso`)
  if (multaTotal > 0) {
    const monedaMulta = propiedad.multa_moneda ?? 'CLP'
    notasParts.push(`Multa pendiente: $${multaTotal.toLocaleString('es-CL')} ${monedaMulta}`)
  }
  const notas = notasParts.join('. ')

  const montoTotalEsperado = montoBaseCLP + multaTotal
  const esPagoCompleto = montoCLP >= montoTotalEsperado - 100
  let estado: string
  if (diasAtraso > 0) {
    estado = esPagoCompleto ? 'atrasado' : 'incompleto'
  } else {
    estado = esPagoCompleto ? 'pagado' : 'incompleto'
  }

  const { data: existing } = await admin
    .from('pagos')
    .select('id')
    .eq('propiedad_id', propiedadId)
    .eq('periodo', periodo)
    .maybeSingle()

  const fechaPago = emailFecha ? new Date(emailFecha).toISOString() : new Date().toISOString()

  const ufValorDia = moneda !== 'CLP' ? await getUFValueForDate(fechaPago) : null

  const payload = {
    propiedad_id: propiedadId,
    contrato_id: null,
    periodo,
    valor_uf: moneda !== 'CLP' ? valorBase : 0,
    valor_clp: montoCLP,
    uf_valor_dia: ufValorDia,
    estado,
    fecha_pago: fechaPago,
    notas,
    email_origen: emailId ? `https://mail.google.com/mail/u/0/#all/${emailId}` : null,
  }

  let dbError
  if (existing) {
    const { error } = await admin.from('pagos').update(payload).eq('id', existing.id)
    dbError = error
  } else {
    const { error } = await admin.from('pagos').insert(payload)
    dbError = error
  }

  if (dbError) return { error: dbError.message }

  revalidatePath('/arrendador')
  revalidatePath(`/arrendador/propiedades/${propiedadId}`)
  return { success: true }
}
