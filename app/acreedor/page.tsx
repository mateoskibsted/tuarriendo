import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayInChile } from '@/lib/utils/date'
import PagosPendientesWhatsApp from './PagosPendientesWhatsApp'
import TelefonoArrendadorForm from './TelefonoArrendadorForm'
import DeudaListClient from './DeudaListClient'
import type { DeudaCardData } from './DeudaListClient'
import type { Propiedad, Contrato } from '@/lib/types'

const MAX_DEUDAS = 10

export default async function AcreedorDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const hoyChile = todayInChile()
  const mesActual = `${hoyChile.getFullYear()}-${String(hoyChile.getMonth() + 1).padStart(2, '0')}`

  const [{ data: propiedades }, { data: acreedorProfile }] = await Promise.all([
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

  const deudasInformalesIds = (propiedades ?? [])
    .filter((p: Propiedad) => !!(p as Propiedad & { arrendatario_informal_nombre?: string }).arrendatario_informal_nombre && !(contratos ?? []).find((c: Contrato) => c.propiedad_id === p.id))
    .map((p: Propiedad) => p.id)

  const { data: pagosInformalesEsteMes } = deudasInformalesIds.length > 0
    ? await admin.from('pagos').select('propiedad_id, estado, fecha_pago').in('propiedad_id', deudasInformalesIds).eq('periodo', mesActual)
    : { data: [] }

  const pagosInformalMap = new Map<string, PagoResumen>(
    (pagosInformalesEsteMes ?? [])
      .filter((p: PagoResumen) => p.propiedad_id)
      .map((p: PagoResumen) => [p.propiedad_id!, p])
  )

  function diasDeAtraso(diaPago: number, periodo?: string): number {
    const [year, month] = (periodo ?? mesActual).split('-').map(Number)
    const vencimiento = new Date(year, month - 1, diaPago)
    const hoy = todayInChile()
    if (hoy <= vencimiento) return 0
    return Math.floor((hoy.getTime() - vencimiento.getTime()) / (24 * 60 * 60 * 1000))
  }

  type PropExtended = Propiedad & {
    dia_vencimiento: number | null
    arrendatario_informal_nombre?: string | null
    arrendatario_informal_fecha_fin?: string | null
  }

  const deudasCards: DeudaCardData[] = (propiedades ?? []).map((raw: Propiedad) => {
    const p = raw as PropExtended
    const contrato = (contratos ?? []).find((c: Contrato) => c.propiedad_id === p.id)
    const tieneInformal = !contrato && !!p.arrendatario_informal_nombre
    const deudaVencida = !!(tieneInformal && p.arrendatario_informal_fecha_fin && new Date(p.arrendatario_informal_fecha_fin) < new Date())

    const pagoFormal = contrato ? pagosFormalMap.get(contrato.id) : undefined
    const pagoInformal = tieneInformal ? pagosInformalMap.get(p.id) : undefined
    const pago = pagoFormal ?? pagoInformal

    const diaPago = contrato ? (contrato as Contrato & { dia_pago: number }).dia_pago : p.dia_vencimiento ?? undefined
    const pagado = pago?.estado === 'pagado' || pago?.estado === 'atrasado'
    const sinPagoAtrasado = !pagado && !!diaPago && diasDeAtraso(diaPago, mesActual) > 0
    const dias = sinPagoAtrasado ? diasDeAtraso(diaPago!, mesActual) : 0
    const tieneDeudor = !!(contrato || tieneInformal)

    const nombreDeudor = contrato
      ? (contrato as Contrato & { profiles: { nombre: string } }).profiles?.nombre ?? null
      : tieneInformal ? p.arrendatario_informal_nombre ?? null : null

    const badge: DeudaCardData['badge'] = deudaVencida ? 'vencida'
      : !tieneDeudor ? 'sin_deudor'
      : pagado ? 'pagado'
      : sinPagoAtrasado ? 'atrasado'
      : 'pendiente'

    const tipo: 'simple' | 'recurrente' = p.dia_vencimiento === null ? 'simple' : 'recurrente'

    return {
      id: p.id,
      nombre: p.nombre,
      monto: Math.round(Number(p.valor_uf)),
      deudorNombre: nombreDeudor,
      tieneDeudor,
      badge,
      diasAtraso: dias,
      tipo,
    }
  })

  const pagadosEsteMesFormal = (pagosFormalesEsteMes ?? []).filter((p: PagoResumen) => p.estado === 'pagado' || p.estado === 'atrasado').length
  const pagadosEsteMesInformal = (pagosInformalesEsteMes ?? []).filter((p: PagoResumen) => p.estado === 'pagado' || p.estado === 'atrasado').length

  const totalDeudas = propiedades?.length ?? 0
  const puedeAgregarMas = totalDeudas < MAX_DEUDAS
  const deudasConDeudor = (contratos ?? []).length + deudasInformalesIds.length
  const pagadosEsteMes = pagadosEsteMesFormal + pagadosEsteMesInformal
  const sinPagoEsteMes = deudasConDeudor - pagadosEsteMes

  const [mesNum, anioNum] = (() => {
    const [y, m] = mesActual.split('-').map(Number)
    const nombres = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
    return [nombres[m - 1], y]
  })()

  const acreedorTelefono = (acreedorProfile as unknown as { telefono?: string | null } | null)?.telefono ?? null

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mi panel</h1>
        <p className="text-gray-500 mt-1">{mesNum} {anioNum}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Deudas activas" value={`${totalDeudas}`} sub={`de ${MAX_DEUDAS} disponibles`} color="blue" />
        <StatCard label="Con deudor" value={`${deudasConDeudor}`} sub={`de ${totalDeudas} deudas`} color="gray" />
        <StatCard label="Pagaron este mes" value={`${pagadosEsteMes}`} sub={deudasConDeudor > 0 ? `de ${deudasConDeudor} deudores` : 'sin deudores'} color="green" />
        <StatCard label="Sin pago" value={`${sinPagoEsteMes}`} sub={sinPagoEsteMes > 0 ? 'requieren atención' : 'todos al día'} color={sinPagoEsteMes > 0 ? 'red' : 'gray'} />
      </div>

      <PagosPendientesWhatsApp />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">💬</span>
          <h2 className="text-base font-semibold text-gray-900">Notificaciones por WhatsApp</h2>
        </div>
        <TelefonoArrendadorForm telefonoActual={acreedorTelefono} />
        {!acreedorTelefono && (
          <p className="text-xs text-gray-400 mt-3">
            Agrega tu número para recibir reportes de pago de tus deudores directamente en WhatsApp.
            Cuando un deudor escriba <em>Listo</em> al bot, recibirás una notificación para confirmar.
          </p>
        )}
      </div>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Mis deudas</h2>
        {deudasCards.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
            <p className="text-gray-500 text-lg mb-3">No tienes deudas registradas.</p>
            <a href="/acreedor/deudas/nueva" className="inline-block bg-green-700 hover:bg-green-800 text-white font-semibold px-6 py-3 rounded-lg transition-colors">
              Agregar primera deuda
            </a>
          </div>
        ) : (
          <DeudaListClient deudas={deudasCards} puedeAgregarMas={puedeAgregarMas} />
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
