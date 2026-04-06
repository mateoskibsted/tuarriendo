'use client'

import { useState, useTransition } from 'react'
import { actualizarPropiedad } from '@/app/actions/arrendador'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { formatUF } from '@/lib/utils/uf'
import type { Propiedad } from '@/lib/types'

export default function EditarPropiedadForm({ propiedad }: { propiedad: Propiedad }) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await actualizarPropiedad(propiedad.id, formData)
      if (result?.error) setError(result.error)
      else setEditing(false)
    })
  }

  if (!editing) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Información de la propiedad</h3>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Editar
          </Button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Nombre</p>
            <p className="text-sm font-medium text-gray-900">{propiedad.nombre}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Valor mensual</p>
            <p className="text-sm font-bold text-blue-700">{formatUF(propiedad.valor_uf)} UF</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-gray-500 mb-0.5">Dirección</p>
            <p className="text-sm font-medium text-gray-900">{propiedad.direccion}</p>
          </div>
          {propiedad.descripcion && (
            <div className="col-span-2">
              <p className="text-xs text-gray-500 mb-0.5">Descripción</p>
              <p className="text-sm text-gray-700">{propiedad.descripcion}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-blue-300 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-base font-semibold text-gray-900">Editar propiedad</h3>
      </div>
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Nombre" name="nombre" defaultValue={propiedad.nombre} required />
          <Input
            label="Valor UF mensual"
            name="valor_uf"
            type="number"
            step="0.01"
            min="0"
            defaultValue={propiedad.valor_uf}
            required
          />
        </div>
        <Input label="Dirección" name="direccion" defaultValue={propiedad.direccion} required />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Descripción (opcional)</label>
          <textarea
            name="descripcion"
            rows={2}
            defaultValue={propiedad.descripcion ?? ''}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
          <Button type="submit" size="sm" loading={isPending}>Guardar cambios</Button>
        </div>
      </form>
    </div>
  )
}
