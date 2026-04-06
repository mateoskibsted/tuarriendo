'use client'

import { Suspense, useState, useTransition, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { registro } from '@/app/actions/auth'
import { formatRut, cleanRut } from '@/lib/utils/rut'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

export default function RegistroPage() {
  return (
    <Suspense>
      <RegistroForm />
    </Suspense>
  )
}

function RegistroForm() {
  const searchParams = useSearchParams()
  const codigoUrl = searchParams.get('codigo') ?? ''

  const [rut, setRut] = useState('')
  // Si viene con código en la URL es arrendatario
  const [role, setRole] = useState<'arrendador' | 'arrendatario'>(codigoUrl ? 'arrendatario' : 'arrendador')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  // Si el código llega después de la hidratación, cambia el rol
  useEffect(() => {
    if (codigoUrl) setRole('arrendatario')
  }, [codigoUrl])

  function handleRutChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRut(formatRut(e.target.value))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    formData.set('rut', cleanRut(rut))

    startTransition(async () => {
      const result = await registro(formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-lg">TA</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">tuarriendo</h1>
          <p className="text-gray-500 mt-1">Crear cuenta nueva</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Registro</h2>

          {/* Role selector */}
          <div className="flex rounded-lg border border-gray-200 p-1 mb-6">
            <button
              type="button"
              onClick={() => setRole('arrendador')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                role === 'arrendador'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Soy arrendador
            </button>
            <button
              type="button"
              onClick={() => setRole('arrendatario')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                role === 'arrendatario'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Soy arrendatario
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input type="hidden" name="role" value={role} />

            <Input
              label="Nombre completo"
              name="nombre"
              placeholder="Juan Pérez"
              required
            />
            <Input
              label="RUT"
              name="rut"
              value={rut}
              onChange={handleRutChange}
              placeholder="12.345.678-9"
              required
            />
            <Input
              label="Email"
              name="email"
              type="email"
              placeholder="juan@ejemplo.cl"
              required
            />
            <Input
              label="Contraseña"
              name="password"
              type="password"
              placeholder="Mínimo 8 caracteres"
              required
              minLength={8}
            />

            {role === 'arrendatario' && (
              <Input
                label="Código de invitación"
                name="codigo_invitacion"
                defaultValue={codigoUrl}
                placeholder="Ej: ABC12345"
                hint={codigoUrl ? 'Código recibido por WhatsApp' : 'Solicita este código a tu arrendador'}
                required
              />
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <Button type="submit" loading={isPending} className="w-full" size="lg">
              Crear cuenta
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="text-blue-600 hover:underline font-medium">
              Iniciar sesión
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
