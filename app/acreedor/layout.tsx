import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import BottomNav from '@/components/BottomNav'

export default async function AcreedorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('*').eq('id', user.id).single()

  if (!profile) redirect('/login')
  if (profile.role !== 'arrendador') redirect('/deudor')

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top header */}
      <header className="bg-gray-950 text-white sticky top-0 z-40">
        <div className="max-w-screen-sm mx-auto px-4 h-14 flex items-center">
          <span className="font-black text-lg tracking-tight">Owe</span>
        </div>
      </header>

      {/* Page content — pb-20 leaves room for bottom nav */}
      <main className="flex-1 max-w-screen-sm mx-auto w-full px-4 py-6 pb-24">
        {children}
      </main>

      <BottomNav />
    </div>
  )
}
