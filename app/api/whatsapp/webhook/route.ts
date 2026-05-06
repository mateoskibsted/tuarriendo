import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUFValue } from '@/lib/utils/uf'
import { todayInChile } from '@/lib/utils/date'
import { enviarWhatsApp } from '@/lib/utils/twilio'

export async function GET() {
  return new NextResponse('WhatsApp webhook OK', { status: 200 })
}

// ── TwiML helpers ─────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function phoneMatch(stored: string, incoming: string): boolean {
  const s = stored.replace(/\D/g, '')
  const i = incoming.replace(/\D/g, '')
  if (!s || !i) return false
  return s === i || i.endsWith(s) || s.endsWith(i)
}

function formatCLPLocal(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)
}

function normMsg(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

function periodoActual(hoy: Date): string {
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
}

function nombreMes(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  const n = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${n[m - 1]} ${y}`
}

function formatMonto(valorUf: number, moneda: string, ufValue: number): string {
  if (moneda === 'CLP') return `${formatCLPLocal(Math.round(Number(valorUf)))} CLP`
  return `${valorUf} UF (${formatCLPLocal(Math.round(Number(valorUf) * ufValue))} CLP)`
}

// Parse Chilean peso amounts from text: "450000", "$450.000", "450 mil", etc.
function parsearMonto(text: string): number | null {
  const t = text.trim().toLowerCase()
  const mil = t.match(/(\d[\d.]*)\s*mil/)
  if (mil) {
    const n = parseFloat(mil[1].replace(/\./g, ''))
    return isNaN(n) ? null : Math.round(n * 1000)
  }
  const withSep = t.match(/\$?\s*([\d]{1,3}(?:[.,][\d]{3})+)/)
  if (withSep) return parseInt(withSep[1].replace(/[.,]/g, ''), 10)
  const plain = t.match(/\$?\s*(\d{4,})/)
  if (plain) return parseInt(plain[1], 10)
  return null
}

const KEYWORDS_PAGO = [
  'pague', 'ya pague', 'hice el pago', 'realice el pago', 'hize el pago',
  'transferi', 'deposite', 'hice la transferencia', 'hize la transferencia',
  'ya pago', 'pago listo', 'te pague', 'pague el arriendo', 'ya realize',
]

function esMensajeDePago(msgNorm: string): boolean {
  return KEYWORDS_PAGO.some(k => msgNorm === k || msgNorm.startsWith(k + ' ') || msgNorm.endsWith(' ' + k) || msgNorm.includes(k))
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

  const msgNorm = normMsg(msgRaw)
  const admin = createAdminClient()

  try {
    // ── 1. Arrendadores ───────────────────────────────────────────────────────
    const { data: arrendadores } = await admin
      .from('profiles')
      .select('id, nombre, telefono')
      .eq('rol', 'arrendador')
      .not('telefono', 'is', null)

    const arrendadorMatch = (arrendadores ?? []).find(p =>
      phoneMatch(p.telefono as string, fromRaw)
    )
    if (arrendadorMatch) {
      return await handleArrendador(arrendadorMatch as { id: string; nombre: string; telefono: string }, msgNorm, admin)
    }

    // ── 2. Arrendatarios informales ───────────────────────────────────────────
    const { data: propiedades } = await admin
      .from('propiedades')
      .select('id, nombre, dia_vencimiento, valor_uf, moneda, multa_monto, multa_moneda, arrendatario_informal_nombre, arrendatario_informal_celular, arrendatario_informal_cobro_tipo, arrendatario_informal_fecha_inicio, arrendatario_informal_fecha_fin, arrendador_id')
      .eq('activa', true)
      .not('arrendatario_informal_celular', 'is', null)

    const propMatch = (propiedades ?? []).find(p =>
      phoneMatch(p.arrendatario_informal_celular as string, fromRaw)
    )
    if (propMatch) {
      return await handleArrendatarioInformal(propMatch as Record<string, unknown>, fromRaw, msgNorm, msgRaw, admin)
    }

    // ── 3. Arrendatarios formales ─────────────────────────────────────────────
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, nombre, telefono')
      .eq('rol', 'arrendatario')
      .not('telefono', 'is', null)

    const profileMatch = (profiles ?? []).find(p =>
      phoneMatch(p.telefono as string, fromRaw)
    )
    if (profileMatch) {
      return await handleArrendatarioFormal(profileMatch as { id: string; nombre: string; telefono: string }, fromRaw, msgNorm, msgRaw, admin)
    }

    return twiml('Tu número no está registrado en el sistema. Contacta a tu arrendador.')
  } catch (err) {
    console.error('Webhook error:', err)
    return twiml('Error interno. Intenta de nuevo en un momento.')
  }
}

// ── Arrendador handler ────────────────────────────────────────────────────────

async function handleArrendador(
  arrendador: { id: string; nombre: string; telefono: string },
  msgNorm: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<NextResponse> {
  const nombre = arrendador.nombre.split(' ')[0]

  const { data: pendientes } = await admin
    .from('pagos_pendientes')
    .select('*')
    .eq('arrendador_id', arrendador.id)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true })

  const primero = pendientes?.[0]
  const hayPendientes = (pendientes ?? []).length > 0

  const esConfirmar = ['confirmar', 'si', 'aprobar', 'confirmo', 'ok'].includes(msgNorm)
  const esRechazar = ['rechazar', 'no', 'rechazado', 'rechazo'].includes(msgNorm)

  if (esConfirmar) {
    if (!primero) return twiml(`No tienes pagos pendientes de confirmación, ${nombre}.`)

    const hoy = todayInChile()
    const ufValue = await getUFValue()

    // Determine due date and status
    let diaPago: number | null = null
    let valorUf = 0
    let propNombre = primero.arrendatario_nombre ? `arriendo de ${primero.arrendatario_nombre}` : 'arriendo'
    let arrendatarioCelular: string | null = primero.arrendatario_phone

    if (primero.propiedad_id) {
      const { data: prop } = await admin
        .from('propiedades')
        .select('dia_vencimiento, valor_uf, nombre, arrendatario_informal_celular')
        .eq('id', primero.propiedad_id)
        .single()
      diaPago = prop?.dia_vencimiento ?? null
      valorUf = prop?.valor_uf ?? 0
      propNombre = prop?.nombre ?? propNombre
      arrendatarioCelular = prop?.arrendatario_informal_celular ?? primero.arrendatario_phone
    } else if (primero.contrato_id) {
      const { data: c } = await admin
        .from('contratos')
        .select('dia_pago, valor_uf, propiedades(nombre), profiles!contratos_arrendatario_id_fkey(telefono)')
        .eq('id', primero.contrato_id)
        .single()
      diaPago = (c as unknown as { dia_pago: number } | null)?.dia_pago ?? null
      valorUf = (c as unknown as { valor_uf: number } | null)?.valor_uf ?? 0
      propNombre = (c as unknown as { propiedades?: { nombre: string } } | null)?.propiedades?.nombre ?? propNombre
      arrendatarioCelular = (c as unknown as { profiles?: { telefono?: string } } | null)?.profiles?.telefono ?? primero.arrendatario_phone
    }

    let estado = 'pagado'
    if (diaPago) {
      const [year, month] = primero.periodo.split('-').map(Number)
      const venc = new Date(year, month - 1, diaPago)
      if (hoy > venc) estado = 'atrasado'
    }

    await admin.from('pagos').insert({
      contrato_id: primero.contrato_id ?? null,
      propiedad_id: primero.propiedad_id ?? null,
      periodo: primero.periodo,
      valor_uf: valorUf,
      monto_clp: primero.monto_clp,
      uf_valor_dia: ufValue,
      estado,
      fecha_pago: hoy.toISOString(),
      notas: 'Pago reportado por WhatsApp',
    })

    await admin.from('pagos_pendientes').update({ estado: 'confirmado' }).eq('id', primero.id)

    if (arrendatarioCelular) {
      const msg = `✅ Tu arrendador confirmó tu pago de *${formatCLPLocal(primero.monto_clp)}* para *${propNombre}* (${nombreMes(primero.periodo)}). ¡Gracias!`
      await enviarWhatsApp(arrendatarioCelular, msg)
    }

    const resto = (pendientes ?? []).length - 1
    let resp = `✅ Pago de *${formatCLPLocal(primero.monto_clp)}* de ${primero.arrendatario_nombre ?? 'arrendatario'} confirmado y registrado.`
    if (resto > 0) resp += `\n\nAún tienes ${resto} pago${resto !== 1 ? 's' : ''} pendiente${resto !== 1 ? 's' : ''}.`
    return twiml(resp)
  }

  if (esRechazar) {
    if (!primero) return twiml(`No tienes pagos pendientes de confirmación, ${nombre}.`)

    await admin.from('pagos_pendientes').update({ estado: 'rechazado' }).eq('id', primero.id)

    if (primero.arrendatario_phone) {
      await enviarWhatsApp(primero.arrendatario_phone, `❌ Tu arrendador no pudo confirmar el pago reportado para *${nombreMes(primero.periodo)}*. Por favor contáctalo directamente.`)
    }

    const resto = (pendientes ?? []).length - 1
    let resp = `❌ Pago de ${primero.arrendatario_nombre ?? 'arrendatario'} rechazado.`
    if (resto > 0) resp += `\n\nAún tienes ${resto} pago${resto !== 1 ? 's' : ''} pendiente${resto !== 1 ? 's' : ''}.`
    return twiml(resp)
  }

  // Default: show pending list
  if (!hayPendientes) {
    return twiml(
      `Hola ${nombre}! No tienes pagos pendientes.\n\n` +
      `Cuando un arrendatario reporte un pago por WhatsApp, recibirás una notificación aquí.\n\n` +
      `Responde *Confirmar* o *Rechazar* para gestionar reportes.`
    )
  }

  const lista = (pendientes ?? []).map((p, i) =>
    `${i + 1}. ${p.arrendatario_nombre ?? 'Arrendatario'} — ${formatCLPLocal(p.monto_clp)} (${nombreMes(p.periodo)})`
  ).join('\n')

  return twiml(
    `Hola ${nombre}! Tienes ${pendientes!.length} pago${pendientes!.length !== 1 ? 's' : ''} pendiente${pendientes!.length !== 1 ? 's' : ''}:\n\n` +
    `${lista}\n\n` +
    `Responde *Confirmar* para aprobar el más antiguo o *Rechazar* para descartarlo.`
  )
}

// ── Arrendatario informal handler ─────────────────────────────────────────────

async function handleArrendatarioInformal(
  prop: Record<string, unknown>,
  fromPhone: string,
  msgNorm: string,
  msgRaw: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<NextResponse> {
  const nombre = (prop.arrendatario_informal_nombre as string | null) ?? 'arrendatario'
  const propNombre = prop.nombre as string
  const propId = prop.id as string
  const arrendadorId = prop.arrendador_id as string
  const hoy = todayInChile()

  // ── Check active session ──────────────────────────────────────────────────
  const { data: sesion } = await admin
    .from('whatsapp_sesiones')
    .select('*')
    .eq('phone', fromPhone)
    .maybeSingle()

  if (sesion?.estado === 'esperando_monto') {
    const monto = parsearMonto(msgRaw)
    if (!monto || monto < 1000 || monto > 100_000_000) {
      return twiml(`No entendí el monto. Indica solo el número en pesos, por ejemplo: *450000*`)
    }

    const periodo = periodoActual(hoy)

    await admin.from('pagos_pendientes').insert({
      propiedad_id: propId,
      contrato_id: null,
      arrendatario_phone: fromPhone,
      arrendatario_nombre: nombre,
      arrendador_id: arrendadorId,
      monto_clp: monto,
      periodo,
      estado: 'pendiente',
    })

    await admin.from('whatsapp_sesiones').delete().eq('phone', fromPhone)

    // Notify arrendador
    const { data: arrendadorProfile } = await admin
      .from('profiles')
      .select('telefono')
      .eq('id', arrendadorId)
      .single()

    if (arrendadorProfile?.telefono) {
      const fecha = hoy.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      const msg =
        `💰 *Reporte de pago recibido*\n\n` +
        `${nombre} reporta un pago de *${formatCLPLocal(monto)}* para *${propNombre}*.\n\n` +
        `Período: ${nombreMes(periodo)}\n` +
        `Reportado: ${fecha}\n\n` +
        `Responde *Confirmar* para registrarlo\n` +
        `Responde *Rechazar* para descartarlo`
      await enviarWhatsApp(arrendadorProfile.telefono, msg)
    }

    const aviso = arrendadorProfile?.telefono
      ? '✅ Tu reporte fue enviado a tu arrendador. Te notificaremos cuando sea confirmado.'
      : '✅ Tu reporte de pago fue registrado. Tu arrendador lo revisará pronto.'

    return twiml(
      `${aviso}\n\n` +
      `Monto reportado: *${formatCLPLocal(monto)}*\n` +
      `Propiedad: *${propNombre}*\n` +
      `Período: ${nombreMes(periodo)}`
    )
  }

  // ── Payment report keyword ────────────────────────────────────────────────
  if (esMensajeDePago(msgNorm)) {
    await admin.from('whatsapp_sesiones').upsert({
      phone: fromPhone,
      estado: 'esperando_monto',
      propiedad_id: propId,
      contrato_id: null,
      periodo: periodoActual(hoy),
      updated_at: new Date().toISOString(),
    })

    const ufValue = await getUFValue()
    const montoTexto = formatMonto(prop.valor_uf as number, prop.moneda as string, ufValue)

    return twiml(
      `Perfecto ${nombre}! Para registrar tu pago de *${propNombre}* necesito el monto.\n\n` +
      `Valor mensual: ${montoTexto}\n\n` +
      `¿Cuánto pagaste? Indica el monto en pesos (ej: *450000*)`
    )
  }

  // ── Opt-in Si/No ──────────────────────────────────────────────────────────
  const esSi = msgNorm === 'si' || msgNorm === 's'
  const esNo = msgNorm === 'no' || msgNorm === 'n'

  if (esSi) {
    await admin.from('propiedades').update({ whatsapp_estado: 'confirmado' }).eq('id', propId)
    const ufValue = await getUFValue()
    const dia = prop.dia_vencimiento as number | null
    const montoTexto = formatMonto(prop.valor_uf as number, prop.moneda as string, ufValue)
    return twiml(
      `Listo, ${nombre}! Quedaste conectado a los recordatorios de *${propNombre}*.\n\n` +
      `Arriendo: ${montoTexto}/mes\n` +
      (dia ? `Vencimiento: día ${dia} de cada mes\n\n` : '\n') +
      `Cuando hagas tu pago, escríbeme *Pagué* y te ayudo a reportarlo.`
    )
  }

  if (esNo) {
    await admin.from('propiedades').update({ whatsapp_estado: 'rechazado' }).eq('id', propId)
    return twiml(`Entendido, ${nombre}. Tu decisión fue registrada y será comunicada a tu arrendador.`)
  }

  // ── Default status ────────────────────────────────────────────────────────
  const ufValue = await getUFValue()
  const dia = prop.dia_vencimiento as number | null
  const montoTexto = formatMonto(prop.valor_uf as number, prop.moneda as string, ufValue)

  let estadoTexto = ''
  if (dia) {
    const fechaVenc = new Date(hoy.getFullYear(), hoy.getMonth(), dia)
    const dias = Math.round((fechaVenc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
    estadoTexto = dias >= 0
      ? `\nPróximo pago: día ${dia} — faltan ${dias} días`
      : `\n⚠️ ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''} de atraso desde el día ${dia}`
  }

  return twiml(
    `Hola ${nombre}! Soy el asistente de arriendos de *${propNombre}*.\n\n` +
    `Arriendo: ${montoTexto}/mes${estadoTexto}\n\n` +
    `Escribe *Pagué* para reportar tu pago.`
  )
}

// ── Arrendatario formal handler ───────────────────────────────────────────────

async function handleArrendatarioFormal(
  profile: { id: string; nombre: string; telefono: string },
  fromPhone: string,
  msgNorm: string,
  msgRaw: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<NextResponse> {
  const nombre = profile.nombre.split(' ')[0]
  const hoy = todayInChile()
  const periodo = periodoActual(hoy)

  const { data: contratos } = await admin
    .from('contratos')
    .select('id, propiedad_id, dia_pago, valor_uf, propiedades(id, nombre, valor_uf, moneda, multa_monto, multa_moneda, arrendador_id)')
    .eq('arrendatario_id', profile.id)
    .eq('activo', true)

  if (!contratos || contratos.length === 0) {
    return twiml(`Hola ${nombre}! No tienes contratos activos. Contacta a tu arrendador.`)
  }

  type ContratoTyped = {
    id: string; propiedad_id: string; dia_pago: number; valor_uf: number
    propiedades?: { id: string; nombre: string; valor_uf: number; moneda: string; multa_monto?: number | null; multa_moneda?: string | null; arrendador_id: string }
  }
  const contrato = contratos[0] as unknown as ContratoTyped
  const prop = contrato.propiedades

  // ── Check active session ──────────────────────────────────────────────────
  const { data: sesion } = await admin
    .from('whatsapp_sesiones')
    .select('*')
    .eq('phone', fromPhone)
    .maybeSingle()

  if (sesion?.estado === 'esperando_monto') {
    const monto = parsearMonto(msgRaw)
    if (!monto || monto < 1000 || monto > 100_000_000) {
      return twiml(`No entendí el monto. Indica solo el número en pesos, por ejemplo: *450000*`)
    }

    await admin.from('pagos_pendientes').insert({
      contrato_id: contrato.id,
      propiedad_id: prop?.id ?? null,
      arrendatario_phone: fromPhone,
      arrendatario_nombre: profile.nombre,
      arrendador_id: prop?.arrendador_id ?? '',
      monto_clp: monto,
      periodo,
      estado: 'pendiente',
    })

    await admin.from('whatsapp_sesiones').delete().eq('phone', fromPhone)

    // Notify arrendador
    let arrendadorPhone: string | null = null
    if (prop?.arrendador_id) {
      const { data: ap } = await admin.from('profiles').select('telefono').eq('id', prop.arrendador_id).single()
      arrendadorPhone = ap?.telefono ?? null
    }

    if (arrendadorPhone) {
      const propNombre = prop?.nombre ?? 'propiedad'
      const fecha = hoy.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      const msg =
        `💰 *Reporte de pago recibido*\n\n` +
        `${profile.nombre} reporta un pago de *${formatCLPLocal(monto)}* para *${propNombre}*.\n\n` +
        `Período: ${nombreMes(periodo)}\n` +
        `Reportado: ${fecha}\n\n` +
        `Responde *Confirmar* para registrarlo\n` +
        `Responde *Rechazar* para descartarlo`
      await enviarWhatsApp(arrendadorPhone, msg)
    }

    return twiml(
      `${arrendadorPhone ? '✅ Tu reporte fue enviado a tu arrendador. Te notificaremos cuando sea confirmado.' : '✅ Tu reporte fue registrado. Tu arrendador lo revisará pronto.'}\n\n` +
      `Monto: *${formatCLPLocal(monto)}*\n` +
      `Período: ${nombreMes(periodo)}`
    )
  }

  // ── Payment report keyword ────────────────────────────────────────────────
  if (esMensajeDePago(msgNorm)) {
    await admin.from('whatsapp_sesiones').upsert({
      phone: fromPhone,
      estado: 'esperando_monto',
      propiedad_id: prop?.id ?? null,
      contrato_id: contrato.id,
      periodo,
      updated_at: new Date().toISOString(),
    })

    const ufValue = await getUFValue()
    const valorUf = prop?.valor_uf ?? contrato.valor_uf
    const moneda = prop?.moneda ?? 'UF'
    const propNombre = prop?.nombre ?? 'tu propiedad'
    const montoTexto = formatMonto(valorUf, moneda, ufValue)

    return twiml(
      `Perfecto ${nombre}! Para registrar tu pago de *${propNombre}* necesito el monto.\n\n` +
      `Valor mensual: ${montoTexto}\n\n` +
      `¿Cuánto pagaste? (ej: *450000*)`
    )
  }

  // ── Opt-in Si/No ──────────────────────────────────────────────────────────
  const esSi = msgNorm === 'si' || msgNorm === 's'
  const esNo = msgNorm === 'no' || msgNorm === 'n'

  if (esNo) {
    await admin.from('notificaciones_log').insert({
      contrato_id: contrato.id,
      tipo: 'rechazo_whatsapp',
      periodo,
      mensaje: `${nombre} rechazó notificaciones WhatsApp`,
      exitosa: true,
    })
    return twiml(`Entendido, ${nombre}. No te enviaremos más recordatorios por WhatsApp.`)
  }

  if (esSi) {
    await admin.from('notificaciones_log').insert({
      contrato_id: contrato.id,
      tipo: 'confirmacion_whatsapp',
      periodo,
      mensaje: `${nombre} confirmó notificaciones WhatsApp`,
      exitosa: true,
    })
  }

  // ── Default status ────────────────────────────────────────────────────────
  const ufValue = await getUFValue()
  const { data: pago } = await admin
    .from('pagos')
    .select('estado, fecha_pago')
    .eq('contrato_id', contrato.id)
    .eq('periodo', periodo)
    .maybeSingle()

  const propNombre = prop?.nombre ?? 'tu propiedad'
  const valorUf = prop?.valor_uf ?? contrato.valor_uf
  const moneda = prop?.moneda ?? 'UF'
  const montoTexto = formatMonto(valorUf, moneda, ufValue)
  const diaPago = contrato.dia_pago ?? 5

  let estadoTexto = ''
  if (pago?.estado === 'pagado' || pago?.estado === 'atrasado') {
    const fechaStr = pago.fecha_pago ? new Date(pago.fecha_pago).toLocaleDateString('es-CL') : 'fecha no registrada'
    estadoTexto = `✅ Pagado el ${fechaStr}`
  } else {
    const fechaVenc = new Date(hoy.getFullYear(), hoy.getMonth(), diaPago)
    const dias = Math.round((fechaVenc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
    estadoTexto = dias >= 0
      ? `Vence el día ${diaPago} — faltan ${dias} días`
      : `⚠️ ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''} de atraso`
  }

  return twiml(
    `Hola ${nombre}! Estado de *${propNombre}*:\n\n` +
    `Arriendo: ${montoTexto}/mes\n` +
    `${estadoTexto}\n\n` +
    `Escribe *Pagué* para reportar tu pago.`
  )
}
