import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { formatCLP } from '@/lib/utils/currency'

function estadoBadge(estado: string) {
  if (estado === 'confirmado') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">RESUELTO</span>
  if (estado === 'rechazado') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">PENDIENTE</span>
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">Pendiente</span>
}

export default async function HistorialPagosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: pagos } = await admin
    .from('pagos_pendientes')
    .select('*, propiedades(nombre)')
    .eq('arrendador_id', user!.id)
    .in('estado', ['confirmado', 'rechazado'])
    .order('created_at', { ascending: false })

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/acreedor" className="text-gray-400 hover:text-gray-700 transition-colors">
          ← Volver
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Historial de pagos WhatsApp</h1>
          <p className="text-gray-500 text-sm mt-0.5">Todos los reportes de pago de tus deudores</p>
        </div>
      </div>

      {!pagos || pagos.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
          <p className="text-2xl mb-2">💬</p>
          <p className="text-gray-500">Aún no hay pagos confirmados o rechazados.</p>
          <p className="text-sm text-gray-400 mt-1">Los reportes de tus deudores aparecerán aquí.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">{pagos.length} reporte{pagos.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="divide-y divide-gray-100">
            {pagos.map((p: {
              id: string
              arrendatario_nombre?: string | null
              monto_clp: number
              periodo?: string | null
              estado: string
              created_at: string
              propiedades?: { nombre: string } | null
            }) => {
              const fecha = new Date(p.created_at).toLocaleString('es-CL', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })
              return (
                <div key={p.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-bold text-gray-900">{formatCLP(Math.round(Number(p.monto_clp)))}</span>
                      {estadoBadge(p.estado)}
                    </div>
                    <p className="text-sm text-gray-700 mt-0.5">
                      <span className="font-medium">{p.arrendatario_nombre ?? 'Deudor'}</span>
                      {p.propiedades?.nombre && (
                        <span className="text-gray-400"> — {p.propiedades.nombre}</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">Reportado: {fecha}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
