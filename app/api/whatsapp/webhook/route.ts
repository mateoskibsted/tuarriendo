import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUFValue } from '@/lib/utils/uf'

async function parseTwilioBody(req: NextRequest): Promise<Record<string, string>> {
  const text = await req.text()
  const params: Record<string, string> = {}
  for (const pair of text.split('&')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const key = decodeURIComponent(pair.slice(0, idx))
    const val = decodeURIComponent(pair.slice(idx + 1)).replace(/\+/g, ' ')
    params[key] = val
  }
  return params
}

function twiml(message: string): NextResponse {
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`
  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

function diasHastaVencimiento(diaVencimiento: number): { dias: number; texto: string } {
  const hoy = new Date()
  const este = new Date(hoy.getFullYear(), hoy.getMonth(), diaVencimiento)
  const prox = new Date(hoy.getFullYear(), hoy.getMonth() + 1, diaVencimiento)

  // Use current month's date if it hasn't passed yet, else next month
  const fechaRef = este >= hoy ? este : prox
  const dias = Math.ceil((fechaRef.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))

  const mesNombre = fechaRef.toLocaleDateString('es-CL', { month: 'long' })
  if (dias === 0) return { dias: 0, texto: `hoy vence (${diaVencimiento} de ${mesNombre})` }
  if (dias > 0) return { dias, texto: `faltan *${dias} días* — vence el ${diaVencimiento} de ${mesNombre}` }
  return { dias, texto: `llevas *${Math.abs(dias)} días de atraso* desde el ${diaVencimiento} de ${mesNombre}` }
}

function formatFecha(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-CL', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function formatCLPLocal(n: number): string {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseTwilioBody(req)
    const fromRaw = body['From'] ?? ''
    const messageBody = (body['Body'] ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    const phone = fromRaw.replace('whatsapp:', '')
    if (!phone) return new NextResponse('', { status: 400 })

    const admin = createAdminClient()

    const { data: propiedades } = await admin
      .from('propiedades')
      .select('id, nombre, dia_vencimiento, valor_uf, moneda, arrendatario_informal_nombre, arrendatario_informal_celular, arrendatario_informal_cobro_tipo, arrendatario_informal_fecha_inicio, arrendatario_informal_fecha_fin, whatsapp_estado')
      .eq('activa', true)
      .not('arrendatario_informal_celular', 'is', null)

    const propiedad = (propiedades ?? []).find(p => {
      const stored = (p.arrendatario_informal_celular ?? '').replace(/\D/g, '')
      const incoming = phone.replace(/\D/g, '')
      return stored === incoming
    })

    if (!propiedad) return new NextResponse('', { status: 200 })

    const nombre = propiedad.arrendatario_informal_nombre ?? 'arrendatario'
    const diaVencimiento = propiedad.dia_vencimiento ?? 5

    if (messageBody === 'SI' || messageBody === 'S') {
      await admin
        .from('propiedades')
        .update({ whatsapp_estado: 'confirmado' })
        .eq('id', propiedad.id)

      // Build detailed welcome message
      const { dias, texto: diasTexto } = diasHastaVencimiento(diaVencimiento)

      // Format rent amount
      let montoTexto = ''
      if (propiedad.moneda === 'CLP') {
        montoTexto = formatCLPLocal(propiedad.valor_uf)
      } else {
        try {
          const ufVal = await getUFValue()
          const clp = Math.round(propiedad.valor_uf * ufVal)
          montoTexto = `${propiedad.valor_uf.toFixed(2)} UF (${formatCLPLocal(clp)})`
        } catch {
          montoTexto = `${propiedad.valor_uf.toFixed(2)} UF`
        }
      }

      const cobroTipo = propiedad.arrendatario_informal_cobro_tipo === 'atrasado'
        ? 'mes vencido (pagas el mes siguiente)'
        : 'mes adelantado (pagas al inicio del mes)'

      let duracionTexto = ''
      if (propiedad.arrendatario_informal_fecha_inicio && propiedad.arrendatario_informal_fecha_fin) {
        const fin = new Date(propiedad.arrendatario_informal_fecha_fin + 'T12:00:00')
        const hoy = new Date()
        const mesesRestantes = (fin.getFullYear() - hoy.getFullYear()) * 12 + (fin.getMonth() - hoy.getMonth())
        duracionTexto =
          `\n📅 Contrato: ${formatFecha(propiedad.arrendatario_informal_fecha_inicio)} al ${formatFecha(propiedad.arrendatario_informal_fecha_fin)}` +
          (mesesRestantes > 0 ? `\n⏱ Duración restante: ${mesesRestantes} meses` : '\n⚠️ Contrato ya venció')
      } else if (propiedad.arrendatario_informal_fecha_inicio) {
        duracionTexto = `\n📅 Inicio contrato: ${formatFecha(propiedad.arrendatario_informal_fecha_inicio)}`
      }

      const estadoPago = dias < 0
        ? `\n\n⚠️ *Atención:* ${diasTexto}. Por favor regulariza tu situación.`
        : `\n\n✅ Próximo pago: ${diasTexto}.`

      const mensaje =
        `¡Bienvenido, ${nombre}! 🎉 Ya estás conectado a los recordatorios de *${propiedad.nombre}*.\n\n` +
        `💰 Arriendo mensual: *${montoTexto}*\n` +
        `📆 Día de vencimiento: *día ${diaVencimiento}* de cada mes\n` +
        `🔄 Tipo de cobro: ${cobroTipo}` +
        duracionTexto +
        estadoPago

      return twiml(mensaje)
    }

    if (messageBody === 'NO' || messageBody === 'N') {
      await admin
        .from('propiedades')
        .update({ whatsapp_estado: 'rechazado' })
        .eq('id', propiedad.id)

      return twiml(
        `Entendido, ${nombre}. Tu decisión fue registrada y será comunicada a tu arrendador. Si cambias de opinión, puedes contactarlo directamente.`
      )
    }

    // Unrecognized — gentle re-prompt
    return twiml(
      `Hola ${nombre} 👋 Para responder sobre los recordatorios de arriendo de *${propiedad.nombre}*, escribe:\n✅ *SI* para confirmar\n❌ *NO* para rechazar`
    )
  } catch (err) {
    console.error('WhatsApp webhook error:', err)
    // Return empty 200 so Twilio doesn't retry aggressively
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }
}
