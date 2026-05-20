'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  {
    href: '/acreedor',
    label: 'Inicio',
    icon: (active: boolean) => (
      <svg className={`w-6 h-6 ${active ? 'text-green-700' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.5 : 2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" />
      </svg>
    ),
    exact: true,
  },
  {
    href: '/acreedor/deudas/nueva',
    label: 'Nueva',
    icon: (active: boolean) => (
      <svg className={`w-6 h-6 ${active ? 'text-green-700' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.5 : 2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    ),
    exact: false,
  },
  {
    href: '/acreedor/historial',
    label: 'Historial',
    icon: (active: boolean) => (
      <svg className={`w-6 h-6 ${active ? 'text-green-700' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.5 : 2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
    exact: false,
  },
  {
    href: '/acreedor/perfil',
    label: 'Perfil',
    icon: (active: boolean) => (
      <svg className={`w-6 h-6 ${active ? 'text-green-700' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.5 : 2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    exact: false,
  },
]

export default function BottomNav() {
  const path = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-area-bottom">
      <div className="flex max-w-screen-sm mx-auto">
        {tabs.map(tab => {
          const active = tab.exact
            ? path === tab.href
            : path.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-xs font-medium transition-colors ${
                active ? 'text-green-700' : 'text-gray-400'
              }`}
            >
              {tab.icon(active)}
              <span>{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
