import { logout } from '@/app/actions/auth'
import type { Profile } from '@/lib/types'
import Button from './ui/Button'
import { formatRut } from '@/lib/utils/rut'

export default function Navbar({ profile }: { profile: Profile }) {
  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">TA</span>
            </div>
            <span className="font-semibold text-gray-900">tuarriendo</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-900">{profile.nombre}</p>
              <p className="text-xs text-gray-500">
                {formatRut(profile.rut)} ·{' '}
                <span className="capitalize">{profile.role}</span>
              </p>
            </div>
            <form action={logout}>
              <Button variant="secondary" size="sm" type="submit">
                Cerrar sesión
              </Button>
            </form>
          </div>
        </div>
      </div>
    </nav>
  )
}
