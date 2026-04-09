import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviarWhatsApp, formatWhatsAppNumber } from '@/lib/utils/twilio'

// Parse Twilio's URL-encoded body
async function parseTwilioBody(req: NextRequest): Promise<Record<string, string>> {
  const text = await req.text()
  const params: Record<string, string> = {}
  for (const pair of text.split('&')) {
    const [key, val] = pair.split('=')
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(val ?? '').replace(/\+/g, ' ')
  }
  return params
}

function twimlResponse(message: string): NextResponse {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
  return new NextResponse(xml, { headers: { 'Content-Type': 'text/xml' } })
}

export async function POST(req: NextRequest) {
  const body = await parseTwilioBody(req)
  const fromRaw = body['From'] ?? '' // e.g. "whatsapp:+56912345678"
  const messageBody = (body['Body'] ?? '').trim().toUpperCase()

  // Extract E.164 phone from Twilio's "whatsapp:+XXXXXXXXXXX"
  const phone = fromRaw.replace('whatsapp:', '')
  if (!phone) return new NextResponse('', { status: 400 })

  const admin = createAdminClient()

  // Find propiedad with this arrendatario celular
  // normalizePhone stores as +56XXXXXXXXX — we match by comparing normalized forms
  const { data: propiedades } = await admin
    .from('propiedades')
    .select('id, nombre, dia_vencimiento, arrendatario_informal_nombre, arrendatario_informal_celular, whatsapp_estado')
    .eq('activa', true)
    .not('arrendatario_informal_celular', 'is', null)

  const propiedad = (propiedades ?? []).find(p => {
    const stored = (p.arrendatario_informal_celular ?? '').replace(/\D/g, '')
    const incoming = phone.replace(/\D/g, '')
    return stored === incoming
  })

  if (!propiedad) {
    // Unknown sender — don't respond with anything meaningful
    return new NextResponse('', { status: 200 })
  }

  const nombre = propiedad.arrendatario_informal_nombre ?? 'arrendatario'
  const diaVencimiento = propiedad.dia_vencimiento ?? 5

  if (messageBody === 'SI' || messageBody === 'SÍ' || messageBody === 'S') {
    await admin
      .from('propiedades')
      .update({ whatsapp_estado: 'confirmado' })
      .eq('id', propiedad.id)

    return twimlResponse(
      `¡Perfecto, ${nombre}! 🎉 Ya estás conectado. Recibirás recordatorios de pago del arriendo de *${propiedad.nombre}*. Tu vencimiento es el día *${diaVencimiento}* de cada mes.`
    )
  }

  if (messageBody === 'NO' || messageBody === 'N') {
    await admin
      .from('propiedades')
      .update({ whatsapp_estado: 'rechazado' })
      .eq('id', propiedad.id)

    return twimlResponse(
      `Entendido. Tu decisión será transmitida a tu arrendador. Si cambias de opinión, puedes contactarlo directamente.`
    )
  }

  // Message not recognized — gentle prompt
  return twimlResponse(
    `Responde *SI* para confirmar o *NO* para rechazar los recordatorios de arriendo de *${propiedad.nombre}*.`
  )
}
