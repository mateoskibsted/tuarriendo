import { createClient } from '@/lib/supabase/server'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { formatUF, formatCLP, getUFValue } from '@/lib/utils/uf'
import type { Pago, EstadoPago } from '@/lib/types'

const estadoBadge: Record<EstadoPago, { label: string; variant: 'green' | 'red' | 'yellow' | 'orange' | 'blue' | 'gray' }> = {
  pagado: { label: 'Pagado', variant: 'green' },
  pendiente: { label: 'Pendiente', variant: 'yellow' },
  atrasado: { label: 'Pagado (tarde)', variant: 'green' },
  incompleto: { label: 'Incompleto', variant: 'orange' },
}

export default async function ArrendatarioDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: contrato } = await supabase
    .from('contratos')
    .select('*, propiedades(*), profiles!contratos_arrendatario_id_fkey(nombre, rut, email)')
    .eq('arrendatario_id', user!.id)
    .eq('activo', true)
    .single()

  const { data: pagos } = contrato
    ? await supabase
        .from('pagos')
        .select('*')
        .eq('contrato_id', contrato.id)
        .order('periodo', { ascending: false })
        .limit(24)
    : { data: [] }

  const ufActual = await getUFValue()

  if (!contrato) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center">
        <div className="bg-white rounded-xl border border-gray-200 p-8">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🏠</span>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Sin propiedad asignada</h2>
          <p className="text-gray-500 mt-2 text-sm">
            Tu cuenta está creada pero aún no tienes una propiedad asignada.
            Contacta a tu arrendador para que complete el proceso.
          </p>
        </div>
      </div>
    )
  }

  const propiedad = contrato.propiedades
  const valorCLPEstimado = contrato.valor_uf * ufActual

  const pagosPendientes = (pagos ?? []).filter((p: Pago) => p.estado === 'pendiente')
  const pagosAtrasados = (pagos ?? []).filter((p: Pago) => p.estado === 'atrasado')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mi arriendo</h1>
        <p className="text-gray-500 mt-1">Información de tu propiedad y pagos</p>
      </div>

      {/* Alerts */}
      {pagosAtrasados.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-sm font-medium text-red-800">
            Tienes {pagosAtrasados.length} pago(s) atrasado(s). Contacta a tu arrendador.
          </p>
        </div>
      )}
      {pagosPendientes.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
          <p className="text-sm font-medium text-yellow-800">
            Tienes {pagosPendientes.length} pago(s) pendiente(s) este período.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Property info */}
        <Card title="Mi propiedad">
          <div className="space-y-3">
            <div>
              <p className="text-sm text-gray-500">Nombre</p>
              <p className="font-semibold text-gray-900">{propiedad.nombre}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Dirección</p>
              <p className="font-medium text-gray-900">{propiedad.direccion}</p>
            </div>
            {propiedad.descripcion && (
              <div>
                <p className="text-sm text-gray-500">Descripción</p>
                <p className="text-sm text-gray-700">{propiedad.descripcion}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-gray-500">Desde</p>
              <p className="font-medium">{new Date(contrato.fecha_inicio).toLocaleDateString('es-CL')}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Día de pago</p>
              <p className="font-medium">Día {contrato.dia_pago} de cada mes</p>
            </div>
          </div>
        </Card>

        {/* Payment amount */}
        <Card title="Monto mensual">
          <div className="space-y-4">
            <div>
              <p className="text-4xl font-bold text-blue-700">{formatUF(contrato.valor_uf)} UF</p>
              <p className="text-sm text-gray-500 mt-1">Valor pactado en contrato</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">Equivalente aprox. hoy</p>
              <p className="text-2xl font-bold text-blue-900">{formatCLP(valorCLPEstimado)}</p>
              <p className="text-xs text-gray-500 mt-1">UF hoy: {formatCLP(ufActual)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Payment history */}
      <Card title="Historial de pagos" subtitle="Últimos 24 meses">
        {!pagos || pagos.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">Sin pagos registrados aún</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 font-medium text-gray-500">Período</th>
                  <th className="text-right py-2 font-medium text-gray-500">Valor UF</th>
                  <th className="text-right py-2 font-medium text-gray-500">Valor CLP</th>
                  <th className="text-center py-2 font-medium text-gray-500">Estado</th>
                  <th className="text-right py-2 font-medium text-gray-500">Fecha pago</th>
                </tr>
              </thead>
              <tbody>
                {(pagos as Pago[]).map((pago) => {
                  const badge = estadoBadge[pago.estado]
                  return (
                    <tr key={pago.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 font-mono text-gray-700">{pago.periodo}</td>
                      <td className="py-2.5 text-right font-medium">{formatUF(pago.valor_uf)} UF</td>
                      <td className="py-2.5 text-right text-gray-500">
                        {pago.valor_clp ? formatCLP(pago.valor_clp) : '—'}
                      </td>
                      <td className="py-2.5 text-center">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                      <td className="py-2.5 text-right text-gray-500">
                        {pago.fecha_pago
                          ? new Date(pago.fecha_pago).toLocaleDateString('es-CL')
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
