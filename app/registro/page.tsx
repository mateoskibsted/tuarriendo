'use client'

import { Suspense, useState, useTransition, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { registro } from '@/app/actions/auth'
import { formatRut, cleanRut } from '@/lib/utils/rut'
import Link from 'next/link'

export default function RegistroPage() {
  return (
    <Suspense>
      <RegistroForm />
    </Suspense>
  )
}

function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-gray-700">{label}</label>
      {children}
      {hint && <p className="text-sm text-gray-500">{hint}</p>}
    </div>
  )
}

const inputClass = "block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"

function RegistroForm() {
  const searchParams = useSearchParams()
  const codigoUrl = searchParams.get('codigo') ?? ''

  const [rut, setRut] = useState('')
  const [role, setRole] = useState<'arrendador' | 'arrendatario'>(codigoUrl ? 'arrendatario' : 'arrendador')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

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
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-10">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-md">
          <span className="text-white font-black text-xl">TA</span>
        </div>
        <h1 className="text-3xl font-black text-gray-900">tuarriendo</h1>
        <p className="text-gray-500 mt-1">Crea tu cuenta nueva</p>
      </div>

      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Registro</h2>

        {/* Role selector */}
        <div className="flex rounded-xl border border-gray-200 p-1 mb-6 bg-gray-50">
          <button
            type="button"
            onClick={() => setRole('arrendador')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
              role === 'arrendador'
                ? 'bg-blue-800 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Soy arrendador
          </button>
          <button
            type="button"
            onClick={() => setRole('arrendatario')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
              role === 'arrendatario'
                ? 'bg-blue-800 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Soy arrendatario
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <input type="hidden" name="role" value={role} />

          <FieldGroup label="Nombre completo">
            <input name="nombre" placeholder="Juan Pérez González" required className={inputClass} />
          </FieldGroup>

          <FieldGroup label="RUT">
            <input
              name="rut"
              value={rut}
              onChange={handleRutChange}
              placeholder="12.345.678-9"
              required
              className={inputClass}
            />
          </FieldGroup>

          <FieldGroup label="Email">
            <input name="email" type="email" placeholder="juan@ejemplo.cl" required className={inputClass} />
          </FieldGroup>

          <FieldGroup label="Contraseña" hint="Mínimo 8 caracteres">
            <input name="password" type="password" placeholder="••••••••" required minLength={8} className={inputClass} />
          </FieldGroup>

          {role === 'arrendatario' && (
            <>
              <FieldGroup label="WhatsApp" hint="Para recibir recordatorios de pago por WhatsApp">
                <input name="telefono" type="tel" placeholder="+56 9 1234 5678" required className={inputClass} />
              </FieldGroup>
              <FieldGroup
                label="Código de invitación"
                hint={codigoUrl ? 'Código recibido por WhatsApp' : 'Solicita este código a tu arrendador'}
              >
                <input
                  name="codigo_invitacion"
                  defaultValue={codigoUrl}
                  placeholder="Ej: ABC12345"
                  required
                  className={inputClass}
                />
              </FieldGroup>
            </>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-blue-800 hover:bg-blue-900 text-white font-bold py-3.5 px-6 rounded-lg text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {isPending ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-blue-700 hover:underline font-semibold">
            Inicia sesión aquí
          </Link>
        </p>
      </div>
    </div>
  )
}
