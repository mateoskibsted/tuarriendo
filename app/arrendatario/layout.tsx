import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Navbar from '@/components/Navbar'
import type { Profile } from '@/lib/types'

export default async function ArrendatarioLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Use admin client so RLS never blocks the profile read
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // If no profile, go to login — never redirect to the opposite panel (causes loop)
  if (!profile) redirect('/login')
  if (profile.role !== 'arrendatario') redirect('/arrendador')

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar profile={profile as Profile} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
