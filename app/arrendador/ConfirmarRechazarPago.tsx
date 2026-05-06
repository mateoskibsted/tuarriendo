'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmarPagoPendienteWeb, rechazarPagoPendienteWeb } from '@/app/actions/arrendador'
import type { PagoPendiente } from '@/lib/types'

function formatCLP(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)
}

function nombreMes(periodo: string) {
  const [y, m] = periodo.split('-').map(Number)
  const n = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${n[m - 1]} ${y}`
}

export default function ConfirmarRechazarPago({ pago }: { pago: PagoPendiente }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [accion, setAccion] = useState<'confirmar' | 'rechazar' | null>(null)
  const [error, setError] = useState('')

  const fecha = new Date(pago.created_at).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })

  function handleConfirmar() {
    setAccion('confirmar')
    setError('')
    startTransition(async () => {
      const res = await confirmarPagoPendienteWeb(pago.id)
      if (res.error) { setError(res.error); setAccion(null) }
      else router.refresh()
    })
  }

  function handleRechazar() {
    if (!confirm(`¿Rechazar el reporte de pago de ${formatCLP(pago.monto_clp)}?`)) return
    setAccion('rechazar')
    setError('')
    startTransition(async () => {
      const res = await rechazarPagoPendienteWeb(pago.id)
      if (res.error) { setError(res.error); setAccion(null) }
      else router.refresh()
    })
  }

  return (
    <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xl font-bold text-gray-900">{formatCLP(pago.monto_clp)}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 font-medium">WhatsApp</span>
        </div>
        <p className="text-sm text-gray-700 mt-0.5">
          <span className="font-medium">{pago.arrendatario_nombre ?? 'Arrendatario'}</span>
          <span className="text-gray-400"> — {nombreMes(pago.periodo)}</span>
        </p>
        <p className="text-xs text-gray-400 mt-0.5">Reportado: {fecha}</p>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={handleRechazar}
          disabled={isPending}
          className="px-4 py-2 text-sm font-semibold text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {accion === 'rechazar' && isPending ? 'Rechazando...' : 'Rechazar'}
        </button>
        <button
          onClick={handleConfirmar}
          disabled={isPending}
          className="px-5 py-2 text-sm font-bold bg-green-700 hover:bg-green-800 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {accion === 'confirmar' && isPending ? 'Confirmando...' : 'Confirmar pago'}
        </button>
      </div>
    </div>
  )
}
