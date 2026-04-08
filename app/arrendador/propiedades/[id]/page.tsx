import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatUF } from '@/lib/utils/uf'
import { formatRut } from '@/lib/utils/rut'
import Badge from '@/components/ui/Badge'
import type { Pago } from '@/lib/types'
import EditarPropiedadForm from './EditarPropiedadForm'
import EliminarPropiedadButton from './EliminarPropiedadButton'
import CodigoInvitacionSection from './CodigoInvitacionSection'
import PagosSection from './PagosSection'
import ContratoSection from './ContratoSection'
import DesvincularButton from './DesvincularButton'
import MarcarArrendadaSection from './MarcarArrendadaSection'

export default async function PropiedadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: propiedad } = await admin
    .from('propiedades')
    .select('*')
    .eq('id', id)
    .eq('arrendador_id', user!.id)
    .single()

  if (!propiedad) notFound()

  const { data: contrato } = await admin
    .from('contratos')
    .select('*, profiles!contratos_arrendatario_id_fkey(nombre, rut, email)')
    .eq('propiedad_id', id)
    .eq('activo', true)
    .maybeSingle()

  const { data: codigos } = await admin
    .from('codigos_invitacion')
    .select('*')
    .eq('propiedad_id', id)
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: pagos } = contrato
    ? await admin
        .from('pagos')
        .select('*')
        .eq('contrato_id', contrato.id)
        .order('periodo', { ascending: false })
        .limit(24)
    : { data: [] }

  const arrendatario = contrato
    ? (contrato as { profiles: { nombre: string; rut: string; email: string } }).profiles
    : null

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <Link href="/arrendador" className="text-sm text-gray-500 hover:text-gray-700">
          ← Volver al panel
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{propiedad.nombre}</h1>
            <p className="text-gray-500 mt-0.5">{propiedad.direccion}</p>
          </div>
          <EliminarPropiedadButton propiedadId={id} />
        </div>
      </div>

      {/* Editar propiedad */}
      <EditarPropiedadForm propiedad={propiedad} />

      {/* Arrendatario */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Arrendatario</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {contrato
                ? 'Inquilino activo vinculado a esta propiedad'
                : propiedad.arrendatario_informal_nombre
                ? 'Arrendatario registrado manualmente'
                : 'Sin arrendatario activo'}
            </p>
          </div>
          {contrato ? (
            <Badge variant="green">Activo</Badge>
          ) : propiedad.arrendatario_informal_nombre ? (
            <Badge variant="blue">Arrendada</Badge>
          ) : null}
        </div>
        <div className="p-6">
          {contrato && arrendatario ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <InfoRow label="Nombre" value={arrendatario.nombre} />
                <InfoRow label="RUT" value={formatRut(arrendatario.rut)} />
                <InfoRow label="Email" value={arrendatario.email ?? '—'} />
                <InfoRow label="Desde" value={new Date(contrato.fecha_inicio).toLocaleDateString('es-CL')} />
                <InfoRow label="Día de pago" value={`Día ${contrato.dia_pago} de cada mes`} />
                <InfoRow label="Valor pactado" value={`${formatUF(contrato.valor_uf)} UF/mes`} />
              </div>
              <div className="pt-2 border-t border-gray-100 flex items-center gap-3">
                <ContratoSection contratoId={contrato.id} valorUf={contrato.valor_uf} diaPago={contrato.dia_pago} />
                <DesvincularButton contratoId={contrato.id} nombreArrendatario={arrendatario.nombre} />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <MarcarArrendadaSection
                propiedadId={id}
                nombreActual={propiedad.arrendatario_informal_nombre}
                celularActual={propiedad.arrendatario_informal_celular}
              />
              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm text-gray-600 mb-3">
                  O genera un código de invitación para que tu arrendatario se registre y quede vinculado a esta propiedad.
                </p>
                <CodigoInvitacionSection propiedadId={id} codigos={codigos ?? []} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pagos */}
      {contrato ? (
        <PagosSection
          contratoId={contrato.id}
          valorUf={contrato.valor_uf}
          pagos={(pagos as Pago[]) ?? []}
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-2">Pagos</h3>
          <p className="text-sm text-gray-500">Disponible una vez que haya un arrendatario vinculado.</p>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  )
}
