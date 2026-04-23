import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import EmailPageClient from './EmailPageClient'
import type { EmailConnection } from '@/lib/types'

export default async function EmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: connection } = await admin
    .from('email_connections')
    .select('*')
    .eq('arrendador_id', user!.id)
    .single()

  const typedConnection = connection as EmailConnection | null

  // Detect proactively if the token looks expired (no refresh_token and expires_at in the past)
  const tokenExpired = !!(
    typedConnection &&
    !typedConnection.refresh_token &&
    typedConnection.expires_at &&
    new Date(typedConnection.expires_at) < new Date()
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/arrendador" className="text-gray-400 hover:text-gray-600">
          ← Panel
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Correo y pagos</h1>
      </div>

      {params.error === 'cancelled' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-800 text-sm">
          Conexión cancelada.
        </div>
      )}
      {params.error === 'token_error' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          Error al conectar con Google. Intenta nuevamente.
        </div>
      )}
      {params.success === 'connected' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm">
          Gmail reconectado correctamente. Ya puedes escanear tus correos.
        </div>
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
        <strong>¿Cómo funciona?</strong> tuarriendo busca en tu Gmail los correos de
        transferencias bancarias de los últimos 30 días, detecta el monto y el remitente, y
        los vincula con tus arrendatarios. Tú confirmas cada pago antes de registrarlo.
      </div>

      <EmailPageClient
        connected={!!typedConnection}
        emailAddress={typedConnection?.email}
        tokenExpired={tokenExpired}
      />
    </div>
  )
}
