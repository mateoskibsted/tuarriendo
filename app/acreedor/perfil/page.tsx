import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logout } from '@/app/actions/auth'

export default async function PerfilPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('nombre, email, rut')
    .eq('id', user!.id)
    .single()

  const iniciales = (profile as { nombre?: string } | null)?.nombre
    ?.split(' ').slice(0, 2).map((n: string) => n[0]).join('').toUpperCase() ?? '?'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Perfil</h1>

      {/* Avatar + name */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gray-950 flex items-center justify-center text-white text-xl font-black shrink-0">
          {iniciales}
        </div>
        <div>
          <p className="text-lg font-bold text-gray-900">{(profile as { nombre?: string } | null)?.nombre ?? '—'}</p>
          <p className="text-sm text-gray-500">{user?.email}</p>
        </div>
      </div>

      {/* About */}
      <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
        <div className="px-5 py-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Versión</p>
          <p className="text-sm text-gray-800">Owe — Beta</p>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Cómo cobrar</p>
          <p className="text-sm text-gray-600">
            Crea una deuda, luego toca <strong>Cobrar</strong> para abrir WhatsApp con el mensaje listo para enviar.
            Cuando te paguen, marca la deuda como pagada desde el detalle.
          </p>
        </div>
      </div>

      {/* Logout */}
      <form action={logout}>
        <button
          type="submit"
          className="w-full py-4 rounded-2xl border border-red-200 text-red-600 font-semibold text-base hover:bg-red-50 transition-colors"
        >
          Cerrar sesión
        </button>
      </form>
    </div>
  )
}
