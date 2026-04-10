import { logout } from '@/app/actions/auth'
import type { Profile } from '@/lib/types'
import { formatRut } from '@/lib/utils/rut'

export default function Navbar({ profile }: { profile: Profile }) {
  const iniciales = profile.nombre
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()

  return (
    <nav className="bg-blue-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white rounded-md flex items-center justify-center shrink-0">
              <span className="text-blue-900 font-black text-sm">TA</span>
            </div>
            <span className="text-lg font-bold tracking-tight">tuarriendo</span>
          </div>

          {/* Right: user + logout */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-sm font-bold shrink-0">
                {iniciales}
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold leading-tight">{profile.nombre.split(' ')[0]}</p>
                <p className="text-xs text-blue-300 leading-tight">{formatRut(profile.rut)}</p>
              </div>
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="text-sm font-medium text-blue-200 hover:text-white border border-blue-700 hover:border-blue-400 px-3 py-1.5 rounded-lg transition-colors"
              >
                Salir
              </button>
            </form>
          </div>
        </div>
      </div>
    </nav>
  )
}
