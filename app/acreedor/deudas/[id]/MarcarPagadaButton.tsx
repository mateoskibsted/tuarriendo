'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { marcarDeudaComoPagada } from '@/app/actions/acreedor'

export default function MarcarPagadaButton({ deudaId }: { deudaId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function handleClick() {
    if (!confirm('¿Marcar esta deuda como pagada? Se moverá al historial.')) return
    setError('')
    startTransition(async () => {
      const res = await marcarDeudaComoPagada(deudaId)
      if (res.error) {
        setError(res.error)
      } else {
        router.push('/acreedor')
      }
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="w-full py-4 rounded-2xl border border-gray-200 bg-white text-gray-600 font-semibold text-base hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        {isPending ? 'Guardando...' : '✓ Marcar como pagada'}
      </button>
      {error && <p className="text-sm text-red-600 mt-2 text-center">{error}</p>}
    </div>
  )
}
