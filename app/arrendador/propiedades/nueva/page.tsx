'use client'

import { useState, useTransition } from 'react'
import { crearPropiedad } from '@/app/actions/arrendador'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Card from '@/components/ui/Card'
import Link from 'next/link'

export default function NuevaPropiedadPage() {
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      const result = await crearPropiedad(formData)
      if (result?.error) {
        setError(result.error)
      } else {
        router.push('/arrendador')
      }
    })
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/arrendador" className="text-sm text-gray-500 hover:text-gray-700">
          ← Volver al panel
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Nueva propiedad</h1>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nombre de la propiedad"
            name="nombre"
            placeholder="Ej: Depto 201, Casa Las Condes"
            required
          />
          <Input
            label="Dirección"
            name="direccion"
            placeholder="Av. Providencia 123, Piso 2"
            required
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Descripción (opcional)
            </label>
            <textarea
              name="descripcion"
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="2 dormitorios, 1 baño, estacionamiento incluido..."
            />
          </div>
          <Input
            label="Valor en UF mensual"
            name="valor_uf"
            type="number"
            step="0.01"
            min="0"
            placeholder="Ej: 15.50"
            required
          />

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Link href="/arrendador">
              <Button variant="secondary" type="button">Cancelar</Button>
            </Link>
            <Button type="submit" loading={isPending}>
              Crear propiedad
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
