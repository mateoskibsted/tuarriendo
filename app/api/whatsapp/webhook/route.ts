import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUFValue } from '@/lib/utils/uf'
import { todayInChile } from '@/lib/utils/date'

export async function GET() {
  return new NextResponse('WhatsApp webhook OK', { status: 200 })
}

// ── TwiML helpers ────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function twiml(message: string): NextResponse {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
  return new NextResponse(xml, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
}

function emptyTwiml(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200, headers: { 'Content-Type': 'text/xml' },
  })
}

// ── Phone matching ────────────────────────────────────────────────────────────

function phoneMatch(stored: string, incoming: string): boolean {
  const s = stored.replace(/\D/g, '')
  const i = incoming.replace(/\D/g, '')
  if (!s || !i) return false
  return s === i || i.endsWith(s) || s.endsWith(i)
}

// ── Formatting ────────────────────────────────────────────────────────────────

async function formatMonto(valorUf: number, moneda: string): Promise<string> {
  if (moneda === 'CLP') {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(valorUf)
  }
  try {
    const uf = await getUFValue()
    const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Math.round(valorUf * uf))
    return `${valorUf.toFixed(2)} UF (${clp})`
  } catch {
    return `${valorUf.toFixed(2)} UF`
  }
}

function estadoPagoTexto(diaPago: number): string {
  const hoy = todayInChile()
  const [y, m] = [hoy.getFullYear(), hoy.getMonth()]
  const venc = new Date(y, m, diaPago)
  if (hoy <= venc) {
    const dias = Math.ceil((venc.getTime() - hoy.getTime()) / 86400000)
    const mesNombre = venc.toLocaleDateString('es-CL', { month: 'long' })
    return `Proximo pago: dia ${diaPago} de ${mesNombre} (faltan ${dias} dias)`
  }
  const dias = Math.floor((hoy.getTime() - venc.getTime()) / 86400000)
  return `ATENCION: llevas ${dias} dia${dias !== 1 ? 's' : ''} de atraso desde el dia ${diaPago}`
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Parse Twilio form-encoded body
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

  // Normalize message: remove accents, uppercase
  const msgUp = msgRaw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const esSi = msgUp === 'SI' || msgUp === 'S'
  const esNo = msgUp === 'NO' || msgUp === 'N'

  const admin = createAdminClient()

  try {
    // ── 1. Check informal arrendatarios (propiedades) ──────────────────────

    const { data: propiedades } = await admin
      .from('propiedades')
      .select('id, nombre, dia_vencimiento, valor_uf, moneda, arrendatario_informal_nombre, arrendatario_informal_celular, arrendatario_informal_cobro_tipo, arrendatario_informal_fecha_inicio, arrendatario_informal_fecha_fin')
      .eq('activa', true)
      .not('arrendatario_informal_celular', 'is', null)

    const propiedadMatch = (propiedades ?? []).find(p =>
      phoneMatch(p.arrendatario_informal_celular as string ?? '', fromRaw)
    )

    if (propiedadMatch) {
      return await handleInformal(propiedadMatch, msgUp, esSi, esNo, admin)
    }

    // ── 2. Check formal arrendatarios (profiles) ───────────────────────────

    const { data: profiles } = await admin
      .from('profiles')
      .select('id, nombre, telefono')
      .not('telefono', 'is', null)

    const profileMatch = (profiles ?? []).find(p =>
      phoneMatch(p.telefono as string ?? '', fromRaw)
    )

    if (profileMatch) {
      return await handleFormal(profileMatch, msgUp, esSi, esNo, admin)
    }

    // ── 3. Unknown number ──────────────────────────────────────────────────
    return twiml('Tu numero no esta registrado en el sistema. Contacta a tu arrendador.')
  } catch (err) {
    console.error('Webhook error:', err)
    return twiml('Error interno. Intenta de nuevo en un momento.')
  }
}

// ── Informal arrendatario handler ─────────────────────────────────────────────

async function handleInformal(
  propiedad: Record<string, unknown>,
  msgUp: string,
  esSi: boolean,
  esNo: boolean,
  admin: ReturnType<typeof createAdminClient>,
): Promise<NextResponse> {
  const nombre = (propiedad.arrendatario_informal_nombre as string | null) ?? 'arrendatario'
  const dia = (propiedad.dia_vencimiento as number | null) ?? 5
  const propNombre = propiedad.nombre as string
  const valorUf = propiedad.valor_uf as number
  const moneda = propiedad.moneda as string

  if (esSi) {
    await admin.from('propiedades').update({ whatsapp_estado: 'confirmado' }).eq('id', propiedad.id as string)

    const montoTexto = await formatMonto(valorUf, moneda)
    const estadoTexto = estadoPagoTexto(dia)
    const cobroTipo = propiedad.arrendatario_informal_cobro_tipo === 'atrasado' ? 'mes vencido' : 'mes adelantado'

    let duracion = ''
    const fechaFin = propiedad.arrendatario_informal_fecha_fin as string | null
    if (fechaFin) {
      const fin = new Date(fechaFin + 'T12:00:00')
      const hoy = todayInChile()
      const meses = (fin.getFullYear() - hoy.getFullYear()) * 12 + (fin.getMonth() - hoy.getMonth())
      duracion = `\nContrato hasta: ${fin.toLocaleDateString('es-CL')}${meses > 0 ? ` (${meses} meses restantes)` : ' (vencido)'}`
    }

    return twiml(
      `Listo, ${nombre}! Quedaste conectado a los recordatorios de ${propNombre}.\n\n` +
      `Arriendo: ${montoTexto}/mes\n` +
      `Vencimiento: dia ${dia} de cada mes\n` +
      `Cobro: ${cobroTipo}` +
      duracion +
      `\n\n${estadoTexto}`
    )
  }

  if (esNo) {
    await admin.from('propiedades').update({ whatsapp_estado: 'rechazado' }).eq('id', propiedad.id as string)
    return twiml(`Entendido, ${nombre}. Tu decision fue registrada y sera comunicada a tu arrendador.`)
  }

  return twiml(
    `Hola ${nombre}! Soy el asistente de arriendos de ${propNombre}.\n\n` +
    `Responde *Si* para confirmar que quieres recibir recordatorios de pago, o *No* para rechazarlos.`
  )
}

// ── Formal arrendatario handler ───────────────────────────────────────────────

async function handleFormal(
  profile: { id: string; nombre: string; telefono: string },
  msgUp: string,
  esSi: boolean,
  esNo: boolean,
  admin: ReturnType<typeof createAdminClient>,
): Promise<NextResponse> {
  const nombre = profile.nombre.split(' ')[0]

  // Find active contracts for this arrendatario
  const { data: contratos } = await admin
    .from('contratos')
    .select('id, propiedad_id, dia_pago, propiedades(nombre, valor_uf, moneda)')
    .eq('arrendatario_id', profile.id)
    .eq('activo', true)

  if (!contratos || contratos.length === 0) {
    return twiml(`Hola ${nombre}! No tienes contratos activos en el sistema. Contacta a tu arrendador.`)
  }

  // Current period
  const hoy = todayInChile()
  const periodoActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`

  if (esSi || (!esNo && msgUp !== '')) {
    // Build payment status for each property
    const lineas: string[] = []

    for (const contrato of contratos) {
      const prop = (contrato as unknown as { propiedades: { nombre: string; valor_uf: number; moneda: string } }).propiedades
      if (!prop) continue

      const diaPago = (contrato as unknown as { dia_pago: number }).dia_pago ?? 5

      // Check if already paid this period
      const { data: pago } = await admin
        .from('pagos')
        .select('estado, fecha_pago')
        .eq('contrato_id', contrato.id)
        .eq('periodo', periodoActual)
        .maybeSingle()

      const montoTexto = await formatMonto(prop.valor_uf, prop.moneda)
      const estadoTexto = estadoPagoTexto(diaPago)

      if (pago && (pago.estado === 'pagado' || pago.estado === 'atrasado')) {
        const fechaPago = pago.fecha_pago ? new Date(pago.fecha_pago).toLocaleDateString('es-CL') : 'fecha no registrada'
        lineas.push(`${prop.nombre}: PAGADO el ${fechaPago}`)
      } else {
        lineas.push(`${prop.nombre}: ${montoTexto}/mes\n  ${estadoTexto}`)
      }
    }

    // Log the interaction
    if (esSi) {
      for (const contrato of contratos) {
        await admin.from('notificaciones_log').insert({
          contrato_id: contrato.id,
          tipo: 'confirmacion_whatsapp',
          periodo: periodoActual,
          mensaje: `${nombre} respondio SI al bot de WhatsApp`,
          exitosa: true,
        })
      }
    }

    return twiml(
      `Hola ${nombre}! Aqui tienes el estado de tus arriendos:\n\n` +
      lineas.join('\n\n') +
      `\n\nResponde *No* si no quieres recibir mas recordatorios.`
    )
  }

  if (esNo) {
    // Log refusal
    for (const contrato of contratos) {
      await admin.from('notificaciones_log').insert({
        contrato_id: contrato.id,
        tipo: 'rechazo_whatsapp',
        periodo: periodoActual,
        mensaje: `${nombre} respondio NO al bot de WhatsApp`,
        exitosa: true,
      })
    }
    return twiml(`Entendido, ${nombre}. No te enviaremos mas recordatorios por WhatsApp. Puedes cambiar esto contactando a tu arrendador.`)
  }

  // Unknown message — help text
  return twiml(
    `Hola ${nombre}! Soy el asistente de arriendos.\n\n` +
    `Responde *Si* para ver el estado de tus pagos, o *No* para dejar de recibir recordatorios.`
  )
}
