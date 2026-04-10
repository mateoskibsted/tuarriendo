import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { formatUF, formatCLP } from '@/lib/utils/uf'
import { todayInChile } from '@/lib/utils/date'
import PagosDetectadosAuto from './PagosDetectadosAuto'
import type { Propiedad, Contrato } from '@/lib/types'

const MAX_PROPIEDADES = 10

export default async function ArrendadorDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const mesActual = new Date().toISOString().slice(0, 7) // "YYYY-MM"

  const { data: propiedades } = await admin
    .from('propiedades')
    .select('*')
    .eq('arrendador_id', user!.id)
    .eq('activa', true)
    .order('created_at', { ascending: false })

  const propiedadIds = (propiedades ?? []).map((p: Propiedad) => p.id)

  const { data: contratos } = propiedadIds.length > 0
    ? await admin
        .from('contratos')
        .select('*, propiedades(nombre), profiles!contratos_arrendatario_id_fkey(nombre, rut)')
        .in('propiedad_id', propiedadIds)
        .eq('activo', true)
    : { data: [] }

  const contratoIds = (contratos ?? []).map((c: Contrato) => c.id)

  // Pagos este mes — formales (por contrato)
  const { data: pagosFormalesEsteMes } = contratoIds.length > 0
    ? await admin
        .from('pagos')
        .select('contrato_id, estado, fecha_pago')
        .in('contrato_id', contratoIds)
        .eq('periodo', mesActual)
    : { data: [] }

  type PagoResumen = { contrato_id?: string | null; propiedad_id?: string | null; estado: string; fecha_pago?: string | null }
  const pagosFormalMap = new Map<string, PagoResumen>(
    (pagosFormalesEsteMes ?? [])
      .filter((p: PagoResumen) => p.contrato_id)
      .map((p: PagoResumen) => [p.contrato_id!, p])
  )

  // Pagos este mes — informales (por propiedad)
  const propiedadesInformalesIds = (propiedades ?? [])
    .filter((p: Propiedad) => !!(p as Propiedad & { arrendatario_informal_nombre?: string }).arrendatario_informal_nombre && !(contratos ?? []).find((c: Contrato) => c.propiedad_id === p.id))
    .map((p: Propiedad) => p.id)

  const { data: pagosInformalesEsteMes } = propiedadesInformalesIds.length > 0
    ? await admin
        .from('pagos')
        .select('propiedad_id, estado, fecha_pago')
        .in('propiedad_id', propiedadesInformalesIds)
        .eq('periodo', mesActual)
    : { data: [] }

  const pagosInformalMap = new Map<string, PagoResumen>(
    (pagosInformalesEsteMes ?? [])
      .filter((p: PagoResumen) => p.propiedad_id)
      .map((p: PagoResumen) => [p.propiedad_id!, p])
  )

  // Helper: ¿está atrasado un pago dado dia de vencimiento y fecha_pago?
  function esPagoAtrasado(diaPago: number, fechaPagoStr?: string | null, periodo?: string): boolean {
    const [year, month] = (periodo ?? mesActual).split('-').map(Number)
    const vencimiento = new Date(year, month - 1, diaPago)
    if (!fechaPagoStr) return false
    const fechaPago = new Date(fechaPagoStr)
    fechaPago.setHours(0, 0, 0, 0)
    vencimiento.setHours(0, 0, 0, 0)
    return fechaPago > vencimiento
  }

  function diasDeAtraso(diaPago: number, periodo?: string): number {
    const [year, month] = (periodo ?? mesActual).split('-').map(Number)
    const vencimiento = new Date(year, month - 1, diaPago)
    const hoy = todayInChile()
    // Fine starts the day AFTER the due date (vencimiento is still valid)
    if (hoy <= vencimiento) return 0
    return Math.floor((hoy.getTime() - vencimiento.getTime()) / (24 * 60 * 60 * 1000))
  }

  // Para stats: contar pagados (incluye atrasados que ya pagaron)
  const pagadosEsteMesFormal = (pagosFormalesEsteMes ?? []).filter((p: PagoResumen) => p.estado === 'pagado' || p.estado === 'atrasado').length
  const pagadosEsteMesInformal = (pagosInformalesEsteMes ?? []).filter((p: PagoResumen) => p.estado === 'pagado' || p.estado === 'atrasado').length

  // Check if Gmail is connected
  const { data: emailConnection } = await admin
    .from('email_connections')
    .select('id')
    .eq('arrendador_id', user!.id)
    .single()

  const totalPropiedades = propiedades?.length ?? 0
  const puedeAgregarMas = totalPropiedades < MAX_PROPIEDADES
  const propiedadesConInquilino = (contratos ?? []).length + propiedadesInformalesIds.length
  const pagadosEsteMes = pagadosEsteMesFormal + pagadosEsteMesInformal

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Panel de arrendador</h1>
        <p className="text-gray-500 mt-1">Gestiona tus propiedades y arrendatarios</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Propiedades" value={`${totalPropiedades}/${MAX_PROPIEDADES}`} color="blue" />
        <StatCard label="Arrendatarios" value={propiedadesConInquilino} color="green" />
        <StatCard label={`Pagados (${mesActual})`} value={pagadosEsteMes} color="green" />
        <StatCard label="Sin pago este mes" value={propiedadesConInquilino - pagadosEsteMes} color={propiedadesConInquilino - pagadosEsteMes > 0 ? 'red' : 'gray'} />
      </div>

      {/* Auto-scan pagos desde correo */}
      {emailConnection && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold text-gray-900">Pagos detectados en correo</h2>
            <Link href="/arrendador/email" className="text-xs text-blue-600 hover:underline">
              Ver todos →
            </Link>
          </div>
          <PagosDetectadosAuto />
        </div>
      )}

      {/* No tiene Gmail conectado */}
      {!emailConnection && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex items-center justify-between gap-4">
          <p className="text-sm text-amber-800">
            Conecta tu Gmail para detectar pagos automáticamente al entrar al panel.
          </p>
          <Link
            href="/arrendador/email"
            className="shrink-0 text-sm bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            Conectar Gmail
          </Link>
        </div>
      )}

      {/* Properties */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Mis propiedades</h2>
        {puedeAgregarMas ? (
          <Link
            href="/arrendador/propiedades/nueva"
            className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Nueva propiedad
          </Link>
        ) : (
          <span className="text-sm text-gray-400 px-4 py-2 rounded-lg border border-gray-200 cursor-not-allowed">
            Límite alcanzado ({MAX_PROPIEDADES}/10)
          </span>
        )}
      </div>

      {!propiedades || propiedades.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <p className="text-gray-500">No tienes propiedades registradas.</p>
            <Link href="/arrendador/propiedades/nueva" className="text-blue-600 hover:underline mt-2 inline-block">
              Agregar tu primera propiedad
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {propiedades.map((p: Propiedad) => {
            const contrato = (contratos ?? []).find((c: Contrato) => c.propiedad_id === p.id)
            const pp = p as Propiedad & { arrendatario_informal_nombre?: string; arrendatario_informal_fecha_fin?: string }
            const tieneInformal = !contrato && !!pp.arrendatario_informal_nombre
            const contratoVencido = tieneInformal && pp.arrendatario_informal_fecha_fin
              && new Date(pp.arrendatario_informal_fecha_fin) < new Date()

            // Estado del pago del mes
            const pagoFormal = contrato ? pagosFormalMap.get(contrato.id) : undefined
            const pagoInformal = tieneInformal ? pagosInformalMap.get(p.id) : undefined
            const pago = pagoFormal ?? pagoInformal

            const diaPago = contrato
              ? (contrato as Contrato & { dia_pago: number }).dia_pago
              : p.dia_vencimiento

            const pagado = pago?.estado === 'pagado' || pago?.estado === 'atrasado'
            const pagoConAtraso = pagado && (pago?.estado === 'atrasado' || esPagoAtrasado(diaPago ?? 5, pago?.fecha_pago, mesActual))
            const sinPagoAtrasado = !pagado && !!diaPago && diasDeAtraso(diaPago, mesActual) > 0
            const dias = sinPagoAtrasado ? diasDeAtraso(diaPago!, mesActual) : 0

            const tieneArrendatario = !!(contrato || tieneInformal)

            return (
              <Link key={p.id} href={`/arrendador/propiedades/${p.id}`}>
                <Card className={`hover:border-blue-300 transition-colors cursor-pointer h-full ${contratoVencido ? 'border-orange-200' : sinPagoAtrasado ? 'border-red-200' : pagoConAtraso ? 'border-orange-200' : ''}`}>
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-semibold text-gray-900">{p.nombre}</h3>
                    {contratoVencido ? (
                      <Badge variant="red">Necesita revisión</Badge>
                    ) : !tieneArrendatario ? (
                      <Badge variant="gray">Disponible</Badge>
                    ) : pagoConAtraso ? (
                      <Badge variant="yellow">Pagado con atraso</Badge>
                    ) : pagado ? (
                      <Badge variant="green">Pagado</Badge>
                    ) : sinPagoAtrasado ? (
                      <Badge variant="red">Atrasado</Badge>
                    ) : (
                      <Badge variant="yellow">Sin pago</Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mb-3">{p.direccion}</p>
                  <p className="text-lg font-bold text-blue-700">
                    {p.moneda === 'CLP' ? formatCLP(p.valor_uf) : `${formatUF(p.valor_uf)} UF`}/mes
                  </p>
                  {sinPagoAtrasado && (
                    <p className="text-xs text-red-500 mt-1">{dias} día{dias !== 1 ? 's' : ''} de atraso</p>
                  )}
                  {pagoConAtraso && p.multa_monto && (() => {
                    const fechaPago = pago?.fecha_pago ? new Date(pago.fecha_pago) : new Date()
                    const [year, month] = mesActual.split('-').map(Number)
                    const venc = new Date(year, month - 1, diaPago ?? 5)
                    fechaPago.setHours(0,0,0,0); venc.setHours(0,0,0,0)
                    const d = Math.max(0, Math.floor((fechaPago.getTime() - venc.getTime()) / 86400000))
                    const multa = d * p.multa_monto!
                    return d > 0 ? (
                      <p className="text-xs text-orange-500 mt-1">
                        Multa: {p.multa_moneda === 'CLP' ? `$${multa.toLocaleString('es-CL')}` : `${multa} ${p.multa_moneda}`} ({d} día{d !== 1 ? 's' : ''})
                      </p>
                    ) : null
                  })()}
                  <p className="text-xs mt-2 flex items-center gap-1">
                    {contrato
                      ? <><span className="text-gray-400">Arrendatario:</span> <span className="text-gray-700 font-medium">{(contrato as Contrato & { profiles: { nombre: string } }).profiles?.nombre}</span></>
                      : tieneInformal
                      ? <><span className="text-gray-400">Arrendatario:</span> <span className="text-gray-700 font-medium">{p.arrendatario_informal_nombre}</span></>
                      : <span className="text-amber-500 italic">Sin arrendatario vinculado</span>
                    }
                  </p>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    gray: 'bg-gray-50 text-gray-600 border-gray-100',
  }

  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  )
}
