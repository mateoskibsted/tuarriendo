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

export async function escanearEmails(): Promise<{ error?: string; sugerencias?: PagoSugerido[]; needsReconnect?: boolean }> {
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const isAuthError = msg.includes('invalid_grant') || msg.includes('Token has been expired') || msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid_token')
    if (isAuthError) {
      return { error: 'Tu conexión con Gmail expiró. Debes reconectar tu cuenta.', needsReconnect: true }
    }
    return { error: 'Error al leer correos. Reconecta tu cuenta de Gmail.', needsReconnect: false }
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

  // Check which tenants have the previous month unpaid (for period ambiguity)
  const periodoAnterior = periodoAnteriorDe(periodoActual)
  const allContratoIds = tenantsSinPagar.map(t => t.contratoId).filter(Boolean) as string[]
  const allPropiedadIds = tenantsSinPagar.map(t => t.propiedadId).filter(Boolean) as string[]

  const { data: pagosAnteriorContratos } = allContratoIds.length > 0
    ? await admin.from('pagos').select('contrato_id')
        .eq('periodo', periodoAnterior)
        .in('estado', ['pagado', 'atrasado', 'incompleto'])
        .in('contrato_id', allContratoIds)
    : { data: [] }

  const { data: pagosAnteriorPropiedades } = allPropiedadIds.length > 0
    ? await admin.from('pagos').select('propiedad_id')
        .eq('periodo', periodoAnterior)
        .in('estado', ['pagado', 'atrasado', 'incompleto'])
        .in('propiedad_id', allPropiedadIds)
    : { data: [] }

  const contratosYaPagadosAnterior = new Set(
    (pagosAnteriorContratos ?? []).map((p: { contrato_id: string | null }) => p.contrato_id).filter(Boolean)
  )
  const propiedadesYaPagadasAnterior = new Set(
    (pagosAnteriorPropiedades ?? []).map((p: { propiedad_id: string | null }) => p.propiedad_id).filter(Boolean)
  )

  // Build final suggestions from matches
  const sugerencias: PagoSugerido[] = []
  for (const match of matches) {
    const email = parsedEmails.find(e => e.idx === match.emailIdx)
    const tenant = tenantsConCLP.find(t => t.idx === match.tenantIdx)
    if (!email || !tenant) continue

    const emailFecha = new Date(email.fecha)

    // Detect period ambiguity: previous month unpaid for this tenant
    const prevUnpaid = tenant.contratoId
      ? !contratosYaPagadosAnterior.has(tenant.contratoId)
      : tenant.propiedadId
        ? !propiedadesYaPagadasAnterior.has(tenant.propiedadId)
        : false

    let periodos_disponibles: import('@/lib/types').PeriodoOpcion[] | undefined
    let periodoElegido = periodoActual

    if (tenant.diaPago) {
      const opciones: import('@/lib/types').PeriodoOpcion[] = []

      // Option 1: previous period (if unpaid)
      if (prevUnpaid) {
        const [py, pm] = periodoAnterior.split('-').map(Number)
        const vencPrev = new Date(py, pm - 1, tenant.diaPago)
        const diasPrev = Math.max(0, Math.floor((emailFecha.getTime() - vencPrev.getTime()) / 86400000))
        opciones.push({
          periodo: periodoAnterior,
          label: `${periodoMesNombre(periodoAnterior)} — pago atrasado (${diasPrev} días)`,
          dias_atraso: diasPrev,
        })
      }

      // Option 2: current period
      const [cy, cm] = periodoActual.split('-').map(Number)
      const vencActual = new Date(cy, cm - 1, tenant.diaPago)
      const diasActual = Math.max(0, Math.floor((emailFecha.getTime() - vencActual.getTime()) / 86400000))
      opciones.push({
        periodo: periodoActual,
        label: diasActual > 0
          ? `${periodoMesNombre(periodoActual)} — ${diasActual} días de atraso`
          : `${periodoMesNombre(periodoActual)} — a tiempo`,
        dias_atraso: diasActual,
      })

      // Option 3: next period (if payment is after current due date — could be advance)
      if (diasActual > 0) {
        const pSiguiente = periodoSiguienteDe(periodoActual)
        const [ny, nm] = pSiguiente.split('-').map(Number)
        const vencSig = new Date(ny, nm - 1, tenant.diaPago)
        const diasAntes = Math.max(0, Math.floor((vencSig.getTime() - emailFecha.getTime()) / 86400000))
        opciones.push({
          periodo: pSiguiente,
          label: `${periodoMesNombre(pSiguiente)} — pago adelantado (${diasAntes} días antes)`,
          dias_atraso: 0,
        })
      }

      if (opciones.length > 1) {
        // Check if there's an established payment pattern to skip the selector
        const patron = await getPatronPeriodo(admin, tenant.contratoId, tenant.propiedadId, tenant.diaPago)
        if (patron === 'actual') {
          // Known late payer → assign to current period automatically
          periodoElegido = periodoActual
        } else if (patron === 'siguiente') {
          // Known advance payer → assign to next period automatically
          periodoElegido = periodoSiguienteDe(periodoActual)
        } else {
          // No pattern yet — show selector so landlord can teach the system
          periodos_disponibles = opciones
        }
      }
    }

    sugerencias.push({
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
      periodo: periodoElegido,
      periodos_disponibles,
    })
  }

  // Sort: alta first
  sugerencias.sort((a, b) => (a.confianza === 'alta' ? -1 : 1))

  return { sugerencias }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function periodoMesNombre(periodo: string): string {
  const [year, month] = periodo.split('-').map(Number)
  const nombres = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${nombres[month - 1]} ${year}`
}

function periodoAnteriorDe(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  const prev = new Date(y, m - 2, 1)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
}

function periodoSiguienteDe(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  const next = new Date(y, m, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Reads the last confirmed payment and determines the tenant's payment pattern:
 * - 'actual': tenant pays late (after due date) but it's for the current period
 * - 'siguiente': tenant pays early (before due date of next period — advance billing)
 * - null: no pattern established yet (on-time payments or no history)
 */
async function getPatronPeriodo(
  admin: ReturnType<typeof createAdminClient>,
  contratoId: string | undefined | null,
  propiedadId: string | undefined | null,
  diaPago: number,
): Promise<'actual' | 'siguiente' | null> {
  if (!contratoId && !propiedadId) return null

  const q = admin.from('pagos')
    .select('periodo, fecha_pago')
    .in('estado', ['pagado', 'atrasado'])
    .order('fecha_pago', { ascending: false })
    .limit(1)

  const { data } = contratoId
    ? await q.eq('contrato_id', contratoId)
    : await q.eq('propiedad_id', propiedadId!)

  const last = data?.[0]
  if (!last?.fecha_pago || !last?.periodo) return null

  const [py, pm] = last.periodo.split('-').map(Number)
  const dueDate = new Date(py, pm - 1, diaPago)
  const payDate = new Date(last.fecha_pago)

  // Payment arrived after due date → late payment for current period
  if (payDate > dueDate) return 'actual'

  // Payment arrived before the period's month → advance payment for next period
  if (payDate.getFullYear() < py || (payDate.getFullYear() === py && payDate.getMonth() + 1 < pm)) {
    return 'siguiente'
  }

  return null // on-time, no pattern to learn from
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

  // Atraso: compare the actual payment date vs due date (not today)
  const fechaPago = emailFecha ? new Date(emailFecha) : new Date()
  let diasAtraso = 0
  let multaTotal = 0
  if (diaPago) {
    const [year, month] = periodo.split('-').map(Number)
    const fechaVencimiento = new Date(year, month - 1, diaPago)
    if (fechaPago > fechaVencimiento) {
      diasAtraso = Math.floor((fechaPago.getTime() - fechaVencimiento.getTime()) / 86400000)
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

  const montoTotalEsperado = montoBaseCLP + multaTotal
  const esPagoCompleto = montoCLP >= montoTotalEsperado - 100
  let estado: string
  if (diasAtraso > 0) {
    estado = esPagoCompleto ? 'atrasado' : 'incompleto'
  } else {
    estado = esPagoCompleto ? 'pagado' : 'incompleto'
  }

  const fechaPagoISO = fechaPago.toISOString()

  // Un email = un solo pago. Bloquear solo si está registrado en un contrato DIFERENTE.
  if (emailId) {
    const emailOrigen = 'https://mail.google.com/mail/u/0/#all/' + emailId
    const { data: yaUsado } = await admin.from('pagos').select('id, periodo, contrato_id').eq('email_origen', emailOrigen).maybeSingle()
    if (yaUsado && yaUsado.contrato_id !== contratoId) {
      return { error: 'Este correo ya fue registrado como pago del período ' + yaUsado.periodo + ' en otra propiedad.' }
    }
  }

  const { data: existing } = await admin
    .from('pagos')
    .select('id')
    .eq('contrato_id', contratoId)
    .eq('periodo', periodo)
    .maybeSingle()

  // UF value on the exact payment date for historical accuracy
  const ufValorDia = moneda !== 'CLP' ? await getUFValueForDate(fechaPagoISO) : null

  const payload = {
    contrato_id: contratoId,
    periodo,
    valor_uf: moneda !== 'CLP' ? valorBase : 0,
    valor_clp: montoCLP,
    uf_valor_dia: ufValorDia,
    estado,
    fecha_pago: fechaPagoISO,
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

  // Atraso: compare the actual payment date vs due date (not today)
  const fechaPago = emailFecha ? new Date(emailFecha) : new Date()
  let diasAtraso = 0
  let multaTotal = 0
  if (propiedad.dia_vencimiento) {
    const [year, month] = periodo.split('-').map(Number)
    const fechaVencimiento = new Date(year, month - 1, propiedad.dia_vencimiento)
    if (fechaPago > fechaVencimiento) {
      diasAtraso = Math.floor((fechaPago.getTime() - fechaVencimiento.getTime()) / 86400000)
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

  const fechaPagoISO = fechaPago.toISOString()

  // Un email = un solo pago. Bloquear solo si está registrado en una propiedad DIFERENTE.
  if (emailId) {
    const emailOrigen = 'https://mail.google.com/mail/u/0/#all/' + emailId
    const { data: yaUsado } = await admin.from('pagos').select('id, periodo, propiedad_id').eq('email_origen', emailOrigen).maybeSingle()
    if (yaUsado && yaUsado.propiedad_id !== propiedadId) {
      return { error: 'Este correo ya fue registrado como pago del período ' + yaUsado.periodo + ' en otra propiedad.' }
    }
  }

  const ufValorDia = moneda !== 'CLP' ? await getUFValueForDate(fechaPagoISO) : null

  const payload = {
    propiedad_id: propiedadId,
    contrato_id: null,
    periodo,
    valor_uf: moneda !== 'CLP' ? valorBase : 0,
    valor_clp: montoCLP,
    uf_valor_dia: ufValorDia,
    estado,
    fecha_pago: fechaPagoISO,
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

// ── Pagos detectados por el cron mientras el arrendador no estaba ──

export async function obtenerPagosDetectadosCron(): Promise<{
  error?: string
  pagos?: {
    id: string
    email_id: string
    contrato_id: string | null
    propiedad_id: string | null
    arrendatario_nombre: string
    propiedad_nombre: string | null
    monto_clp: number
    periodo: string
    fecha_transferencia: string | null
    uf_valor_dia: number | null
    gmail_link: string | null
    created_at: string
  }[]
}> {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const { data, error } = await admin
    .from('pagos_detectados_cron')
    .select('*')
    .eq('arrendador_id', user.id)
    .eq('revisado', false)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message }
  return { pagos: data ?? [] }
}

export async function confirmarPagoDetectadoCron(
  cronId: string,
  contratoId: string | null,
  propiedadId: string | null,
  montoCLP: number,
  periodo: string,
  emailId: string | null,
  fechaTransferencia: string | null,
): Promise<{ error?: string; success?: boolean }> {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  // Verify ownership
  const { data: registro } = await admin
    .from('pagos_detectados_cron')
    .select('arrendador_id')
    .eq('id', cronId)
    .single()
  if (!registro || registro.arrendador_id !== user.id) return { error: 'No autorizado' }

  // Confirm the payment using existing logic
  let result
  if (contratoId) {
    result = await confirmarPagoEmail(contratoId, montoCLP, periodo, emailId ?? '', fechaTransferencia ?? undefined)
  } else if (propiedadId) {
    result = await confirmarPagoEmailInformal(propiedadId, montoCLP, periodo, emailId ?? '', fechaTransferencia ?? undefined)
  } else {
    return { error: 'Sin contrato ni propiedad' }
  }

  if (result.error) return { error: result.error }

  // Mark as revisado
  await admin.from('pagos_detectados_cron').update({ revisado: true }).eq('id', cronId)

  return { success: true }
}

export async function descartarPagoDetectadoCron(cronId: string): Promise<{ error?: string; success?: boolean }> {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const { data: registro } = await admin
    .from('pagos_detectados_cron')
    .select('arrendador_id')
    .eq('id', cronId)
    .single()
  if (!registro || registro.arrendador_id !== user.id) return { error: 'No autorizado' }

  await admin.from('pagos_detectados_cron').update({ revisado: true }).eq('id', cronId)
  return { success: true }
}

export async function obtenerPeriodosDisponibles(
  contratoId: string | null | undefined,
  propiedadId: string | null | undefined,
  fechaPagoISO: string,
  periodoActual: string,
): Promise<{ opciones: import('@/lib/types').PeriodoOpcion[]; error?: string }> {
  const { admin } = await getAuthContext()

  // Get due day
  let diaPago: number | null = null
  if (contratoId) {
    const { data } = await admin.from('contratos').select('dia_pago').eq('id', contratoId).single()
    diaPago = data?.dia_pago ?? null
  } else if (propiedadId) {
    const { data } = await admin.from('propiedades').select('dia_vencimiento').eq('id', propiedadId).single()
    diaPago = data?.dia_vencimiento ?? null
  }

  if (!diaPago) return { opciones: [] }

  const fechaPago = new Date(fechaPagoISO)
  const pAnterior = periodoAnteriorDe(periodoActual)

  // Check if previous period is unpaid
  let prevUnpaid = false
  if (contratoId) {
    const { data } = await admin.from('pagos').select('id')
      .eq('contrato_id', contratoId).eq('periodo', pAnterior)
      .in('estado', ['pagado', 'atrasado', 'incompleto']).maybeSingle()
    prevUnpaid = !data
  } else if (propiedadId) {
    const { data } = await admin.from('pagos').select('id')
      .eq('propiedad_id', propiedadId).eq('periodo', pAnterior)
      .in('estado', ['pagado', 'atrasado', 'incompleto']).maybeSingle()
    prevUnpaid = !data
  }

  const opciones: import('@/lib/types').PeriodoOpcion[] = []

  if (prevUnpaid) {
    const [py, pm] = pAnterior.split('-').map(Number)
    const vencPrev = new Date(py, pm - 1, diaPago)
    const dias = Math.max(0, Math.floor((fechaPago.getTime() - vencPrev.getTime()) / 86400000))
    opciones.push({
      periodo: pAnterior,
      label: `${periodoMesNombre(pAnterior)} — pago atrasado (${dias} días)`,
      dias_atraso: dias,
    })
  }

  const [cy, cm] = periodoActual.split('-').map(Number)
  const vencActual = new Date(cy, cm - 1, diaPago)
  const diasActual = Math.max(0, Math.floor((fechaPago.getTime() - vencActual.getTime()) / 86400000))
  opciones.push({
    periodo: periodoActual,
    label: diasActual > 0
      ? `${periodoMesNombre(periodoActual)} — ${diasActual} días de atraso`
      : `${periodoMesNombre(periodoActual)} — a tiempo`,
    dias_atraso: diasActual,
  })

  // If payment is after current due date, also offer next period (advance payment)
  if (diasActual > 0) {
    const pSiguiente = periodoSiguienteDe(periodoActual)
    const [ny, nm] = pSiguiente.split('-').map(Number)
    const vencSig = new Date(ny, nm - 1, diaPago)
    const diasAntes = Math.max(0, Math.floor((vencSig.getTime() - fechaPago.getTime()) / 86400000))
    opciones.push({
      periodo: pSiguiente,
      label: `${periodoMesNombre(pSiguiente)} — pago adelantado (${diasAntes} días antes)`,
      dias_atraso: 0,
    })
  }

  // If there are multiple options, check if there's an established pattern to skip the selector
  if (opciones.length > 1) {
    const patron = await getPatronPeriodo(admin, contratoId, propiedadId, diaPago)
    if (patron === 'actual') {
      const opcionActual = opciones.find(o => o.periodo === periodoActual)
      return { opciones: opcionActual ? [opcionActual] : opciones }
    }
    if (patron === 'siguiente') {
      const pSig = periodoSiguienteDe(periodoActual)
      const opcionSig = opciones.find(o => o.periodo === pSig)
      return { opciones: opcionSig ? [opcionSig] : opciones }
    }
  }

  return { opciones }
}
