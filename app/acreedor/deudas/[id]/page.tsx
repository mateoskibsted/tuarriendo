import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatCLP } from '@/lib/utils/currency'
import { generarLinkCobro } from '@/lib/utils/whatsapp'
import MarcarPagadaButton from './MarcarPagadaButton'

export default async function DeudaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: deuda } = await admin
    .from('propiedades')
    .select('*')
    .eq('id', id)
    .eq('arrendador_id', user!.id)
    .single()

  if (!deuda) notFound()

  type DeudaRow = typeof deuda & {
    dia_vencimiento: number | null
    arrendatario_informal_nombre?: string | null
    arrendatario_informal_celular?: string | null
    descripcion?: string | null
    activa: boolean
  }

  const d = deuda as DeudaRow
  const monto = Math.round(Number(d.valor_uf))
  const celular = d.arrendatario_informal_celular ?? null
  const waUrlCobro = celular ? generarLinkCobro(celular, d.nombre, monto, false) : null
  const waUrlRecordatorio = celular ? generarLinkCobro(celular, d.nombre, monto, true) : null
  const tipo = d.dia_vencimiento === null ? 'simple' : 'recurrente'
  const isPagada = !d.activa

  return (
    <div className="space-y-5">
      {/* Back */}
      <Link href="/acreedor" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
        ← Volver
      </Link>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-black text-gray-900 leading-tight">{d.nombre}</h1>
            {d.descripcion && (
              <p className="text-sm text-gray-500 mt-1">{d.descripcion}</p>
            )}
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold shrink-0 ${
            isPagada ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-700'
          }`}>
            {isPagada ? 'Pagada ✓' : 'Pendiente'}
          </span>
        </div>

        <p className="text-4xl font-black text-gray-900 mt-4">{formatCLP(monto)}</p>

        <div className="flex items-center gap-2 mt-3">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            tipo === 'simple' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
          }`}>
            {tipo === 'simple' ? 'Deuda simple' : 'Deuda recurrente'}
          </span>
        </div>
      </div>

      {/* Debtor info */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Deudor</p>
        {d.arrendatario_informal_nombre ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Nombre</span>
              <span className="font-semibold text-gray-900">{d.arrendatario_informal_nombre}</span>
            </div>
            {celular && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">WhatsApp</span>
                <span className="font-semibold text-gray-900">{celular}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-amber-600 italic">Sin deudor vinculado</p>
        )}
      </div>

      {/* Actions */}
      {!isPagada && (
        <div className="space-y-3">
          {waUrlCobro && (
            <a
              href={waUrlCobro}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-green-700 hover:bg-green-800 text-white font-bold py-4 rounded-2xl text-base transition-colors"
            >
              💬 Cobrar por WhatsApp
            </a>
          )}
          {waUrlRecordatorio && (
            <a
              href={waUrlRecordatorio}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-white hover:bg-gray-50 text-gray-700 font-semibold py-4 rounded-2xl text-base border border-gray-200 transition-colors"
            >
              🔔 Enviar recordatorio
            </a>
          )}
          <MarcarPagadaButton deudaId={id} />
        </div>
      )}

      {isPagada && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
          <p className="text-2xl mb-1">✅</p>
          <p className="font-semibold text-green-800">Esta deuda fue marcada como pagada</p>
          <p className="text-sm text-green-600 mt-1">Aparece en tu historial</p>
        </div>
      )}
    </div>
  )
}
