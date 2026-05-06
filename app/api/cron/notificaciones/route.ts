import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviarWhatsApp } from '@/lib/utils/twilio'
import { getUFValue } from '@/lib/utils/uf'

function autenticado(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const authHeader = request.headers.get('authorization')
  const querySecret = request.nextUrl.searchParams.get('secret')
  return authHeader === `Bearer ${secret}` || querySecret === secret
}

function diasHasta(fecha: Date, hoy: Date): number {
  return Math.round((fecha.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
}

function hoyChile(): Date {
  return new Date(new Date().getTime() - 4 * 60 * 60 * 1000)
}

function formatCLPLocal(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n)
}

function getTipo(diasRestantes: number, esNoche: boolean, forzarTipo: string | null): string | null {
  if (forzarTipo) return forzarTipo
  if (esNoche) {
    if (diasRestantes === 0) return 'vencimiento_n'
    if (diasRestantes < 0) return `atraso_${Math.abs(diasRestantes)}_n`
    return null
  }
  if (diasRestantes === 3) return 'aviso_3d'
  if (diasRestantes === 2) return 'aviso_2d'
  if (diasRestantes === 1) return 'aviso_1d'
  if (diasRestantes === 0) return 'vencimiento_m'
  if (diasRestantes < 0) return `atraso_${Math.abs(diasRestantes)}_m`
  return null
}

function buildMensaje(params: {
  nombre: string
  propNombre: string
  monedaOrig: string
  valorUf: number
  ufValue: number
  multaMonto?: number | null
  multaMoneda?: string | null
  diasRestantes: number
  tipo: string
  montoFaltante?: number | null
}): string | null {
  const { nombre, propNombre, monedaOrig, valorUf, ufValue, multaMonto, multaMoneda, diasRestantes, tipo, montoFaltante } = params

  const montoBaseCLP = monedaOrig === 'CLP'
    ? Math.round(Number(valorUf))
    : Math.round(Number(valorUf) * ufValue)
  const montoTexto = monedaOrig === 'CLP'
    ? `${formatCLPLocal(valorUf)} CLP`
    : `${valorUf} UF (${formatCLPLocal(Math.round(Number(valorUf) * ufValue))} CLP)`

  // Partial payment — show remaining
  if (montoFaltante && montoFaltante > 0) {
    const montoPagado = montoBaseCLP - montoFaltante
    return (
      `Hola ${nombre}\n\n` +
      `Registramos un pago parcial de *${formatCLPLocal(montoPagado)} CLP* para *${propNombre}*.\n\n` +
      `💰 Monto arriendo: ${montoTexto}\n` +
      `❌ *Aún faltan: ${formatCLPLocal(montoFaltante)} CLP*\n\n` +
      `Por favor completa el pago para regularizar tu situación.`
    )
  }

  if (tipo === 'aviso_3d') {
    return (
      `Hola ${nombre}\n\n` +
      `En 3 días vence el plazo de pago de tu arriendo de *${propNombre}*.\n\n` +
      `💰 Monto: ${montoTexto}\n\n` +
      `Te recordamos para que planifiques tu pago a tiempo. ¡Gracias!`
    )
  }
  if (tipo === 'aviso_2d') {
    return (
      `Hola ${nombre}\n\n` +
      `En 2 días vence el plazo de pago de tu arriendo de *${propNombre}*.\n\n` +
      `💰 Monto: ${montoTexto}\n\n` +
      `Realiza tu pago a tiempo para evitar multas. ¡Gracias!`
    )
  }
  if (tipo === 'aviso_1d') {
    return (
      `Hola ${nombre}\n\n` +
      `Mañana vence el plazo de pago de tu arriendo de *${propNombre}*.\n\n` +
      `💰 Monto: ${montoTexto}\n\n` +
      `No olvides realizar el pago. ¡Gracias!`
    )
  }
  if (tipo === 'vencimiento_m') {
    let multaInfo = ''
    if (multaMonto) {
      const multaDiariaCLP = Math.round(multaMoneda === 'CLP' ? multaMonto : (multaMonto ?? 0) * ufValue)
      multaInfo = `\n\n⚠️ A partir de mañana se aplicará una multa de ${formatCLPLocal(multaDiariaCLP)} CLP por cada día de atraso.`
    }
    return (
      `Hola ${nombre}\n\n` +
      `Hoy vence el plazo de pago de tu arriendo de *${propNombre}*.\n\n` +
      `💰 Monto: ${montoTexto}${multaInfo}\n\n` +
      `Realiza el pago hoy para evitar multas. ¡Gracias!`
    )
  }
  if (tipo === 'vencimiento_n') {
    return (
      `Hola ${nombre}\n\n` +
      `Son las 9 PM y aún no registramos tu pago de *${propNombre}*.\n\n` +
      `💰 Monto: ${montoTexto}\n\n` +
      `Tienes hasta medianoche para pagar sin incurrir en multas. ¡Apresúrate!`
    )
  }
  if (tipo.startsWith('atraso_')) {
    const parts = tipo.split('_')
    const dias = tipo.startsWith('atraso_') && parts[1] ? parseInt(parts[1]) : Math.abs(diasRestantes)
    const esNocheTipo = parts[2] === 'n'

    let multaTexto = ''
    let totalTexto = ''
    if (multaMonto) {
      const multaDiariaCLP = Math.round(multaMoneda === 'CLP' ? multaMonto : (multaMonto ?? 0) * ufValue)
      const multaAcumuladaCLP = multaDiariaCLP * dias
      multaTexto = `\n\n⚠️ Multa diaria: ${formatCLPLocal(multaDiariaCLP)} CLP`
      if (dias > 1) multaTexto += `\n⚠️ Multa acumulada (${dias} días): ${formatCLPLocal(multaAcumuladaCLP)} CLP`
      totalTexto = `\n💳 *Total a pagar: ${formatCLPLocal(montoBaseCLP + multaAcumuladaCLP)} CLP*`
    }

    const prefijo = esNocheTipo ? '⚠️ Recordatorio nocturno: Tu' : 'Tu'
    return (
      `Hola ${nombre}\n\n` +
      `${prefijo} arriendo de *${propNombre}* lleva *${dias} día${dias !== 1 ? 's' : ''} de atraso*.\n\n` +
      `💰 Monto arriendo: ${montoTexto}${multaTexto}${totalTexto}\n\n` +
      `Por favor regulariza tu situación lo antes posible.`
    )
  }
  return null
}

export async function GET(request: NextRequest) {
  if (!autenticado(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const admin = createAdminClient()
  const hoy = hoyChile()
  const periodoActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const ufValue = await getUFValue()
  const turno = request.nextUrl.searchParams.get('turno') ?? 'manana'
  const esNoche = turno === 'noche'
  const forzarTipo = request.nextUrl.searchParams.get('forzar_tipo')

  let totalEnviados = 0

  // ── CONTRATOS FORMALES ────────────────────────────────────────────────────

  const { data: contratos } = await admin
    .from('contratos')
    .select(`
      id, dia_pago,
      propiedades (nombre, valor_uf, moneda, dia_vencimiento, multa_monto, multa_moneda),
      profiles!contratos_arrendatario_id_fkey (nombre, telefono)
    `)
    .eq('activo', true)

  if (contratos && contratos.length > 0) {
    const contratoIds = contratos.map((c: { id: string }) => c.id)

    const { data: pagosEsteMes } = await admin
      .from('pagos')
      .select('contrato_id, estado, monto_clp')
      .in('contrato_id', contratoIds)
      .eq('periodo', periodoActual)
      .in('estado', ['pagado', 'atrasado', 'incompleto'])

    type PagoResumen = { contrato_id: string; estado: string; monto_clp: number }
    const pagadosMap = new Map<string, PagoResumen>(
      (pagosEsteMes ?? []).map((p: PagoResumen) => [p.contrato_id, p])
    )

    const { data: logEnviados } = await admin
      .from('notificaciones_log')
      .select('contrato_id, tipo')
      .in('contrato_id', contratoIds)
      .eq('periodo', periodoActual)

    const enviados = new Set(
      (logEnviados ?? []).map((n: { contrato_id: string; tipo: string }) => `${n.contrato_id}:${n.tipo}`)
    )

    for (const contrato of contratos) {
      type ContratoFull = {
        id: string; dia_pago?: number;
        propiedades: { nombre: string; valor_uf: number; moneda: string; dia_vencimiento: number; multa_monto?: number | null; multa_moneda?: string | null }
        profiles: { nombre: string; telefono?: string | null }
      }
      const c = contrato as unknown as ContratoFull
      if (!c.profiles?.telefono || !c.propiedades?.dia_vencimiento) continue

      const pago = pagadosMap.get(c.id)
      if (pago?.estado === 'pagado' || pago?.estado === 'atrasado') continue

      const diaPago = c.dia_pago ?? c.propiedades.dia_vencimiento
      const fechaVenc = new Date(hoy.getFullYear(), hoy.getMonth(), diaPago)
      const diasRestantes = diasHasta(fechaVenc, hoy)

      const tipo = getTipo(diasRestantes, esNoche, forzarTipo)
      if (!tipo) continue
      if (!forzarTipo && enviados.has(`${c.id}:${tipo}`)) continue

      const montoBaseCLP = c.propiedades.moneda === 'CLP'
        ? Math.round(Number(c.propiedades.valor_uf))
        : Math.round(Number(c.propiedades.valor_uf) * ufValue)
      const montoFaltante = pago?.estado === 'incompleto' ? montoBaseCLP - pago.monto_clp : null

      const mensaje = buildMensaje({
        nombre: c.profiles.nombre,
        propNombre: c.propiedades.nombre,
        monedaOrig: c.propiedades.moneda,
        valorUf: c.propiedades.valor_uf,
        ufValue,
        multaMonto: c.propiedades.multa_monto,
        multaMoneda: c.propiedades.multa_moneda,
        diasRestantes,
        tipo,
        montoFaltante,
      })
      if (!mensaje) continue

      const ok = await enviarWhatsApp(c.profiles.telefono, mensaje)
      if (ok) {
        await admin.from('notificaciones_log').insert({
          contrato_id: c.id,
          tipo,
          periodo: periodoActual,
          mensaje,
          exitosa: true,
        })
        totalEnviados++
      }
    }
  }

  // ── ARRENDATARIOS INFORMALES ──────────────────────────────────────────────

  const { data: informales } = await admin
    .from('propiedades')
    .select('id, nombre, valor_uf, moneda, dia_vencimiento, multa_monto, multa_moneda, arrendatario_informal_nombre, arrendatario_informal_celular')
    .eq('activa', true)
    .not('arrendatario_informal_celular', 'is', null)
    .not('arrendatario_informal_nombre', 'is', null)

  if (informales && informales.length > 0) {
    const propIds = informales.map((p: { id: string }) => p.id)

    const { data: pagosInf } = await admin
      .from('pagos')
      .select('propiedad_id, estado, monto_clp')
      .in('propiedad_id', propIds)
      .eq('periodo', periodoActual)
      .in('estado', ['pagado', 'atrasado', 'incompleto'])

    type PagoInfResumen = { propiedad_id: string; estado: string; monto_clp: number }
    const pagadosInfMap = new Map<string, PagoInfResumen>(
      (pagosInf ?? []).map((p: PagoInfResumen) => [p.propiedad_id, p])
    )

    const { data: logInf } = await admin
      .from('notificaciones_log')
      .select('propiedad_id, tipo')
      .in('propiedad_id', propIds)
      .eq('periodo', periodoActual)

    const enviadosInf = new Set(
      (logInf ?? [])
        .filter((n: { propiedad_id: string | null }) => n.propiedad_id)
        .map((n: { propiedad_id: string; tipo: string }) => `${n.propiedad_id}:${n.tipo}`)
    )

    for (const prop of informales) {
      type PropInfFull = {
        id: string; nombre: string; valor_uf: number; moneda: string; dia_vencimiento?: number | null
        multa_monto?: number | null; multa_moneda?: string | null
        arrendatario_informal_nombre: string; arrendatario_informal_celular: string
      }
      const p = prop as unknown as PropInfFull
      if (!p.dia_vencimiento || !p.arrendatario_informal_celular) continue

      const pago = pagadosInfMap.get(p.id)
      if (pago?.estado === 'pagado' || pago?.estado === 'atrasado') continue

      const fechaVenc = new Date(hoy.getFullYear(), hoy.getMonth(), p.dia_vencimiento)
      const diasRestantes = diasHasta(fechaVenc, hoy)

      const tipo = getTipo(diasRestantes, esNoche, forzarTipo)
      if (!tipo) continue
      if (!forzarTipo && enviadosInf.has(`${p.id}:${tipo}`)) continue

      const montoBaseCLP = p.moneda === 'CLP'
        ? Math.round(Number(p.valor_uf))
        : Math.round(Number(p.valor_uf) * ufValue)
      const montoFaltante = pago?.estado === 'incompleto' ? montoBaseCLP - pago.monto_clp : null

      const mensaje = buildMensaje({
        nombre: p.arrendatario_informal_nombre,
        propNombre: p.nombre,
        monedaOrig: p.moneda,
        valorUf: p.valor_uf,
        ufValue,
        multaMonto: p.multa_monto,
        multaMoneda: p.multa_moneda,
        diasRestantes,
        tipo,
        montoFaltante,
      })
      if (!mensaje) continue

      const ok = await enviarWhatsApp(p.arrendatario_informal_celular, mensaje)
      if (ok) {
        await admin.from('notificaciones_log').insert({
          contrato_id: null,
          propiedad_id: p.id,
          tipo,
          periodo: periodoActual,
          mensaje,
          exitosa: true,
        })
        totalEnviados++
      }
    }
  }

  return NextResponse.json({ ok: true, enviados: totalEnviados, periodo: periodoActual, turno })
}
