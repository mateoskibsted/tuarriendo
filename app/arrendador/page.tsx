import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
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

  const mesActual = new Date().toISOString().slice(0, 7)

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
    if (hoy <= vencimiento) return 0
    return Math.floor((hoy.getTime() - vencimiento.getTime()) / (24 * 60 * 60 * 1000))
  }

  const pagadosEsteMesFormal = (pagosFormalesEsteMes ?? []).filter((p: PagoResumen) => p.estado === 'pagado' || p.estado === 'atrasado').length
  const pagadosEsteMesInformal = (pagosInformalesEsteMes ?? []).filter((p: PagoResumen) => p.estado === 'pagado' || p.estado === 'atrasado').length

  const { data: emailConnection } = await admin
    .from('email_connections')
    .select('id')
    .eq('arrendador_id', user!.id)
    .single()

  const totalPropiedades = propiedades?.length ?? 0
  const puedeAgregarMas = totalPropiedades < MAX_PROPIEDADES
  const propiedadesConInquilino = (contratos ?? []).length + propiedadesInformalesIds.length
  const pagadosEsteMes = pagadosEsteMesFormal + pagadosEsteMesInformal
  const sinPagoEsteMes = propiedadesConInquilino - pagadosEsteMes

  const [mesNum, anioNum] = (() => {
    const [y, m] = mesActual.split('-').map(Number)
    const nombres = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
    return [nombres[m - 1], y]
  })()

  return (
    <div className="space-y-8">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mi panel</h1>
        <p className="text-gray-500 mt-1">{mesNum} {anioNum}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Propiedades"
          value={`${totalPropiedades}`}
          sub={`de ${MAX_PROPIEDADES} disponibles`}
          color="blue"
        />
        <StatCard
          label="Con arrendatario"
          value={`${propiedadesConInquilino}`}
          sub={`de ${totalPropiedades} propiedades`}
          color="gray"
        />
        <StatCard
          label="Pagaron este mes"
          value={`${pagadosEsteMes}`}
          sub={propiedadesConInquilino > 0 ? `de ${propiedadesConInquilino} arrendatarios` : 'sin arrendatarios'}
          color="green"
        />
        <StatCard
          label="Sin pago"
          value={`${sinPagoEsteMes}`}
          sub={sinPagoEsteMes > 0 ? 'requieren atención' : 'todos al día'}
          color={sinPagoEsteMes > 0 ? 'red' : 'gray'}
        />
      </div>

      {/* Email scanner section */}
      {emailConnection ? (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-900">Pagos detectados en correo</h2>
            <Link href="/arrendador/email" className="text-sm text-blue-700 hover:underline font-medium">
              Ver historial →
            </Link>
          </div>
          <PagosDetectadosAuto />
        </section>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="font-semibold text-amber-900">Detecta pagos automáticamente</p>
            <p className="text-sm text-amber-700 mt-1">
              Conecta tu Gmail y el sistema identificará transferencias de tus arrendatarios en tus correos.
            </p>
          </div>
          <Link
            href="/arrendador/email"
            className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors text-center"
          >
            Conectar Gmail
          </Link>
        </div>
      )}

      {/* Properties section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Mis propiedades</h2>
          {puedeAgregarMas ? (
            <Link
              href="/arrendador/propiedades/nueva"
              className="bg-blue-800 hover:bg-blue-900 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              + Nueva propiedad
            </Link>
          ) : (
            <span className="text-sm text-gray-400 px-4 py-2 rounded-lg border border-gray-200">
              Límite alcanzado
            </span>
          )}
        </div>

        {!propiedades || propiedades.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
            <p className="text-gray-500 text-lg mb-3">No tienes propiedades registradas.</p>
            <Link
              href="/arrendador/propiedades/nueva"
              className="inline-block bg-blue-800 hover:bg-blue-900 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              Agregar primera propiedad
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {propiedades.map((p: Propiedad) => {
              const contrato = (contratos ?? []).find((c: Contrato) => c.propiedad_id === p.id)
              const pp = p as Propiedad & { arrendatario_informal_nombre?: string; arrendatario_informal_fecha_fin?: string }
              const tieneInformal = !contrato && !!pp.arrendatario_informal_nombre
              const contratoVencido = tieneInformal && pp.arrendatario_informal_fecha_fin
                && new Date(pp.arrendatario_informal_fecha_fin) < new Date()

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

              const nombreArrendatario = contrato
                ? (contrato as Contrato & { profiles: { nombre: string } }).profiles?.nombre
                : tieneInformal ? pp.arrendatario_informal_nombre : null

              return (
                <Link key={p.id} href={`/arrendador/propiedades/${p.id}`} className="block h-full">
                  <div className={`bg-white border rounded-xl p-5 hover:border-blue-400 transition-colors h-full ${
                    contratoVencido ? 'border-orange-300' :
                    sinPagoAtrasado ? 'border-red-300' :
                    pagoConAtraso ? 'border-orange-200' :
                    'border-gray-200'
                  }`}>
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="font-bold text-gray-900 text-base leading-tight pr-2">{p.nombre}</h3>
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
                    <p className="text-xl font-bold text-blue-800">
                      {p.moneda === 'CLP' ? formatCLP(p.valor_uf) : `${formatUF(p.valor_uf)} UF`}/mes
                    </p>
                    {sinPagoAtrasado && (
                      <p className="text-sm text-red-500 mt-1">{dias} día{dias !== 1 ? 's' : ''} de atraso</p>
                    )}
                    <p className="text-sm mt-2">
                      {nombreArrendatario
                        ? <><span className="text-gray-400">Arrendatario: </span><span className="text-gray-800 font-medium">{nombreArrendatario}</span></>
                        : <span className="text-amber-500 italic">Sin arrendatario vinculado</span>
                      }
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub: string
  color: 'blue' | 'green' | 'red' | 'gray'
}) {
  const styles = {
    blue: 'bg-blue-50 border-blue-100 text-blue-800',
    green: 'bg-green-50 border-green-100 text-green-800',
    red: 'bg-red-50 border-red-100 text-red-700',
    gray: 'bg-white border-gray-200 text-gray-700',
  }

  return (
    <div className={`rounded-xl border p-4 ${styles[color]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">{label}</p>
      <p className="text-4xl font-black leading-none">{value}</p>
      <p className="text-xs mt-2 opacity-70">{sub}</p>
    </div>
  )
}
