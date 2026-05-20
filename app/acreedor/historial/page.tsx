import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatCLP } from '@/lib/utils/currency'
import type { Propiedad } from '@/lib/types'

export default async function HistorialPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: deudas } = await admin
    .from('propiedades')
    .select('*')
    .eq('arrendador_id', user!.id)
    .eq('activa', false)
    .order('created_at', { ascending: false })

  type DeudaRow = Propiedad & {
    dia_vencimiento: number | null
    arrendatario_informal_nombre?: string | null
  }

  const rows = (deudas ?? []) as DeudaRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Historial</h1>
        <p className="text-sm text-gray-500 mt-1">Deudas marcadas como pagadas</p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
          <p className="text-3xl mb-3">📋</p>
          <p className="font-semibold text-gray-800">Sin pagos registrados</p>
          <p className="text-sm text-gray-400 mt-1">Las deudas que marques como pagadas aparecerán aquí</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((d: DeudaRow) => {
            const monto = Math.round(Number(d.valor_uf))
            const tipo = d.dia_vencimiento === null ? 'Simple' : 'Recurrente'
            const fecha = new Date(d.created_at).toLocaleDateString('es-CL', {
              day: '2-digit', month: '2-digit', year: 'numeric',
            })

            return (
              <div key={d.id} className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex justify-between items-start">
                  <div className="flex-1 pr-3">
                    <p className="font-bold text-gray-900">{d.nombre}</p>
                    {d.arrendatario_informal_nombre && (
                      <p className="text-sm text-gray-500 mt-0.5">{d.arrendatario_informal_nombre}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 font-semibold">Pagada ✓</span>
                      <span className="text-xs text-gray-400">{tipo} · {fecha}</span>
                    </div>
                  </div>
                  <span className="text-lg font-black text-gray-400 shrink-0">{formatCLP(monto)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
