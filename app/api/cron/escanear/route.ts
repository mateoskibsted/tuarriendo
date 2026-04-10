import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { google } from 'googleapis'
import { getUFValue, getUFValueForDate } from '@/lib/utils/uf'
import { todayInChile } from '@/lib/utils/date'
import { extractTextFromPayload, decodeBase64Url } from '@/lib/utils/email-parser'

function autenticado(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const auth = req.headers.get('authorization')
  const qs = req.nextUrl.searchParams.get('secret')
  return auth === `Bearer ${secret}` || qs === secret
}

function buildOAuth(connection: { access_token: string; refresh_token?: string | null; expires_at?: string | null }) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://tuarriendo-ten.vercel.app/api/auth/gmail/callback'
  )
  client.setCredentials({
    access_token: connection.access_token,
    refresh_token: connection.refresh_token ?? undefined,
    expiry_date: connection.expires_at ? new Date(connection.expires_at).getTime() : undefined,
  })
  return client
}

function normalizeText(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractAmounts(content: string): number[] {
  return [...content.matchAll(/\$\s*([\d]{1,3}(?:[.,][\d]{3})*)/g)]
    .map(m => parseInt(m[1].replace(/[.,]/g, ''), 10))
    .filter(n => !isNaN(n) && n > 0)
}

function nameMatchesContent(name: string, content: string): boolean {
  const norm = normalizeText(content)
  const words = normalizeText(name).split(' ').filter(w => w.length >= 3).slice(0, 2)
  return words.length > 0 && words.every(w => norm.includes(w))
}

function isTenantSender(tenantName: string, rawContent: string): boolean {
  const norm = rawContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const outgoing = ['realizaste una transferencia', 'efectuaste una transferencia', 'has realizado una transferencia', 'transferencia enviada', 'has transferido', 'transferiste']
  if (outgoing.some(k => norm.includes(k))) return false
  const nameNorm = normalizeText(tenantName).split(' ')[0]
  const destIdx = norm.indexOf('cuenta de destino')
  const origIdx = norm.indexOf('cuenta de origen')
  if (destIdx !== -1 || origIdx !== -1) {
    const nameIdx = norm.indexOf(nameNorm)
    if (nameIdx === -1) return false
    if (destIdx !== -1 && origIdx !== -1) return Math.abs(nameIdx - origIdx) < Math.abs(nameIdx - destIdx)
    if (destIdx !== -1 && origIdx === -1) return false
  }
  return true
}

function findHtmlPart(payload: { mimeType?: string | null; body?: { data?: string | null } | null; parts?: unknown[] } | null | undefined): string | null {
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

const MESES_ES: Record<string, number> = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11 }

function extractTransferDateISO(rawContent: string, emailDateHeader: string): string {
  const m = rawContent.match(/(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\s+(\d{4})\s*[-–]?\s*(\d{1,2}):(\d{2})/i)
  if (m) {
    const month = MESES_ES[m[2].toLowerCase()]
    if (month !== undefined) {
      const utcMs = Date.UTC(parseInt(m[3]), month, parseInt(m[1]), parseInt(m[4]) + 4, parseInt(m[5]), 0)
      return new Date(utcMs).toISOString()
    }
  }
  const d = new Date(emailDateHeader)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

export async function GET(req: NextRequest) {
  if (!autenticado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const admin = createAdminClient()
  const hoy = todayInChile()
  const periodoActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const ufValue = await getUFValue()

  // All arrendadores with connected email
  const { data: connections } = await admin.from('email_connections').select('*')
  if (!connections || connections.length === 0) return NextResponse.json({ ok: true, confirmados: 0 })

  let totalConfirmados = 0
  const errores: string[] = []

  for (const conn of connections) {
    const arrendadorId = conn.arrendador_id as string

    try {
      // Build tenant list for this arrendador
      const { data: propiedades } = await admin.from('propiedades').select('id').eq('arrendador_id', arrendadorId).eq('activa', true)
      const propIds = (propiedades ?? []).map((p: { id: string }) => p.id)
      if (propIds.length === 0) continue

      const { data: contratos } = await admin
        .from('contratos')
        .select('id, propiedad_id, dia_pago, propiedades(nombre, valor_uf, moneda, multa_monto), profiles!contratos_arrendatario_id_fkey(nombre, rut)')
        .in('propiedad_id', propIds).eq('activo', true)

      const { data: informales } = await admin
        .from('propiedades')
        .select('id, nombre, valor_uf, moneda, dia_vencimiento, multa_monto, arrendatario_informal_nombre, arrendatario_informal_rut')
        .in('id', propIds).eq('activa', true).not('arrendatario_informal_nombre', 'is', null)

      // Already paid this period (skip re-confirming)
      const { data: yaRegistrados } = await admin.from('pagos').select('contrato_id, propiedad_id')
        .eq('periodo', periodoActual).in('estado', ['pagado', 'atrasado', 'incompleto'])

      const contratosPagados = new Set((yaRegistrados ?? []).map((p: { contrato_id: string | null }) => p.contrato_id).filter(Boolean))
      const propPagadas = new Set((yaRegistrados ?? []).map((p: { propiedad_id: string | null }) => p.propiedad_id).filter(Boolean))

      type Tenant = { id: string; tipo: 'contrato' | 'informal'; nombre: string; montoBaseCLP: number; montoTotalCLP: number; valorUf: number; moneda: string }
      const [year, month] = periodoActual.split('-').map(Number)
      const tenants: Tenant[] = []

      for (const c of contratos ?? []) {
        if (contratosPagados.has(c.id)) continue
        const p = (c as unknown as { propiedades?: { nombre: string; valor_uf: number; moneda: string; multa_monto?: number | null } }).propiedades
        const prof = (c as unknown as { profiles?: { nombre: string } }).profiles
        if (!prof?.nombre || !p) continue
        const base = p.moneda === 'CLP' ? p.valor_uf : Math.round(p.valor_uf * ufValue)
        const diaPago = (c as unknown as { dia_pago?: number | null }).dia_pago
        let multa = 0
        if (diaPago && p.multa_monto) {
          const venc = new Date(year, month - 1, diaPago)
          if (hoy > venc) multa = Math.floor((hoy.getTime() - venc.getTime()) / 86400000) * p.multa_monto
        }
        tenants.push({ id: c.id, tipo: 'contrato', nombre: prof.nombre, montoBaseCLP: base, montoTotalCLP: base + multa, valorUf: p.valor_uf, moneda: p.moneda ?? 'UF' })
      }

      for (const p of informales ?? []) {
        if (!p.arrendatario_informal_nombre || propPagadas.has(p.id)) continue
        const base = p.moneda === 'CLP' ? p.valor_uf : Math.round(p.valor_uf * ufValue)
        let multa = 0
        if (p.dia_vencimiento && p.multa_monto) {
          const venc = new Date(year, month - 1, p.dia_vencimiento)
          if (hoy > venc) multa = Math.floor((hoy.getTime() - venc.getTime()) / 86400000) * p.multa_monto
        }
        tenants.push({ id: p.id, tipo: 'informal', nombre: p.arrendatario_informal_nombre, montoBaseCLP: base, montoTotalCLP: base + multa, valorUf: p.valor_uf, moneda: p.moneda ?? 'UF' })
      }

      if (tenants.length === 0) continue

      // Fetch emails
      const oauth = buildOAuth(conn)
      oauth.on('tokens', async (t) => {
        if (t.access_token) {
          await admin.from('email_connections').update({ access_token: t.access_token, expires_at: t.expiry_date ? new Date(t.expiry_date).toISOString() : undefined }).eq('arrendador_id', arrendadorId)
        }
      })
      const gmail = google.gmail({ version: 'v1', auth: oauth })

      let messages: { id?: string | null }[] = []
      try {
        const res = await gmail.users.messages.list({ userId: 'me', q: 'subject:(transferencia OR depósito OR deposito OR abono OR "pago recibido") newer_than:30d', maxResults: 30 })
        messages = res.data.messages ?? []
      } catch { continue }

      for (const msg of messages) {
        if (!msg.id) continue
        try {
          const res = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' })
          const headers = res.data.payload?.headers ?? []
          const dateHeader = headers.find(h => h.name === 'Date')?.value ?? ''
          let rawContent = extractTextFromPayload(res.data.payload ?? {})
          if (!rawContent || rawContent.length < 50) {
            const html = findHtmlPart(res.data.payload)
            if (html) rawContent = decodeBase64Url(html).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
          }
          const amounts = extractAmounts(rawContent)
          const emailFecha = extractTransferDateISO(rawContent, dateHeader)

          for (const tenant of tenants) {
            if (!nameMatchesContent(tenant.nombre, rawContent)) continue
            if (!isTenantSender(tenant.nombre, rawContent)) continue

            const matched = amounts.find(a => tenant.montoBaseCLP > 0 && Math.abs(a - tenant.montoBaseCLP) / tenant.montoBaseCLP <= 0.15)
            if (!matched) continue

            // Only auto-confirm high-confidence (covers full debt within $100)
            const faltante = Math.max(0, tenant.montoTotalCLP - matched)
            if (faltante > 100) continue  // incomplete — skip auto-confirm, arrendador must review

            // Calculate estado
            const [py, pm] = periodoActual.split('-').map(Number)
            const venc = new Date(py, pm - 1, /* dia */ 1)  // placeholder, recalculated below
            void venc
            const diasAtraso = tenant.montoTotalCLP > tenant.montoBaseCLP ? Math.round((tenant.montoTotalCLP - tenant.montoBaseCLP) / (tenant.montoTotalCLP - tenant.montoBaseCLP)) : 0
            void diasAtraso
            const estado = tenant.montoTotalCLP > tenant.montoBaseCLP ? 'atrasado' : 'pagado'

            const notas = `Auto-confirmado por escáner. Monto recibido: $${matched.toLocaleString('es-CL')} CLP`
            const emailOrigen = `https://mail.google.com/mail/u/0/#all/${msg.id}`
            const fechaPago = new Date(emailFecha).toISOString()
            const ufValorDia = tenant.moneda !== 'CLP' ? await getUFValueForDate(fechaPago) : null

            if (tenant.tipo === 'contrato') {
              const { data: existing } = await admin.from('pagos').select('id').eq('contrato_id', tenant.id).eq('periodo', periodoActual).maybeSingle()
              const payload = { contrato_id: tenant.id, propiedad_id: null, periodo: periodoActual, valor_uf: tenant.moneda !== 'CLP' ? tenant.valorUf : 0, valor_clp: matched, uf_valor_dia: ufValorDia, estado, fecha_pago: fechaPago, notas, email_origen: emailOrigen }
              if (existing) await admin.from('pagos').update(payload).eq('id', existing.id)
              else await admin.from('pagos').insert(payload)
            } else {
              const { data: existing } = await admin.from('pagos').select('id').eq('propiedad_id', tenant.id).eq('periodo', periodoActual).maybeSingle()
              const payload = { propiedad_id: tenant.id, contrato_id: null, periodo: periodoActual, valor_uf: tenant.moneda !== 'CLP' ? tenant.valorUf : 0, valor_clp: matched, uf_valor_dia: ufValorDia, estado, fecha_pago: fechaPago, notas, email_origen: emailOrigen }
              if (existing) await admin.from('pagos').update(payload).eq('id', existing.id)
              else await admin.from('pagos').insert(payload)
            }

            totalConfirmados++
            // Mark as processed so we don't double-count this tenant this run
            contratosPagados.add(tenant.id)
            propPagadas.add(tenant.id)
          }
        } catch { continue }
      }
    } catch (err) {
      errores.push(`arrendador ${arrendadorId}: ${err}`)
    }
  }

  return NextResponse.json({ ok: true, confirmados: totalConfirmados, periodo: periodoActual, errores })
}
