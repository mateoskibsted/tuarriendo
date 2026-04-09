import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUFValue } from '@/lib/utils/uf'

export async function GET() {
  return new NextResponse('WhatsApp webhook OK', { status: 200 })
}

function twiml(message: string): NextResponse {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message><![CDATA[${message}]]></Message></Response>`
  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null)
  const text = formData
    ? Object.fromEntries(formData.entries()) as Record<string, string>
    : {}

  const fromRaw = (text['From'] ?? '').replace('whatsapp:', '').replace(/\s/g, '')
  const msgRaw = (text['Body'] ?? '').trim()
  const msgUp = msgRaw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // DEBUG: respond immediately so we know webhook is being called
  return twiml(`DEBUG: From=${fromRaw} Body=${msgRaw}`)

  if (!fromRaw) return twiml('Numero no identificado.')

  try {
    const admin = createAdminClient()

    const { data: propiedades } = await admin
      .from('propiedades')
      .select('id, nombre, dia_vencimiento, valor_uf, moneda, arrendatario_informal_nombre, arrendatario_informal_celular, arrendatario_informal_cobro_tipo, arrendatario_informal_fecha_inicio, arrendatario_informal_fecha_fin')
      .eq('activa', true)
      .not('arrendatario_informal_celular', 'is', null)

    const propiedad = (propiedades ?? []).find(p => {
      const stored = (p.arrendatario_informal_celular ?? '').replace(/\D/g, '')
      const incoming = fromRaw.replace(/\D/g, '')
      return stored === incoming
    })

    if (!propiedad) {
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    const nombre = propiedad.arrendatario_informal_nombre ?? 'arrendatario'
    const dia = propiedad.dia_vencimiento ?? 5

    if (msgUp === 'SI' || msgUp === 'S') {
      await admin.from('propiedades').update({ whatsapp_estado: 'confirmado' }).eq('id', propiedad.id)

      // Days until payment
      const hoy = new Date()
      const este = new Date(hoy.getFullYear(), hoy.getMonth(), dia)
      const prox = new Date(hoy.getFullYear(), hoy.getMonth() + 1, dia)
      const fechaRef = este >= hoy ? este : prox
      const dias = Math.ceil((fechaRef.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
      const mesNombre = fechaRef.toLocaleDateString('es-CL', { month: 'long' })

      let montoTexto = `${propiedad.valor_uf} ${propiedad.moneda}`
      if (propiedad.moneda !== 'CLP') {
        try {
          const uf = await getUFValue()
          const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Math.round(propiedad.valor_uf * uf))
          montoTexto = `${propiedad.valor_uf.toFixed(2)} UF (${clp})`
        } catch { /* fallback to UF only */ }
      } else {
        montoTexto = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(propiedad.valor_uf)
      }

      let duracion = ''
      if (propiedad.arrendatario_informal_fecha_inicio && propiedad.arrendatario_informal_fecha_fin) {
        const fin = new Date(propiedad.arrendatario_informal_fecha_fin + 'T12:00:00')
        const meses = (fin.getFullYear() - hoy.getFullYear()) * 12 + (fin.getMonth() - hoy.getMonth())
        duracion = `\nContrato hasta: ${fin.toLocaleDateString('es-CL')}`
        duracion += meses > 0 ? ` (${meses} meses restantes)` : ' (vencido)'
      }

      const estadoPago = dias <= 0
        ? `\n\nATENCION: llevas ${Math.abs(dias)} dias de atraso desde el dia ${dia} de ${new Date(hoy.getFullYear(), hoy.getMonth(), 1).toLocaleDateString('es-CL', { month: 'long' })}.`
        : `\n\nProximo pago: faltan ${dias} dias - vence el dia ${dia} de ${mesNombre}.`

      return twiml(
        `Listo, ${nombre}! Quedaste conectado a los recordatorios de ${propiedad.nombre}.\n\n` +
        `Arriendo mensual: ${montoTexto}\n` +
        `Dia de vencimiento: dia ${dia} de cada mes\n` +
        `Tipo de cobro: ${propiedad.arrendatario_informal_cobro_tipo === 'atrasado' ? 'mes vencido' : 'mes adelantado'}` +
        duracion + estadoPago
      )
    }

    if (msgUp === 'NO' || msgUp === 'N') {
      await admin.from('propiedades').update({ whatsapp_estado: 'rechazado' }).eq('id', propiedad.id)
      return twiml(`Entendido, ${nombre}. Tu decision fue registrada y sera comunicada a tu arrendador.`)
    }

    return twiml(`Hola ${nombre}! Responde SI para confirmar o NO para rechazar los recordatorios de ${propiedad.nombre}.`)
  } catch (err) {
    console.error('Webhook error:', err)
    return twiml('Error interno. Intenta de nuevo.')
  }
}
