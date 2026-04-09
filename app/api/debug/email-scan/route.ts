import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { google } from 'googleapis'
import { extractTextFromPayload, decodeBase64Url } from '@/lib/utils/email-parser'
import { getUFValue } from '@/lib/utils/uf'
import Anthropic from '@anthropic-ai/sdk'

function buildOAuthClient(connection: {
  access_token: string
  refresh_token?: string | null
  expires_at?: string | null
}) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://tuarriendo-ten.vercel.app/api/auth/gmail/callback'
  )
  oauth2Client.setCredentials({
    access_token: connection.access_token,
    refresh_token: connection.refresh_token ?? undefined,
    expiry_date: connection.expires_at ? new Date(connection.expires_at).getTime() : undefined,
  })
  return oauth2Client
}

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

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: connection } = await admin
    .from('email_connections')
    .select('*')
    .eq('arrendador_id', user.id)
    .single()

  if (!connection) return NextResponse.json({ error: 'Sin conexión Gmail' })

  const oauth2Client = buildOAuthClient(connection)
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  const query = 'subject:(transferencia OR depósito OR deposito OR abono OR "pago recibido") newer_than:30d'
  let messageList: Array<{ id?: string | null }> = []
  try {
    const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 30 })
    messageList = res.data.messages ?? []
  } catch (e) {
    return NextResponse.json({ error: 'Error Gmail', detail: String(e) })
  }

  // Build tenant list
  const { data: propiedades } = await admin
    .from('propiedades')
    .select('id, nombre, valor_uf, moneda, arrendatario_informal_nombre, arrendatario_informal_rut')
    .eq('arrendador_id', user.id)
    .eq('activa', true)

  const propiedadIds = (propiedades ?? []).map((p: { id: string }) => p.id)
  const ufValue = await getUFValue()

  const tenants: Array<{ idx: number; nombre: string; monto_clp: number; moneda: string; monto_original: number }> = []
  let idx = 1

  const { data: contratos } = propiedadIds.length > 0
    ? await admin
      .from('contratos')
      .select('id, propiedades(nombre, valor_uf, moneda), profiles!contratos_arrendatario_id_fkey(nombre, rut)')
      .in('propiedad_id', propiedadIds)
      .eq('activo', true)
    : { data: [] }

  for (const c of contratos ?? []) {
    const profile = (c as unknown as { profiles?: { nombre: string } }).profiles
    const prop = (c as unknown as { propiedades?: { valor_uf: number; moneda: string } }).propiedades
    if (!profile?.nombre) continue
    const monto = prop?.valor_uf ?? 0
    const moneda = prop?.moneda ?? 'UF'
    tenants.push({ idx: idx++, nombre: profile.nombre, monto_clp: moneda === 'UF' ? Math.round(monto * ufValue) : monto, moneda, monto_original: monto })
  }

  for (const p of propiedades ?? []) {
    const pp = p as { id: string; nombre: string; valor_uf: number; moneda: string; arrendatario_informal_nombre?: string }
    if (!pp.arrendatario_informal_nombre) continue
    const moneda = pp.moneda ?? 'UF'
    const monto = pp.valor_uf ?? 0
    tenants.push({ idx: idx++, nombre: pp.arrendatario_informal_nombre, monto_clp: moneda === 'UF' ? Math.round(monto * ufValue) : monto, moneda, monto_original: monto })
  }

  // Parse emails
  const parsedEmails: Array<{ idx: number; subject: string; rawContent: string; rawContentPreview: string }> = []
  for (const msg of messageList.slice(0, 10)) {
    if (!msg.id) continue
    try {
      const res = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' })
      const headers = res.data.payload?.headers ?? []
      const subject = headers.find(h => h.name === 'Subject')?.value ?? ''
      const plainText = extractTextFromPayload(res.data.payload ?? {})

      let rawContent = plainText
      if (!plainText || plainText.length < 50) {
        const htmlPart = findHtmlPart(res.data.payload)
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

      parsedEmails.push({ idx: parsedEmails.length + 1, subject, rawContent, rawContentPreview: rawContent.slice(0, 300) })
    } catch { continue }
  }

  // Build Claude prompt (same as production)
  const tenantsText = tenants.map(t =>
    `[${t.idx}] Nombre: "${t.nombre}" | Monto mensual: $${t.monto_clp.toLocaleString('es-CL')} CLP (${t.monto_original} ${t.moneda})`
  ).join('\n')

  const emailsText = parsedEmails.map(e =>
    `[${e.idx}] Asunto: ${e.subject}\nContenido:\n${e.rawContent.slice(0, 600)}`
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

  let claudeRaw = ''
  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })
    claudeRaw = response.content[0].type === 'text' ? response.content[0].text : ''
  } catch (e) {
    claudeRaw = `ERROR: ${String(e)}`
  }

  return NextResponse.json({
    uf_value: ufValue,
    tenants_sent_to_claude: tenants,
    emails_count: parsedEmails.length,
    emails_preview: parsedEmails.map(e => ({ idx: e.idx, subject: e.subject, rawContentPreview: e.rawContentPreview })),
    claude_prompt_tenants: tenantsText,
    claude_response_raw: claudeRaw,
  })
}
