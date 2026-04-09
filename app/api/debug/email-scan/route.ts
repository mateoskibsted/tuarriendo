import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { google } from 'googleapis'
import { extractTextFromPayload, decodeBase64Url } from '@/lib/utils/email-parser'

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
  // Simple auth: only allow in dev or with secret
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

  // Query usada en producción
  const query = 'subject:(transferencia OR depósito OR deposito OR abono OR "pago recibido") newer_than:30d'

  let messageList: Array<{ id?: string | null; threadId?: string | null }> = []
  try {
    const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 30 })
    messageList = res.data.messages ?? []
  } catch (e) {
    return NextResponse.json({ error: 'Error Gmail', detail: String(e) })
  }

  // También buscar sin filtro para ver cuántos hay en total
  const resAll = await gmail.users.messages.list({ userId: 'me', q: 'newer_than:7d', maxResults: 10 })
  const totalRecent = resAll.data.messages?.length ?? 0

  const emails = []
  for (const msg of messageList.slice(0, 10)) {
    if (!msg.id) continue
    try {
      const res = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' })
      const headers = res.data.payload?.headers ?? []
      const subject = headers.find(h => h.name === 'Subject')?.value ?? ''
      const from = headers.find(h => h.name === 'From')?.value ?? ''
      const date = headers.find(h => h.name === 'Date')?.value ?? ''

      const plainText = extractTextFromPayload(res.data.payload ?? {})

      // Same logic as escanearEmails
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

      emails.push({
        subject,
        from,
        date,
        plainTextLength: plainText.length,
        rawContentPreview: rawContent.slice(0, 500),
      })
    } catch {
      continue
    }
  }

  // Load tenants (formal + informal)
  const { data: propiedades } = await admin
    .from('propiedades')
    .select('id')
    .eq('arrendador_id', user.id)
    .eq('activa', true)

  const propiedadIds = (propiedades ?? []).map((p: { id: string }) => p.id)

  const { data: contratos } = await admin
    .from('contratos')
    .select('id, profiles!contratos_arrendatario_id_fkey(nombre, rut)')
    .in('propiedad_id', propiedadIds)
    .eq('activo', true)

  const { data: informales } = await admin
    .from('propiedades')
    .select('id, nombre, arrendatario_informal_nombre, arrendatario_informal_rut')
    .in('id', propiedadIds)
    .not('arrendatario_informal_nombre', 'is', null)

  return NextResponse.json({
    gmail_connected_as: connection.email,
    emails_found_with_query: messageList.length,
    total_recent_emails_7d: totalRecent,
    query_used: query,
    formal_tenants: (contratos ?? []).map((c: unknown) => {
      const co = c as { id: string; profiles?: { nombre: string; rut: string } }
      return { contratoId: co.id, nombre: co.profiles?.nombre }
    }),
    informal_tenants: (informales ?? []).map((p: { id: string; nombre: string; arrendatario_informal_nombre: string; arrendatario_informal_rut: string }) => ({
      propiedadId: p.id,
      propiedadNombre: p.nombre,
      arrendatario: p.arrendatario_informal_nombre,
      rut: p.arrendatario_informal_rut,
    })),
    emails_parsed: emails,
  })
}
