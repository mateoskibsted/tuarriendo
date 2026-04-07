'use client'

import { useState, useTransition } from 'react'
import { crearPropiedad } from '@/app/actions/arrendador'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Card from '@/components/ui/Card'
import Link from 'next/link'
import CamposPropiedad from '../CamposPropiedad'

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
      if (result?.error) setError(result.error)
      else router.push('/arrendador')
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
        <form onSubmit={handleSubmit} className="space-y-5">
          <CamposPropiedad />

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Link href="/arrendador">
              <Button variant="secondary" type="button">Cancelar</Button>
            </Link>
            <Button type="submit" loading={isPending}>Crear propiedad</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
