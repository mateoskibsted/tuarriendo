'use client'

import { useState, useTransition } from 'react'
import { desvincularArrendatario } from '@/app/actions/arrendador'
import Button from '@/components/ui/Button'

export default function DesvincularButton({
  contratoId,
  nombreArrendatario,
}: {
  contratoId: string
  nombreArrendatario: string
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleDesvincular() {
    startTransition(async () => {
      const result = await desvincularArrendatario(contratoId)
      if (result?.error) setError(result.error)
    })
  }

  if (!confirmando) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirmando(true)}>
        Desvincular arrendatario
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
      <span className="text-sm text-red-700 font-medium">
        ¿Terminar contrato con {nombreArrendatario}?
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Button variant="danger" size="sm" loading={isPending} onClick={handleDesvincular}>
        Sí, terminar contrato
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirmando(false)}>
        Cancelar
      </Button>
    </div>
  )
}
