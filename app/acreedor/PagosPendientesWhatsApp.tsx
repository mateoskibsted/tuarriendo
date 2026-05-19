import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import ConfirmarRechazarPago from './ConfirmarRechazarPago'
import type { PagoPendiente } from '@/lib/types'

export default async function PagosPendientesWhatsApp() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const [{ data: pendientes }, { count: totalHistorial }] = await Promise.all([
    admin.from('pagos_pendientes').select('*').eq('arrendador_id', user!.id).eq('estado', 'pendiente').order('created_at', { ascending: true }),
    admin.from('pagos_pendientes').select('*', { count: 'exact', head: true }).eq('arrendador_id', user!.id).in('estado', ['confirmado', 'rechazado']),
  ])

  const hayHistorial = (totalHistorial ?? 0) > 0

  if ((!pendientes || pendientes.length === 0) && !hayHistorial) return null

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-gray-900">Pagos reportados por WhatsApp</h2>
          {pendientes && pendientes.length > 0 && (
            <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded-full">
              {pendientes.length}
            </span>
          )}
        </div>
        {hayHistorial && (
          <Link href="/acreedor/historial" className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors">
            Ver historial →
          </Link>
        )}
      </div>

      {pendientes && pendientes.length > 0 ? (
        <div className="bg-white border border-green-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-green-50 border-b border-green-100">
            <p className="text-sm text-green-800">
              Tus deudores reportaron estos pagos por WhatsApp. Responde <strong>RESUELTO</strong> o <strong>PENDIENTE</strong> para actualizar el estado.
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {(pendientes as PagoPendiente[]).map(p => (
              <ConfirmarRechazarPago key={p.id} pago={p} />
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-4">
          <p className="text-sm text-gray-500">No hay pagos pendientes de confirmar.</p>
        </div>
      )}
    </section>
  )
}
