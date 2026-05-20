import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { formatCLP } from '@/lib/utils/currency'
import { generarLinkCobro } from '@/lib/utils/whatsapp'
import type { Propiedad } from '@/lib/types'

export default async function AcreedorDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: deudas } = await admin
    .from('propiedades')
    .select('*')
    .eq('arrendador_id', user!.id)
    .eq('activa', true)
    .order('created_at', { ascending: false })

  type DeudaRow = Propiedad & {
    dia_vencimiento: number | null
    arrendatario_informal_nombre?: string | null
    arrendatario_informal_celular?: string | null
  }

  const rows = (deudas ?? []) as DeudaRow[]
  const total = rows.reduce((sum, d) => sum + Math.round(Number(d.valor_uf)), 0)

  return (
    <div className="space-y-6">
      {/* Total owed */}
      <div className="bg-gray-950 text-white rounded-2xl p-6">
        <p className="text-sm text-gray-400 font-medium mb-1">Total pendiente</p>
        <p className="text-4xl font-black tracking-tight">{formatCLP(total)}</p>
        <p className="text-sm text-gray-400 mt-2">
          {rows.length === 0
            ? 'Sin deudas pendientes'
            : `${rows.length} deuda${rows.length !== 1 ? 's' : ''} activa${rows.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {/* Debt list */}
      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
          <p className="text-3xl mb-3">🎉</p>
          <p className="font-semibold text-gray-800">Sin deudas pendientes</p>
          <p className="text-sm text-gray-400 mt-1 mb-5">Crea una deuda para empezar a cobrar</p>
          <Link
            href="/acreedor/deudas/nueva"
            className="inline-block bg-green-700 hover:bg-green-800 text-white font-bold px-6 py-3 rounded-xl transition-colors"
          >
            + Nueva deuda
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((d: DeudaRow) => {
            const monto = Math.round(Number(d.valor_uf))
            const celular = d.arrendatario_informal_celular ?? null
            const waUrl = celular ? generarLinkCobro(celular, d.nombre, monto) : null
            const tipo = d.dia_vencimiento === null ? 'simple' : 'recurrente'

            return (
              <div key={d.id} className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1 pr-3">
                    <p className="font-bold text-gray-900 text-base leading-tight">{d.nombre}</p>
                    {d.arrendatario_informal_nombre && (
                      <p className="text-sm text-gray-500 mt-0.5">{d.arrendatario_informal_nombre}</p>
                    )}
                  </div>
                  <span className="text-xl font-black text-gray-900 shrink-0">{formatCLP(monto)}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    tipo === 'simple' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                  }`}>
                    {tipo === 'simple' ? 'Simple' : 'Recurrente'}
                  </span>
                  {!d.arrendatario_informal_nombre && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Sin deudor</span>
                  )}
                </div>

                <div className="flex gap-2 mt-4">
                  {waUrl ? (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 bg-green-700 hover:bg-green-800 text-white font-bold py-3 rounded-xl text-sm text-center transition-colors"
                    >
                      💬 Cobrar
                    </a>
                  ) : (
                    <Link
                      href={`/acreedor/deudas/${d.id}`}
                      className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-xl text-sm text-center transition-colors"
                    >
                      + Agregar deudor
                    </Link>
                  )}
                  <Link
                    href={`/acreedor/deudas/${d.id}`}
                    className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold rounded-xl text-sm transition-colors"
                  >
                    Ver
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
