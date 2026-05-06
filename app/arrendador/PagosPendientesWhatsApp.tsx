import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ConfirmarRechazarPago from './ConfirmarRechazarPago'
import type { PagoPendiente } from '@/lib/types'

export default async function PagosPendientesWhatsApp() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: pendientes } = await admin
    .from('pagos_pendientes')
    .select('*')
    .eq('arrendador_id', user!.id)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true })

  if (!pendientes || pendientes.length === 0) return null

  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-lg font-bold text-gray-900">Pagos reportados por WhatsApp</h2>
        <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded-full">
          {pendientes.length}
        </span>
      </div>
      <div className="bg-white border border-green-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-green-50 border-b border-green-100">
          <p className="text-sm text-green-800">
            Tus arrendatarios reportaron estos pagos por WhatsApp. Confírmalos para registrarlos en el sistema.
          </p>
        </div>
        <div className="divide-y divide-gray-100">
          {(pendientes as PagoPendiente[]).map(p => (
            <ConfirmarRechazarPago key={p.id} pago={p} />
          ))}
        </div>
      </div>
    </section>
  )
}
