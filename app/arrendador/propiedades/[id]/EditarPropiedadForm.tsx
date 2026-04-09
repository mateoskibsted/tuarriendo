'use client'

import { useState, useTransition } from 'react'
import { actualizarPropiedad } from '@/app/actions/arrendador'
import Button from '@/components/ui/Button'
import type { Propiedad } from '@/lib/types'
import CamposPropiedad from '../CamposPropiedad'

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
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Editar</Button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Nombre</p>
            <p className="text-sm font-medium text-gray-900">{propiedad.nombre}</p>
          </div>
          <div>
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
      <form onSubmit={handleSubmit} className="p-6">
        <CamposPropiedad propiedad={propiedad} soloBasico />
        {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
        <div className="flex gap-2 mt-5">
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
          <Button type="submit" size="sm" loading={isPending}>Guardar cambios</Button>
        </div>
      </form>
    </div>
  )
}
