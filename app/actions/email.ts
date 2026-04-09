'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { google } from 'googleapis'
import Anthropic from '@anthropic-ai/sdk'
import { revalidatePath } from 'next/cache'
import { parseEmailForPayment, extractTextFromPayload } from '@/lib/utils/email-parser'
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

/** Use Claude to match a batch of parsed emails against known tenants. */
async function matchEmailsWithAI(
  emails: Array<{
    idx: number
    asunto: string
    cuerpo: string
    monto_clp?: number
    rut_detectado?: string
    nombre_detectado?: string
  }>,
  tenants: Array<{
    idx: number
    contratoId?: string
    propiedadId?: string
    nombre: string
    rut: string
    propiedadNombre: string
    monto: number
    moneda: string
  }>
): Promise<Array<{ emailIdx: number; tenantIdx: number; confianza: 'alta' | 'media' }>> {
  if (emails.length === 0 || tenants.length === 0) return []

  const client = new Anthropic()

  const tenantsText = tenants.map(t =>
    `[${t.idx}] Nombre: ${t.nombre} | RUT: ${t.rut} | Propiedad: ${t.propiedadNombre} | Monto esperado: ${t.monto} ${t.moneda}`
  ).join('\n')

  const emailsText = emails.map(e =>
    `[${e.idx}] Asunto: ${e.asunto}\nMonto detectado: ${e.monto_clp ? `$${e.monto_clp}` : 'no detectado'} | RUT detectado: ${e.rut_detectado ?? 'ninguno'} | Nombre detectado: ${e.nombre_detectado ?? 'ninguno'}\nCuerpo (extracto): ${e.cuerpo.slice(0, 400)}`
  ).join('\n\n---\n\n')

  const prompt = `Eres un asistente que analiza correos bancarios chilenos para detectar pagos de arriendo.

ARRENDATARIOS REGISTRADOS:
${tenantsText}

CORREOS A ANALIZAR:
${emailsText}

TAREA: Determina cuáles correos son pagos de arriendo de algún arrendatario registrado.
Solo incluye coincidencias donde estés seguro de que el correo corresponde a un pago de arriendo.
Ignora correos que claramente no son pagos de arriendo (compras, sueldos, otros).

Responde ÚNICAMENTE con un JSON válido, sin texto adicional:
[
  {"email": <número del correo>, "arrendatario": <número del arrendatario>, "confianza": "alta" o "media"},
  ...
]

Reglas:
- "alta": RUT coincide exactamente, o nombre exacto + monto muy similar al esperado
- "media": nombre parcial o monto similar al esperado, pero sin certeza total
- Si un correo no corresponde a ningún arrendatario, NO lo incluyas en la respuesta
- Si no hay coincidencias, responde con []`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '[]'
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      email: number
      arrendatario: number
      confianza: string
    }>

    return parsed
      .filter(r => r.confianza === 'alta' || r.confianza === 'media')
      .map(r => ({
        emailIdx: r.email,
        tenantIdx: r.arrendatario,
        confianza: r.confianza as 'alta' | 'media',
      }))
  } catch {
    return []
  }
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
    cuerpo: string
    monto_clp?: number
    rut_detectado?: string
    nombre_detectado?: string
    banco?: string
  }> = []

  for (const msg of messageList) {
    if (!msg.id) continue
    try {
      const res = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' })
      const msgData = res.data
      const headers = msgData.payload?.headers ?? []
      const subject = headers.find(h => h.name === 'Subject')?.value ?? ''
      const dateHeader = headers.find(h => h.name === 'Date')?.value ?? ''
      const body = extractTextFromPayload(msgData.payload ?? {})
      const parsed = parseEmailForPayment(subject, body)

      parsedEmails.push({
        idx: parsedEmails.length + 1,
        emailId: msg.id,
        asunto: subject,
        fecha: dateHeader,
        cuerpo: body,
        monto_clp: parsed.monto_clp,
        rut_detectado: parsed.rut,
        nombre_detectado: parsed.nombre,
        banco: parsed.banco,
      })
    } catch {
      continue
    }
  }

  // Use Claude AI to match emails with tenants
  const matches = await matchEmailsWithAI(parsedEmails, tenants)

  // Build final suggestions from AI matches only
  const sugerencias: PagoSugerido[] = matches.map(match => {
    const email = parsedEmails.find(e => e.idx === match.emailIdx)
    const tenant = tenants.find(t => t.idx === match.tenantIdx)
    if (!email || !tenant) return null

    return {
      emailId: email.emailId,
      fecha: email.fecha,
      asunto: email.asunto,
      monto_clp: email.monto_clp,
      rut_detectado: email.rut_detectado,
      nombre_detectado: email.nombre_detectado,
      banco: email.banco,
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
