import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviarWhatsApp } from '@/lib/utils/twilio'
import { getUFValue } from '@/lib/utils/uf'

// Vercel cron passes Authorization: Bearer {CRON_SECRET}
// Browser testing: GET /api/cron/notificaciones?secret=xxx
function autenticado(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // allow if not configured (local dev)
  const authHeader = request.headers.get('authorization')
  const querySecret = request.nextUrl.searchParams.get('secret')
  return authHeader === `Bearer ${secret}` || querySecret === secret
}

/** Days between two dates (positive = future, negative = past) */
function diasHasta(fecha: Date, hoy: Date): number {
  const diff = fecha.getTime() - hoy.getTime()
  return Math.round(diff / (1000 * 60 * 60 * 24))
}

/** Chilean date (UTC-3 fixed offset) */
function hoyChile(): Date {
  const utc = new Date()
  return new Date(utc.getTime() - 3 * 60 * 60 * 1000)
}

function formatCLPLocal(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n)
}

export async function GET(request: NextRequest) {
  if (!autenticado(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const admin = createAdminClient()
  const hoy = hoyChile()
  const periodoActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const ufValue = await getUFValue()
  // Optional: force a specific notification type for testing
  // e.g. ?forzar_tipo=vencimiento or ?forzar_tipo=atraso_3
  const forzarTipo = request.nextUrl.searchParams.get('forzar_tipo')

  // Load all active contracts with tenant phone, property details
  const { data: contratos } = await admin
    .from('contratos')
    .select(`
      id,
      propiedad_id,
      propiedades (
        nombre,
        direccion,
        valor_uf,
        moneda,
        dia_vencimiento,
        multa_monto,
        multa_moneda
      ),
      profiles!contratos_arrendatario_id_fkey (
        nombre,
        telefono
      )
    `)
    .eq('activo', true)

  if (!contratos || contratos.length === 0) {
    return NextResponse.json({ ok: true, enviados: 0 })
  }

  // Load confirmed payments for current period
  const contratoIds = contratos.map(c => c.id)
  const { data: pagosEsteMes } = await admin
    .from('pagos')
    .select('contrato_id')
    .in('contrato_id', contratoIds)
    .eq('periodo', periodoActual)
    .eq('estado', 'pagado')

  const pagadosSet = new Set((pagosEsteMes ?? []).map((p: { contrato_id: string }) => p.contrato_id))

  // Load already-sent notifications this period to avoid duplicates
  const { data: logEnviados } = await admin
    .from('notificaciones_log')
    .select('contrato_id, tipo')
    .in('contrato_id', contratoIds)
    .eq('periodo', periodoActual)

  const enviados = new Set(
    (logEnviados ?? []).map((n: { contrato_id: string; tipo: string }) => `${n.contrato_id}:${n.tipo}`)
  )

  let totalEnviados = 0

  for (const contrato of contratos) {
    const propiedad = (contrato as unknown as {
      propiedades: {
        nombre: string
        direccion: string
        valor_uf: number
        moneda: string
        dia_vencimiento: number
        multa_monto?: number
        multa_moneda?: string
      }
    }).propiedades

    const arrendatario = (contrato as unknown as {
      profiles: { nombre: string; telefono?: string }
    }).profiles

    // Skip if no phone or already paid this month
    if (!arrendatario?.telefono) continue
    if (pagadosSet.has(contrato.id)) continue
    if (!propiedad?.dia_vencimiento) continue

    // Calculate due date for current month
    const fechaVencimiento = new Date(
      hoy.getFullYear(),
      hoy.getMonth(),
      propiedad.dia_vencimiento
    )
    const diasRestantes = diasHasta(fechaVencimiento, hoy)

    // Determine which notification type to send
    // forzar_tipo allows manual testing without waiting for the right day
    let tipo: string | null = forzarTipo ?? null
    if (!tipo) {
      if (diasRestantes === 2) tipo = 'aviso_2d'
      else if (diasRestantes === 1) tipo = 'aviso_1d'
      else if (diasRestantes === 0) tipo = 'vencimiento'
      else if (diasRestantes < 0) tipo = `atraso_${Math.abs(diasRestantes)}`
    }

    if (!tipo) continue

    // Check if already sent (skip dedup when forcing for tests)
    const key = `${contrato.id}:${tipo}`
    if (!forzarTipo && enviados.has(key)) continue

    // Build message
    const montoTexto = propiedad.moneda === 'CLP'
      ? formatCLPLocal(propiedad.valor_uf)
      : `${propiedad.valor_uf} UF (${formatCLPLocal(propiedad.valor_uf * ufValue)})`

    let mensaje = ''

    if (tipo === 'aviso_2d') {
      mensaje = `Hola ${arrendatario.nombre}\n\nEn 2 días vence el plazo de pago de tu arriendo de *${propiedad.nombre}*.\n\n💰 Monto: ${montoTexto}\n\nRealiza tu pago a tiempo para evitar multas. ¡Gracias!`
    } else if (tipo === 'aviso_1d') {
      mensaje = `Hola ${arrendatario.nombre}\n\nMañana vence el plazo de pago de tu arriendo de *${propiedad.nombre}*.\n\n💰 Monto: ${montoTexto}\n\nNo olvides realizar el pago. ¡Gracias!`
    } else if (tipo === 'vencimiento') {
      mensaje = `Hola ${arrendatario.nombre}\n\nHoy vence el plazo de pago de tu arriendo de *${propiedad.nombre}*.\n\n💰 Monto: ${montoTexto}\n\nRealiza el pago hoy para evitar multas. ¡Gracias!`
    } else if (tipo.startsWith('atraso_')) {
      const dias = Math.abs(diasRestantes)
      let multaTexto = ''
      let totalTexto = ''
      if (propiedad.multa_monto) {
        // Multa acumulada = multa_monto * días de atraso
        const multaDiariaCLP = propiedad.multa_moneda === 'CLP'
          ? propiedad.multa_monto
          : propiedad.multa_monto * ufValue
        const multaAcumuladaCLP = multaDiariaCLP * dias
        const montoPrincipalCLP = propiedad.moneda === 'CLP'
          ? propiedad.valor_uf
          : propiedad.valor_uf * ufValue
        multaTexto = `\n⚠️ Multa acumulada (${dias} día${dias > 1 ? 's' : ''}): ${formatCLPLocal(multaAcumuladaCLP)}`
        totalTexto = `\n💳 *Total a pagar: ${formatCLPLocal(montoPrincipalCLP + multaAcumuladaCLP)}*`
      }
      mensaje = `Hola ${arrendatario.nombre}\n\nTu arriendo de *${propiedad.nombre}* lleva *${dias} día${dias > 1 ? 's' : ''} de atraso*.\n\n💰 Monto arriendo: ${montoTexto}${multaTexto}${totalTexto}\n\nPor favor regulariza tu situación lo antes posible.`
    }

    if (!mensaje) continue

    const ok = await enviarWhatsApp(arrendatario.telefono, mensaje)

    if (ok) {
      await admin.from('notificaciones_log').insert({
        contrato_id: contrato.id,
        tipo,
        periodo: periodoActual,
        mensaje,
        exitosa: true,
      })
      totalEnviados++
    }
  }

  return NextResponse.json({ ok: true, enviados: totalEnviados, periodo: periodoActual })
}
