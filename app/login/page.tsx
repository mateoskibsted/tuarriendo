'use client'

import { useState, useTransition } from 'react'
import { login } from '@/app/actions/auth'
import { formatRut, cleanRut } from '@/lib/utils/rut'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

export default function LoginPage() {
  const [rut, setRut] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleRutChange(e: React.ChangeEvent<HTMLInputElement>) {
    const formatted = formatRut(e.target.value)
    setRut(formatted)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    formData.set('rut', cleanRut(rut))

    startTransition(async () => {
      const result = await login(formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-lg">AP</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">ArriendoPro</h1>
          <p className="text-gray-500 mt-1">Gestión de arriendos en Chile</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Iniciar sesión</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="RUT"
              name="rut"
              value={rut}
              onChange={handleRutChange}
              placeholder="12.345.678-9"
              required
              autoComplete="username"
            />
            <Input
              label="Contraseña"
              name="password"
              type="password"
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <Button type="submit" loading={isPending} className="w-full" size="lg">
              Ingresar
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            ¿No tienes cuenta?{' '}
            <Link href="/registro" className="text-blue-600 hover:underline font-medium">
              Registrarse
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
