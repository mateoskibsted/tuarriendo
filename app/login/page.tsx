'use client'

import { useState, useTransition } from 'react'
import { login } from '@/app/actions/auth'
import Link from 'next/link'

const inputClass = "block w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-950 focus:border-transparent"

export default function LoginPage() {
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await login(formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gray-950 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-md">
          <span className="text-white font-black text-xl">Owe</span>
        </div>
        <h1 className="text-3xl font-black text-gray-900">Owe</h1>
        <p className="text-gray-500 mt-1">Cobra fácil por WhatsApp</p>
      </div>

      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Ingresar</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-gray-700">Email</label>
            <input
              name="email"
              type="email"
              placeholder="tu@email.com"
              required
              autoComplete="email"
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-gray-700">Contraseña</label>
            <input
              name="password"
              type="password"
              placeholder="••••••••"
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-gray-950 hover:bg-gray-800 text-white font-bold py-4 rounded-xl text-base transition-colors disabled:opacity-50 mt-2"
          >
            {isPending ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          ¿No tienes cuenta?{' '}
          <Link href="/registro" className="text-green-700 hover:underline font-semibold">
            Regístrate gratis
          </Link>
        </p>
      </div>
    </div>
  )
}
