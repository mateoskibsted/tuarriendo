'use client'

import { useState } from 'react'
import Link from 'next/link'
import Badge from '@/components/ui/Badge'
import { formatCLP } from '@/lib/utils/currency'

export interface DeudaCardData {
  id: string
  nombre: string
  monto: number
  deudorNombre: string | null
  tieneDeudor: boolean
  badge: 'pagado' | 'pendiente' | 'atrasado' | 'sin_deudor' | 'vencida'
  diasAtraso: number
  tipo: 'simple' | 'recurrente'
}

const badgeProps: Record<DeudaCardData['badge'], { label: string; variant: 'green' | 'yellow' | 'red' | 'gray' | 'orange' }> = {
  pagado:    { label: 'Pagado',     variant: 'green' },
  pendiente: { label: 'Pendiente',  variant: 'yellow' },
  atrasado:  { label: 'No pagado',  variant: 'red' },
  sin_deudor:{ label: 'Sin deudor', variant: 'gray' },
  vencida:   { label: 'Vencida',    variant: 'red' },
}

function DeudaCard({ d }: { d: DeudaCardData }) {
  const b = badgeProps[d.badge]
  return (
    <Link href={`/acreedor/deudas/${d.id}`} className="block h-full">
      <div className={`bg-white border rounded-xl p-5 hover:border-blue-400 transition-colors h-full ${
        d.badge === 'vencida' ? 'border-orange-300' :
        d.badge === 'atrasado' ? 'border-red-300' :
        'border-gray-200'
      }`}>
        <div className="flex justify-between items-start mb-3">
          <h3 className="font-bold text-gray-900 text-base leading-tight pr-2">{d.nombre}</h3>
          <Badge variant={b.variant}>{b.label}</Badge>
        </div>
        <p className="text-xl font-bold text-blue-800 mb-1">{formatCLP(d.monto)}</p>
        {d.diasAtraso > 0 && (
          <p className="text-sm text-red-500">{d.diasAtraso} día{d.diasAtraso !== 1 ? 's' : ''} sin pagar</p>
        )}
        <p className="text-sm mt-2">
          {d.deudorNombre
            ? <><span className="text-gray-400">Deudor: </span><span className="text-gray-800 font-medium">{d.deudorNombre}</span></>
            : <span className="text-amber-500 italic">Sin deudor vinculado</span>
          }
        </p>
      </div>
    </Link>
  )
}

export default function DeudaListClient({
  deudas,
  puedeAgregarMas,
}: {
  deudas: DeudaCardData[]
  puedeAgregarMas: boolean
}) {
  const [tab, setTab] = useState<'simple' | 'recurrente'>('simple')

  const simples = deudas.filter(d => d.tipo === 'simple')
  const recurrentes = deudas.filter(d => d.tipo === 'recurrente')
  const activas = tab === 'simple' ? simples : recurrentes

  return (
    <section>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
        {/* Nueva deuda — first on mobile (full width), right on desktop */}
        <div className="md:order-2">
          {puedeAgregarMas ? (
            <Link
              href="/acreedor/deudas/nueva"
              className="block w-full md:w-auto text-center bg-green-700 hover:bg-green-800 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              + Nueva deuda
            </Link>
          ) : (
            <span className="block w-full md:w-auto text-center text-sm text-gray-400 px-4 py-2 rounded-lg border border-gray-200">Límite alcanzado</span>
          )}
        </div>

        {/* Toggle tabs — second on mobile (each 50%), left on desktop */}
        <div className="flex md:order-1 bg-gray-100 rounded-xl p-1 gap-1">
          <button
            type="button"
            onClick={() => setTab('simple')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === 'simple'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            👥 Simples
            {simples.length > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                tab === 'simple' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'
              }`}>
                {simples.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab('recurrente')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === 'recurrente'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            🔄 Recurrentes
            {recurrentes.length > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                tab === 'recurrente' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'
              }`}>
                {recurrentes.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {activas.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-500 mb-3">
            {tab === 'simple'
              ? 'No tienes deudas simples. Son gastos puntuales como cenas, ligas o préstamos.'
              : 'No tienes deudas recurrentes. Son cobros mensuales como arriendo o clases.'}
          </p>
          <Link href="/acreedor/deudas/nueva" className="inline-block bg-green-700 hover:bg-green-800 text-white font-semibold px-6 py-3 rounded-lg transition-colors text-sm">
            Crear deuda {tab === 'simple' ? 'simple' : 'recurrente'}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activas.map(d => <DeudaCard key={d.id} d={d} />)}
        </div>
      )}
    </section>
  )
}
