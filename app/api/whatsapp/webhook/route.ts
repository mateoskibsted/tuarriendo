import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUFValue } from '@/lib/utils/uf'

export async function GET() {
  return new NextResponse('WhatsApp webhook OK', { status: 200 })
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
  const fechaRef = este >= hoy ? este : prox
  const dias = Math.ceil((fechaRef.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
  const mesNombre = fechaRef.toLocaleDateString('es-CL', { month: 'long' })
  if (dias === 0) return { dias: 0, texto: `hoy vence (dia ${diaVencimiento} de ${mesNombre})` }
  if (dias > 0) return { dias, texto: `faltan *${dias} dias* - vence el ${diaVencimiento} de ${mesNombre}` }
  return { dias, texto: `llevas *${Math.abs(dias)} dias de atraso* desde el ${diaVencimiento} de ${mesNombre}` }
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
  // Parse URL-encoded body from Twilio
  let body: Record<string, string> = {}
  try {
    const text = await req.text()
    for (const pair of text.split('&')) {
      const idx = pair.indexOf('=')
      if (idx === -1) continue
      body[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1)).replace(/\+/g, ' ')
    }
  } catch {
    return twiml('Error al procesar mensaje.')
  }

  const fromRaw = body['From'] ?? ''
  const phone = fromRaw.replace('whatsapp:', '').replace(/\s/g, '')
  const messageBody = (body['Body'] ?? '').trim().toUpperCase()

  if (!phone) return twiml('Numero no identificado.')

  try {
    const admin = createAdminClient()

    const { data: propiedades } = await admin
      .from('propiedades')
      .select('id, nombre, dia_vencimiento, valor_uf, moneda, arrendatario_informal_nombre, arrendatario_informal_celular, arrendatario_informal_cobro_tipo, arrendatario_informal_fecha_inicio, arrendatario_informal_fecha_fin')
      .eq('activa', true)
      .not('arrendatario_informal_celular', 'is', null)

    const propiedad = (propiedades ?? []).find(p => {
      const stored = (p.arrendatario_informal_celular ?? '').replace(/\D/g, '')
      const incoming = phone.replace(/\D/g, '')
      return stored === incoming
    })

    if (!propiedad) {
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    const nombre = propiedad.arrendatario_informal_nombre ?? 'arrendatario'
    const diaVencimiento = propiedad.dia_vencimiento ?? 5

    // Normalize: remove accents, uppercase
    const msgNorm = messageBody.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    if (msgNorm === 'SI' || msgNorm === 'S') {
      await admin.from('propiedades').update({ whatsapp_estado: 'confirmado' }).eq('id', propiedad.id)

      const { texto: diasTexto, dias } = diasHastaVencimiento(diaVencimiento)

      let montoTexto = `${propiedad.valor_uf} ${propiedad.moneda}`
      if (propiedad.moneda === 'CLP') {
        montoTexto = formatCLPLocal(propiedad.valor_uf)
      } else {
        try {
          const ufVal = await getUFValue()
          const clp = Math.round(propiedad.valor_uf * ufVal)
          montoTexto = `${propiedad.valor_uf.toFixed(2)} UF (${formatCLPLocal(clp)})`
        } catch { /* keep default */ }
      }

      const cobroTipo = propiedad.arrendatario_informal_cobro_tipo === 'atrasado'
        ? 'mes vencido'
        : 'mes adelantado'

      let duracion = ''
      if (propiedad.arrendatario_informal_fecha_inicio && propiedad.arrendatario_informal_fecha_fin) {
        const fin = new Date(propiedad.arrendatario_informal_fecha_fin + 'T12:00:00')
        const hoy = new Date()
        const meses = (fin.getFullYear() - hoy.getFullYear()) * 12 + (fin.getMonth() - hoy.getMonth())
        duracion = `\nContrato: ${formatFecha(propiedad.arrendatario_informal_fecha_inicio)} al ${formatFecha(propiedad.arrendatario_informal_fecha_fin)}`
        duracion += meses > 0 ? `\nDuracion restante: ${meses} meses` : '\nAtencion: contrato vencido'
      }

      const pago = dias < 0
        ? `\n\nATENCION: ${diasTexto}. Regulariza tu situacion.`
        : `\n\nProximo pago: ${diasTexto}.`

      return twiml(
        `Listo, ${nombre}! Quedaste conectado a los recordatorios de *${propiedad.nombre}*.\n\n` +
        `Arriendo: *${montoTexto}*\n` +
        `Vencimiento: *dia ${diaVencimiento}* de cada mes\n` +
        `Cobro: ${cobroTipo}` +
        duracion + pago
      )
    }

    if (msgNorm === 'NO' || msgNorm === 'N') {
      await admin.from('propiedades').update({ whatsapp_estado: 'rechazado' }).eq('id', propiedad.id)
      return twiml(`Entendido, ${nombre}. Tu decision fue registrada y sera comunicada a tu arrendador.`)
    }

    return twiml(
      `Hola ${nombre}! Responde *SI* para confirmar o *NO* para rechazar los recordatorios de *${propiedad.nombre}*.`
    )
  } catch (err) {
    console.error('Webhook error:', err)
    return twiml('Error interno. Intenta de nuevo.')
  }
}
