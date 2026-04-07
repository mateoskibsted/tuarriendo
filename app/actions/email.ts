'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { google } from 'googleapis'
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
    `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/gmail/callback`
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

  // Load stored Gmail connection
  const { data: connection } = await admin
    .from('email_connections')
    .select('*')
    .eq('arrendador_id', user.id)
    .single()

  if (!connection) return { error: 'No hay correo conectado' }

  // Load arrendatarios linked to this arrendador
  const { data: propiedades } = await admin
    .from('propiedades')
    .select('id')
    .eq('arrendador_id', user.id)
    .eq('activa', true)

  const propiedadIds = (propiedades ?? []).map((p: { id: string }) => p.id)
  if (propiedadIds.length === 0) return { sugerencias: [] }

  const { data: contratos } = await admin
    .from('contratos')
    .select('id, propiedad_id, propiedades(nombre), profiles!contratos_arrendatario_id_fkey(nombre, rut)')
    .in('propiedad_id', propiedadIds)
    .eq('activo', true)

  const oauth2Client = buildOAuthClient(connection)

  // Refresh token in DB if googleapis refreshes it automatically
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
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 30,
    })
    messageList = res.data.messages ?? []
  } catch {
    return { error: 'Error al leer correos. Reconecta tu cuenta de Gmail.' }
  }

  const sugerencias: PagoSugerido[] = []
  const periodoActual = new Date().toISOString().slice(0, 7) // YYYY-MM

  for (const msg of messageList) {
    if (!msg.id) continue

    let msgData
    try {
      const res = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      })
      msgData = res.data
    } catch {
      continue
    }

    const headers = msgData.payload?.headers ?? []
    const subject = headers.find(h => h.name === 'Subject')?.value ?? ''
    const dateHeader = headers.find(h => h.name === 'Date')?.value ?? ''
    const body = extractTextFromPayload(msgData.payload ?? {})

    const parsed = parseEmailForPayment(subject, body)
    if (!parsed.monto_clp) continue // Skip emails without a detectable amount

    // Try to match with an arrendatario
    let contratoId: string | undefined
    let arrendatarioNombre: string | undefined
    let propiedadNombre: string | undefined
    let confianza: PagoSugerido['confianza'] = 'baja'

    for (const contrato of contratos ?? []) {
      const profile = (contrato as unknown as { profiles?: { nombre: string; rut: string } }).profiles
      const propiedad = (contrato as unknown as { propiedades?: { nombre: string } }).propiedades
      if (!profile) continue

      // Normalize RUT for comparison (remove dots and dash)
      const arrendatarioRut = profile.rut.replace(/\./g, '').replace('-', '').toUpperCase()

      if (parsed.rut && parsed.rut === arrendatarioRut) {
        contratoId = contrato.id
        arrendatarioNombre = profile.nombre
        propiedadNombre = propiedad?.nombre
        confianza = 'alta'
        break
      }

      if (
        parsed.nombre &&
        profile.nombre.toLowerCase().includes(parsed.nombre.toLowerCase().split(' ')[0])
      ) {
        contratoId = contrato.id
        arrendatarioNombre = profile.nombre
        propiedadNombre = propiedad?.nombre
        confianza = 'media'
        // Don't break — keep looking for a RUT match
      }
    }

    sugerencias.push({
      emailId: msg.id,
      fecha: dateHeader,
      asunto: subject,
      monto_clp: parsed.monto_clp,
      rut_detectado: parsed.rut,
      nombre_detectado: parsed.nombre,
      banco: parsed.banco,
      contrato_id: contratoId,
      arrendatario_nombre: arrendatarioNombre,
      propiedad_nombre: propiedadNombre,
      confianza,
      periodo: periodoActual,
    })
  }

  // Sort: high confidence first
  sugerencias.sort((a, b) => {
    const order = { alta: 0, media: 1, baja: 2 }
    return order[a.confianza] - order[b.confianza]
  })

  return { sugerencias }
}

export async function confirmarPagoEmail(
  contratoId: string,
  montoCLP: number,
  periodo: string,
) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  // Verify this contract belongs to this arrendador
  const { data: contrato } = await admin
    .from('contratos')
    .select('id, propiedad_id, propiedades(arrendador_id)')
    .eq('id', contratoId)
    .single()

  const arrendadorId = (contrato as unknown as { propiedades?: { arrendador_id: string } } | null)
    ?.propiedades?.arrendador_id

  if (!contrato || arrendadorId !== user.id) return { error: 'No autorizado' }

  // Upsert payment for the period
  const { data: existing } = await admin
    .from('pagos')
    .select('id')
    .eq('contrato_id', contratoId)
    .eq('periodo', periodo)
    .single()

  const payload = {
    contrato_id: contratoId,
    periodo,
    valor_uf: 0, // Will be 0 for CLP-only payments from email
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
