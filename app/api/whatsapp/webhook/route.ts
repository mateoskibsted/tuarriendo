import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUFValue } from '@/lib/utils/uf'

export async function GET() {
  return new NextResponse('WhatsApp webhook OK', { status: 200 })
}

function twiml(message: string): NextResponse {
  // Escape XML special chars manually instead of CDATA (more compatible)
  const safe = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`
  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

function emptyTwiml(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

function phoneMatch(stored: string, incoming: string): boolean {
  const s = stored.replace(/\D/g, '')
  const i = incoming.replace(/\D/g, '')
  if (!s || !i) return false
  // Match exact, or one is a suffix of the other (handles country code difference)
  return s === i || i.endsWith(s) || s.endsWith(i)
}

export async function POST(req: NextRequest) {
  let fromRaw = ''
  let msgRaw = ''

  try {
    const formData = await req.formData()
    fromRaw = (formData.get('From') as string ?? '').replace('whatsapp:', '').replace(/\s/g, '')
    msgRaw = (formData.get('Body') as string ?? '').trim()
  } catch {
    try {
      const text = await req.text()
      for (const pair of text.split('&')) {
        const idx = pair.indexOf('=')
        if (idx === -1) continue
        const k = decodeURIComponent(pair.slice(0, idx))
        const v = decodeURIComponent(pair.slice(idx + 1)).replace(/\+/g, ' ')
        if (k === 'From') fromRaw = v.replace('whatsapp:', '').replace(/\s/g, '')
        if (k === 'Body') msgRaw = v.trim()
      }
    } catch {
      return twiml('Error al procesar el mensaje.')
    }
  }

  if (!fromRaw) return emptyTwiml()

  const msgUp = msgRaw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  try {
    const admin = createAdminClient()

    const { data: propiedades } = await admin
      .from('propiedades')
      .select('id, nombre, dia_vencimiento, valor_uf, moneda, arrendatario_informal_nombre, arrendatario_informal_celular, arrendatario_informal_cobro_tipo, arrendatario_informal_fecha_inicio, arrendatario_informal_fecha_fin')
      .eq('activa', true)
      .not('arrendatario_informal_celular', 'is', null)

    const propiedad = (propiedades ?? []).find(p =>
      phoneMatch(p.arrendatario_informal_celular as string ?? '', fromRaw)
    )

    if (!propiedad) return twiml('Numero no registrado en el sistema. Contacta a tu arrendador.')

    const nombre = (propiedad.arrendatario_informal_nombre as string | null) ?? 'arrendatario'
    const dia = (propiedad.dia_vencimiento as number | null) ?? 5
    const propNombre = propiedad.nombre as string

    if (msgUp === 'SI' || msgUp === 'S') {
      await admin.from('propiedades').update({ whatsapp_estado: 'confirmado' }).eq('id', propiedad.id)

      const hoy = new Date()
      const este = new Date(hoy.getFullYear(), hoy.getMonth(), dia)
      const prox = new Date(hoy.getFullYear(), hoy.getMonth() + 1, dia)
      const fechaRef = este >= hoy ? este : prox
      const dias = Math.ceil((fechaRef.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
      const mesNombre = fechaRef.toLocaleDateString('es-CL', { month: 'long' })

      const valorUf = propiedad.valor_uf as number
      const moneda = propiedad.moneda as string
      let montoTexto = `${valorUf} ${moneda}`
      if (moneda !== 'CLP') {
        try {
          const uf = await getUFValue()
          const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Math.round(valorUf * uf))
          montoTexto = `${valorUf.toFixed(2)} UF (${clp})`
        } catch { /* keep default */ }
      } else {
        montoTexto = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(valorUf)
      }

      const fechaInicio = propiedad.arrendatario_informal_fecha_inicio as string | null
      const fechaFin = propiedad.arrendatario_informal_fecha_fin as string | null
      let duracion = ''
      if (fechaInicio && fechaFin) {
        const fin = new Date(fechaFin + 'T12:00:00')
        const meses = (fin.getFullYear() - hoy.getFullYear()) * 12 + (fin.getMonth() - hoy.getMonth())
        duracion = `\nContrato hasta: ${fin.toLocaleDateString('es-CL')}`
        duracion += meses > 0 ? ` (${meses} meses restantes)` : ' (vencido)'
      }

      const cobroTipo = propiedad.arrendatario_informal_cobro_tipo === 'atrasado' ? 'mes vencido' : 'mes adelantado'

      const estadoPago = dias <= 0
        ? `\n\nATENCION: llevas ${Math.abs(dias)} dias de atraso desde el dia ${dia} de ${new Date(hoy.getFullYear(), hoy.getMonth(), 1).toLocaleDateString('es-CL', { month: 'long' })}.`
        : `\n\nProximo pago: faltan ${dias} dias - vence el dia ${dia} de ${mesNombre}.`

      return twiml(
        `Listo, ${nombre}! Quedaste conectado a los recordatorios de ${propNombre}.\n\n` +
        `Arriendo mensual: ${montoTexto}\n` +
        `Dia de vencimiento: dia ${dia} de cada mes\n` +
        `Tipo de cobro: ${cobroTipo}` +
        duracion + estadoPago
      )
    }

    if (msgUp === 'NO' || msgUp === 'N') {
      await admin.from('propiedades').update({ whatsapp_estado: 'rechazado' }).eq('id', propiedad.id)
      return twiml(`Entendido, ${nombre}. Tu decision fue registrada y sera comunicada a tu arrendador.`)
    }

    return twiml(`Hola ${nombre}! Responde Si para confirmar o No para rechazar los recordatorios de ${propNombre}.`)
  } catch (err) {
    console.error('Webhook error:', err)
    return twiml('Error interno. Intenta de nuevo.')
  }
}
