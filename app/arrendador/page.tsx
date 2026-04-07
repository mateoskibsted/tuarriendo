import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { formatUF, formatCLP } from '@/lib/utils/uf'
import type { Propiedad, Contrato } from '@/lib/types'

const MAX_PROPIEDADES = 10

export default async function ArrendadorDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: propiedades } = await admin
    .from('propiedades')
    .select('*')
    .eq('arrendador_id', user!.id)
    .eq('activa', true)
    .order('created_at', { ascending: false })

  const propiedadIds = (propiedades ?? []).map((p: Propiedad) => p.id)

  const { data: contratos } = propiedadIds.length > 0
    ? await admin
        .from('contratos')
        .select('*, propiedades(nombre), profiles!contratos_arrendatario_id_fkey(nombre, rut)')
        .in('propiedad_id', propiedadIds)
        .eq('activo', true)
    : { data: [] }

  const contratoIds = (contratos ?? []).map((c: Contrato) => c.id)
  const { data: pagosPendientes } = contratoIds.length > 0
    ? await admin
        .from('pagos')
        .select('id')
        .in('contrato_id', contratoIds)
        .eq('estado', 'pendiente')
    : { data: [] }

  const { data: pagosAtrasados } = contratoIds.length > 0
    ? await admin
        .from('pagos')
        .select('id')
        .in('contrato_id', contratoIds)
        .eq('estado', 'atrasado')
    : { data: [] }

  const totalPropiedades = propiedades?.length ?? 0
  const puedeAgregarMas = totalPropiedades < MAX_PROPIEDADES

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Panel de arrendador</h1>
        <p className="text-gray-500 mt-1">Gestiona tus propiedades y arrendatarios</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Propiedades" value={`${totalPropiedades}/${MAX_PROPIEDADES}`} color="blue" />
        <StatCard label="Arrendatarios activos" value={contratos?.length ?? 0} color="green" />
        <StatCard label="Pagos pendientes" value={pagosPendientes?.length ?? 0} color="yellow" />
        <StatCard label="Pagos atrasados" value={pagosAtrasados?.length ?? 0} color="red" />
      </div>

      {/* Quick links */}
      <div className="flex gap-3">
        <Link
          href="/arrendador/email"
          className="flex items-center gap-2 text-sm bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-2 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
          </svg>
          Correos y pagos
        </Link>
      </div>

      {/* Properties */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Mis propiedades</h2>
        {puedeAgregarMas ? (
          <Link
            href="/arrendador/propiedades/nueva"
            className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Nueva propiedad
          </Link>
        ) : (
          <span className="text-sm text-gray-400 px-4 py-2 rounded-lg border border-gray-200 cursor-not-allowed">
            Límite alcanzado ({MAX_PROPIEDADES}/10)
          </span>
        )}
      </div>

      {!propiedades || propiedades.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <p className="text-gray-500">No tienes propiedades registradas.</p>
            <Link href="/arrendador/propiedades/nueva" className="text-blue-600 hover:underline mt-2 inline-block">
              Agregar tu primera propiedad
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {propiedades.map((p: Propiedad) => {
            const contrato = (contratos ?? []).find((c: Contrato) => c.propiedad_id === p.id)
            return (
              <Link key={p.id} href={`/arrendador/propiedades/${p.id}`}>
                <Card className="hover:border-blue-300 transition-colors cursor-pointer h-full">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-semibold text-gray-900">{p.nombre}</h3>
                    <Badge variant={contrato ? 'green' : 'gray'}>
                      {contrato ? 'Ocupada' : 'Disponible'}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-500 mb-3">{p.direccion}</p>
                  <p className="text-lg font-bold text-blue-700">
                    {p.moneda === 'CLP' ? formatCLP(p.valor_uf) : `${formatUF(p.valor_uf)} UF`}/mes
                  </p>
                  <p className="text-xs mt-2 flex items-center gap-1">
                    {contrato
                      ? <><span className="text-gray-400">Arrendatario:</span> <span className="text-gray-700 font-medium">{(contrato as Contrato & { profiles: { nombre: string } }).profiles?.nombre}</span></>
                      : <span className="text-amber-500 italic">Sin arrendatario vinculado</span>
                    }
                  </p>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-100',
    red: 'bg-red-50 text-red-700 border-red-100',
  }

  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  )
}
