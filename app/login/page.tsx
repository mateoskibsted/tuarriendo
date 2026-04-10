'use client'

import { useState, useTransition } from 'react'
import { login } from '@/app/actions/auth'
import { formatRut, cleanRut } from '@/lib/utils/rut'
import Link from 'next/link'

export default function LoginPage() {
  const [rut, setRut] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleRutChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRut(formatRut(e.target.value))
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
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4">
      {/* Logo + marca */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-md">
          <span className="text-white font-black text-xl">TA</span>
        </div>
        <h1 className="text-3xl font-black text-gray-900">tuarriendo</h1>
        <p className="text-gray-500 mt-1">Gestión de arriendos en Chile</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Ingresar a mi cuenta</h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* RUT */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-gray-700">RUT</label>
            <input
              name="rut"
              value={rut}
              onChange={handleRutChange}
              placeholder="12.345.678-9"
              required
              autoComplete="username"
              className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"
            />
          </div>

          {/* Contraseña */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-gray-700">Contraseña</label>
            <input
              name="password"
              type="password"
              placeholder="••••••••"
              required
              autoComplete="current-password"
              className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"
            />
          </div>

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
            {isPending ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          ¿No tienes cuenta?{' '}
          <Link href="/registro" className="text-blue-700 hover:underline font-semibold">
            Regístrate aquí
          </Link>
        </p>
      </div>
    </div>
  )
}
