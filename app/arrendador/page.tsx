import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import Badge from '@/components/ui/Badge'
import { formatUF, formatCLP, getUFValue } from '@/lib/utils/uf'
import { todayInChile } from '@/lib/utils/date'
import PagosPendientesWhatsApp from './PagosPendientesWhatsApp'
import TelefonoArrendadorForm from './TelefonoArrendadorForm'
import type { Propiedad, Contrato } from '@/lib/types'

const MAX_PROPIEDADES = 10

export default async function ArrendadorDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const hoyChile = todayInChile()
  const mesActual = `${hoyChile.getFullYear()}-${String(hoyChile.getMonth() + 1).padStart(2, '0')}`

  const [{ data: propiedades }, { data: arrendadorProfile }] = await Promise.all([
    admin.from('propiedades').select('*').eq('arrendador_id', user!.id).eq('activa', true).order('created_at', { ascending: false }),
    admin.from('profiles').select('telefono').eq('id', user!.id).single(),
  ])

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
    ? await admin.from('pagos').select('contrato_id, estado, fecha_pago').in('contrato_id', contratoIds).eq('periodo', mesActual)
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
    ? await admin.from('pagos').select('propiedad_id, estado, fecha_pago').in('propiedad_id', propiedadesInformalesIds).eq('periodo', mesActual)
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
  const ufHoy = await getUFValue()

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

  const arrendadorTelefono = (arrendadorProfile as unknown as { telefono?: string | null } | null)?.telefono ?? null

  return (
    <div className="space-y-8">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mi panel</h1>
        <p className="text-gray-500 mt-1">{mesNum} {anioNum}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Propiedades" value={`${totalPropiedades}`} sub={`de ${MAX_PROPIEDADES} disponibles`} color="blue" />
        <StatCard label="Con arrendatario" value={`${propiedadesConInquilino}`} sub={`de ${totalPropiedades} propiedades`} color="gray" />
        <StatCard label="Pagaron este mes" value={`${pagadosEsteMes}`} sub={propiedadesConInquilino > 0 ? `de ${propiedadesConInquilino} arrendatarios` : 'sin arrendatarios'} color="green" />
        <StatCard label="Sin pago" value={`${sinPagoEsteMes}`} sub={sinPagoEsteMes > 0 ? 'requieren atención' : 'todos al día'} color={sinPagoEsteMes > 0 ? 'red' : 'gray'} />
      </div>

      {/* Pending WhatsApp payments */}
      <PagosPendientesWhatsApp />

      {/* WhatsApp config */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">💬</span>
          <h2 className="text-base font-semibold text-gray-900">Notificaciones por WhatsApp</h2>
        </div>
        <TelefonoArrendadorForm telefonoActual={arrendadorTelefono} />
        {!arrendadorTelefono && (
          <p className="text-xs text-gray-400 mt-3">
            Agrega tu número para recibir reportes de pago de tus arrendatarios directamente en WhatsApp.
            Cuando un arrendatario escriba <em>Pagué</em> al bot, recibirás una notificación para confirmar.
          </p>
        )}
      </div>

      {/* Properties section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Mis propiedades</h2>
          {puedeAgregarMas ? (
            <Link href="/arrendador/propiedades/nueva" className="bg-blue-800 hover:bg-blue-900 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors">
              + Nueva propiedad
            </Link>
          ) : (
            <span className="text-sm text-gray-400 px-4 py-2 rounded-lg border border-gray-200">Límite alcanzado</span>
          )}
        </div>

        {!propiedades || propiedades.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
            <p className="text-gray-500 text-lg mb-3">No tienes propiedades registradas.</p>
            <Link href="/arrendador/propiedades/nueva" className="inline-block bg-blue-800 hover:bg-blue-900 text-white font-semibold px-6 py-3 rounded-lg transition-colors">
              Agregar primera propiedad
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {propiedades.map((p: Propiedad) => {
              const contrato = (contratos ?? []).find((c: Contrato) => c.propiedad_id === p.id)
              const pp = p as Propiedad & { arrendatario_informal_nombre?: string; arrendatario_informal_fecha_fin?: string }
              const tieneInformal = !contrato && !!pp.arrendatario_informal_nombre
              const contratoVencido = tieneInformal && pp.arrendatario_informal_fecha_fin && new Date(pp.arrendatario_informal_fecha_fin) < new Date()

              const pagoFormal = contrato ? pagosFormalMap.get(contrato.id) : undefined
              const pagoInformal = tieneInformal ? pagosInformalMap.get(p.id) : undefined
              const pago = pagoFormal ?? pagoInformal

              const diaPago = contrato ? (contrato as Contrato & { dia_pago: number }).dia_pago : p.dia_vencimiento
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
                    {p.moneda === 'CLP' ? (
                      <p className="text-xl font-bold text-blue-800">{formatCLP(p.valor_uf)} CLP/mes</p>
                    ) : (
                      <div>
                        <p className="text-xl font-bold text-blue-800">{formatUF(p.valor_uf)} UF/mes</p>
                        <p className="text-sm font-medium text-blue-500">≈ {formatCLP(Math.round(p.valor_uf * ufHoy))} CLP/mes</p>
                      </div>
                    )}
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

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: 'blue' | 'green' | 'red' | 'gray' }) {
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
