'use client'

import { useState, useTransition } from 'react'
import { actualizarContrato } from '@/app/actions/arrendador'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

export default function ContratoSection({
  contratoId,
  valorUf,
  diaPago,
}: {
  contratoId: string
  valorUf: number
  diaPago: number
}) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await actualizarContrato(contratoId, formData)
      if (result?.error) setError(result.error)
      else setEditing(false)
    })
  }

  if (!editing) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
        Editar contrato
      </Button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 bg-gray-50 rounded-lg p-3 border w-full">
      <Input
        label="Valor UF"
        name="valor_uf"
        type="number"
        step="0.01"
        defaultValue={valorUf}
        required
        className="w-28"
      />
      <Input
        label="Día de pago"
        name="dia_pago"
        type="number"
        min={1}
        max={28}
        defaultValue={diaPago}
        required
        className="w-24"
      />
      <Input label="Fecha término" name="fecha_fin" type="date" className="w-40" />
      {error && <p className="text-sm text-red-600 w-full">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={isPending}>Guardar</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
      </div>
    </form>
  )
}
