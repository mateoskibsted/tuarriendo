import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUFValue } from '@/lib/utils/uf'
import { todayInChile } from '@/lib/utils/date'

export async function GET() {
  return new NextResponse('WhatsApp webhook OK', { status: 200 })
}

// ── TwiML helpers ─────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Send one message via TwiML */
function twiml(message: string): NextResponse {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
  return new NextResponse(xml, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
}

/** Send two messages via TwiML (welcome + daily notification) */
function twimlDos(msg1: string, msg2: string): NextResponse {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(msg1)}</Message><Message>${escapeXml(msg2)}</Message></Response>`
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

function formatCLPLocal(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)
}

/** "10,50 UF ($368.450 CLP)" or "$2 CLP" */
function formatMonto(valorUf: number, moneda: string, ufValue: number): string {
  if (moneda === 'CLP') return `${formatCLPLocal(valorUf)} CLP`
  const clp = formatCLPLocal(Math.round(valorUf * ufValue))
  return `${valorUf.toFixed(2)} UF (${clp} CLP)`
}

// ── Notification message builder (same logic as cron) ────────────────────────

function buildNotificacion(params: {
  nombre: string
  propNombre: string
  diaPago: number
  valorUf: number
  moneda: string
  multaMonto: number | null | undefined
  multaMoneda: string | null | undefined
  ufValue: number
}): string | null {
  const { nombre, propNombre, diaPago, valorUf, moneda, multaMonto, multaMoneda, ufValue } = params
  const hoy = todayInChile()
  const fechaVenc = new Date(hoy.getFullYear(), hoy.getMonth(), diaPago)
  const dias = Math.round((fechaVenc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))

  const montoTexto = formatMonto(valorUf, moneda, ufValue)

  if (dias === 2) {
    return (
      `Hola ${nombre}\n\n` +
      `En 2 dias vence el plazo de pago de tu arriendo de *${propNombre}*.\n\n` +
      `💰 Monto: ${montoTexto}\n\n` +
      `Realiza tu pago a tiempo para evitar multas.`
    )
  }

  if (dias === 1) {
    return (
      `Hola ${nombre}\n\n` +
      `Mañana vence el plazo de pago de tu arriendo de *${propNombre}*.\n\n` +
      `💰 Monto: ${montoTexto}\n\n` +
      `No olvides realizar el pago.`
    )
  }

  if (dias === 0) {
    let multaInfo = ''
    if (multaMonto) {
      const multaDiariaCLP = Math.round(multaMoneda === 'CLP' ? multaMonto : multaMonto * ufValue)
      multaInfo = `\n⚠️ A partir de mañana se aplicará una multa de ${formatCLPLocal(multaDiariaCLP)} CLP por cada día de atraso.`
    }
    return (
      `Hola ${nombre}\n\n` +
      `Hoy vence el plazo de pago de tu arriendo de *${propNombre}*.\n\n` +
      `💰 Monto: ${montoTexto}` +
      multaInfo +
      `\n\nRealiza el pago hoy para evitar multas.`
    )
  }

  if (dias < 0) {
    const diasAtraso = Math.abs(dias)
    let multaTexto = ''
    let totalTexto = ''
    if (multaMonto) {
      const multaDiariaCLP = Math.round(multaMoneda === 'CLP' ? multaMonto : multaMonto * ufValue)
      const multaAcumuladaCLP = multaDiariaCLP * diasAtraso
      const montoPrincipalCLP = moneda === 'CLP' ? valorUf : Math.round(valorUf * ufValue)
      multaTexto = `\n\n⚠️ Multa diaria: ${formatCLPLocal(multaDiariaCLP)} CLP`
      if (diasAtraso > 1) multaTexto += `\n⚠️ Multa acumulada (${diasAtraso} dias): ${formatCLPLocal(multaAcumuladaCLP)} CLP`
      totalTexto = `\n💳 *Total a pagar: ${formatCLPLocal(montoPrincipalCLP + multaAcumuladaCLP)} CLP*`
    }
    return (
      `Hola ${nombre}\n\n` +
      `Tu arriendo de *${propNombre}* lleva *${diasAtraso} dia${diasAtraso !== 1 ? 's' : ''} de atraso*.\n\n` +
      `💰 Monto arriendo: ${montoTexto}` +
      multaTexto +
      totalTexto +
      `\n\nPor favor regulariza tu situacion lo antes posible.`
    )
  }

  return null
}

// ── POST handler ──────────────────────────────────────────────────────────────

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

  const msgUp = msgRaw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const esSi = msgUp === 'SI' || msgUp === 'S'
  const esNo = msgUp === 'NO' || msgUp === 'N'

  const admin = createAdminClient()

  try {
    // ── 1. Informal arrendatarios ──────────────────────────────────────────

    const { data: propiedades } = await admin
      .from('propiedades')
      .select('id, nombre, dia_vencimiento, valor_uf, moneda, multa_monto, multa_moneda, arrendatario_informal_nombre, arrendatario_informal_celular, arrendatario_informal_cobro_tipo, arrendatario_informal_fecha_inicio, arrendatario_informal_fecha_fin')
      .eq('activa', true)
      .not('arrendatario_informal_celular', 'is', null)

    const propiedadMatch = (propiedades ?? []).find(p =>
      phoneMatch(p.arrendatario_informal_celular as string ?? '', fromRaw)
    )

    if (propiedadMatch) {
      return await handleInformal(propiedadMatch, msgUp, esSi, esNo, admin)
    }

    // ── 2. Formal arrendatarios ────────────────────────────────────────────

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

    return twiml('Tu numero no esta registrado en el sistema. Contacta a tu arrendador.')
  } catch (err) {
    console.error('Webhook error:', err)
    return twiml('Error interno. Intenta de nuevo en un momento.')
  }
}

// ── Informal arrendatario handler ─────────────────────────────────────────────

async function handleInformal(
  p: Record<string, unknown>,
  msgUp: string,
  esSi: boolean,
  esNo: boolean,
  admin: ReturnType<typeof createAdminClient>,
): Promise<NextResponse> {
  const nombre = (p.arrendatario_informal_nombre as string | null) ?? 'arrendatario'
  const dia = (p.dia_vencimiento as number | null) ?? 5
  const propNombre = p.nombre as string
  const valorUf = p.valor_uf as number
  const moneda = p.moneda as string
  const multaMonto = p.multa_monto as number | null
  const multaMoneda = p.multa_moneda as string | null

  if (esSi) {
    await admin.from('propiedades').update({ whatsapp_estado: 'confirmado' }).eq('id', p.id as string)

    const ufValue = await getUFValue()
    const montoTexto = formatMonto(valorUf, moneda, ufValue)
    const cobroTipo = p.arrendatario_informal_cobro_tipo === 'atrasado' ? 'mes vencido' : 'mes adelantado'

    // Multa info for welcome message
    let multaInfo = ''
    if (multaMonto) {
      const multaDiariaCLP = Math.round(multaMoneda === 'CLP' ? multaMonto : multaMonto * ufValue)
      multaInfo = `\nMulta por atraso: ${formatCLPLocal(multaDiariaCLP)} CLP/dia`
    }

    let duracion = ''
    const fechaFin = p.arrendatario_informal_fecha_fin as string | null
    if (fechaFin) {
      const fin = new Date(fechaFin + 'T12:00:00')
      const hoy = todayInChile()
      const meses = (fin.getFullYear() - hoy.getFullYear()) * 12 + (fin.getMonth() - hoy.getMonth())
      duracion = `\nContrato hasta: ${fin.toLocaleDateString('es-CL')}${meses > 0 ? ` (${meses} meses restantes)` : ' (vencido)'}`
    }

    const hoy = todayInChile()
    const fechaVenc = new Date(hoy.getFullYear(), hoy.getMonth(), dia)
    const diasRestantes = Math.round((fechaVenc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
    const estadoTexto = diasRestantes >= 0
      ? `Proximo pago: dia ${dia} de cada mes (faltan ${diasRestantes} dias)`
      : `ATENCION: llevas ${Math.abs(diasRestantes)} dia${Math.abs(diasRestantes) !== 1 ? 's' : ''} de atraso desde el dia ${dia}`

    const welcome =
      `Listo, ${nombre}! Quedaste conectado a los recordatorios de ${propNombre}.\n\n` +
      `Arriendo: ${montoTexto}/mes\n` +
      `Vencimiento: dia ${dia} de cada mes\n` +
      `Cobro: ${cobroTipo}` +
      multaInfo +
      duracion +
      `\n\n${estadoTexto}`

    // Check if today is a notification trigger day → send it as second message
    const notif = buildNotificacion({ nombre, propNombre, diaPago: dia, valorUf, moneda, multaMonto, multaMoneda, ufValue })
    if (notif) return twimlDos(welcome, notif)
    return twiml(welcome)
  }

  if (esNo) {
    await admin.from('propiedades').update({ whatsapp_estado: 'rechazado' }).eq('id', p.id as string)
    return twiml(`Entendido, ${nombre}. Tu decision fue registrada y sera comunicada a tu arrendador.`)
  }

  return twiml(
    `Hola ${nombre}! Soy el asistente de arriendos de ${propNombre}.\n\n` +
    `Responde *Si* para confirmar recordatorios de pago, o *No* para rechazarlos.`
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

  const { data: contratos } = await admin
    .from('contratos')
    .select('id, propiedad_id, dia_pago, propiedades(nombre, valor_uf, moneda, multa_monto, multa_moneda)')
    .eq('arrendatario_id', profile.id)
    .eq('activo', true)

  if (!contratos || contratos.length === 0) {
    return twiml(`Hola ${nombre}! No tienes contratos activos en el sistema. Contacta a tu arrendador.`)
  }

  const hoy = todayInChile()
  const periodoActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`

  if (esNo) {
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

  if (esSi || msgUp !== '') {
    const ufValue = await getUFValue()
    const lineas: string[] = []
    const notificaciones: string[] = []

    for (const contrato of contratos) {
      const prop = (contrato as unknown as { propiedades: { nombre: string; valor_uf: number; moneda: string; multa_monto?: number | null; multa_moneda?: string | null } }).propiedades
      if (!prop) continue

      const diaPago = (contrato as unknown as { dia_pago: number }).dia_pago ?? 5

      const { data: pago } = await admin
        .from('pagos')
        .select('estado, fecha_pago')
        .eq('contrato_id', contrato.id)
        .eq('periodo', periodoActual)
        .maybeSingle()

      const montoTexto = formatMonto(prop.valor_uf, prop.moneda, ufValue)

      let multaInfo = ''
      if (prop.multa_monto) {
        const multaDiariaCLP = Math.round(prop.multa_moneda === 'CLP' ? prop.multa_monto : prop.multa_monto * ufValue)
        multaInfo = ` (multa: ${formatCLPLocal(multaDiariaCLP)} CLP/dia si atraso)`
      }

      if (pago && (pago.estado === 'pagado' || pago.estado === 'atrasado')) {
        const fechaPago = pago.fecha_pago ? new Date(pago.fecha_pago).toLocaleDateString('es-CL') : 'fecha no registrada'
        lineas.push(`${prop.nombre}: PAGADO el ${fechaPago} ✓`)
      } else {
        const fechaVenc = new Date(hoy.getFullYear(), hoy.getMonth(), diaPago)
        const dias = Math.round((fechaVenc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
        const estadoTexto = dias >= 0
          ? `Vence en ${dias} dias (dia ${diaPago})`
          : `${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? 's' : ''} de atraso`
        lineas.push(`${prop.nombre}: ${montoTexto}/mes\n  ${estadoTexto}${multaInfo}`)

        // Only add notification if today is a trigger day and not already sent today
        const tipoNotif = dias === 2 ? 'aviso_2d' : dias === 1 ? 'aviso_1d' : dias === 0 ? 'vencimiento' : dias < 0 ? `atraso_${Math.abs(dias)}` : null
        if (tipoNotif) {
          const { data: yaEnviado } = await admin.from('notificaciones_log')
            .select('id').eq('contrato_id', contrato.id).eq('tipo', tipoNotif).eq('periodo', periodoActual).maybeSingle()
          if (!yaEnviado) {
            const notif = buildNotificacion({
              nombre, propNombre: prop.nombre, diaPago,
              valorUf: prop.valor_uf, moneda: prop.moneda,
              multaMonto: prop.multa_monto ?? null,
              multaMoneda: prop.multa_moneda ?? null,
              ufValue,
            })
            if (notif) notificaciones.push(notif)
          }
        }
      }
    }

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

    const welcome =
      `Hola ${nombre}! Estado de tus arriendos:\n\n` +
      lineas.join('\n\n') +
      `\n\nResponde *No* para dejar de recibir recordatorios.`

    // Send welcome + first pending notification if exists
    if (notificaciones.length > 0) return twimlDos(welcome, notificaciones[0])
    return twiml(welcome)
  }

  return twiml(
    `Hola ${nombre}! Soy el asistente de arriendos.\n\n` +
    `Responde *Si* para ver el estado de tus pagos, o *No* para dejar de recibir recordatorios.`
  )
}
