'use client'

import { useState, useTransition } from 'react'
import { crearPropiedad } from '@/app/actions/acreedor'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatRut, cleanRut } from '@/lib/utils/rut'

const inputClass = "block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('56') && digits.length === 11) return `+56 9 ${digits.slice(3, 7)} ${digits.slice(7)}`
  if (digits.startsWith('9') && digits.length === 9) return `+56 9 ${digits.slice(1, 5)} ${digits.slice(5)}`
  if (digits.length === 8) return `+56 9 ${digits.slice(0, 4)} ${digits.slice(4)}`
  return raw
}

function SectionHeader({ number, title, subtitle }: { number: string; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 px-6 py-4 border-b border-gray-100">
      <div className="w-7 h-7 rounded-full bg-blue-800 text-white text-sm font-bold flex items-center justify-center shrink-0 mt-0.5">
        {number}
      </div>
      <div>
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

function FieldLabel({ text, optional }: { text: string; optional?: boolean }) {
  return (
    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
      {text}
      {optional && <span className="text-gray-400 font-normal ml-1">(opcional)</span>}
    </label>
  )
}

export default function NuevaDeudaPage() {
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const [agregarDeudor, setAgregarDeudor] = useState(false)
  const [rutInput, setRutInput] = useState('')
  const [phoneInput, setPhoneInput] = useState('')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    // Set defaults for DB fields no longer shown in form
    formData.set('moneda', 'CLP')
    formData.set('dia_vencimiento', '1')
    startTransition(async () => {
      const result = await crearPropiedad(formData)
      if (result?.error) setError(result.error)
      else router.push('/acreedor')
    })
  }

  return (
    <div className="max-w-2xl">
      {/* Back + title */}
      <div className="mb-6">
        <Link href="/acreedor" className="text-sm text-gray-500 hover:text-gray-700">
          ← Volver al panel
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Nueva deuda</h1>
        <p className="text-gray-500 mt-1">Registra una deuda. El deudor puedes agregarlo ahora o después.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Paso 1: Info de la deuda */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <SectionHeader number="1" title="Información de la deuda" />
          <div className="p-6 space-y-5">
            <div>
              <FieldLabel text="Descripción" />
              <input
                name="nombre"
                className={inputClass}
                placeholder="Ej: Clases de inglés marzo, Gastos cena cumpleaños"
                required
              />
            </div>
            <div>
              <FieldLabel text="Monto (CLP)" />
              <input
                name="valor_uf"
                type="number"
                min="1"
                step="1"
                placeholder="Ej: 50000"
                required
                className={inputClass + ' max-w-xs'}
              />
            </div>
            <div>
              <FieldLabel text="Fecha límite de pago" optional />
              <input
                name="fecha_fin"
                type="date"
                className={inputClass + ' max-w-xs'}
              />
            </div>
            <div>
              <FieldLabel text="Notas" optional />
              <textarea
                name="descripcion"
                rows={2}
                className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent resize-none"
                placeholder="Detalles adicionales..."
              />
            </div>
          </div>
        </div>

        {/* Paso 2: Deudor */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-blue-800 text-white text-sm font-bold flex items-center justify-center shrink-0 mt-0.5">
                2
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Deudor</h2>
                <p className="text-sm text-gray-500 mt-0.5">Puedes agregarlo ahora o más tarde desde la ficha de la deuda</p>
              </div>
            </div>
            {!agregarDeudor && (
              <button
                type="button"
                onClick={() => setAgregarDeudor(true)}
                className="shrink-0 text-sm font-semibold text-blue-700 hover:text-blue-900 border border-blue-200 hover:border-blue-400 px-4 py-2 rounded-lg transition-colors"
              >
                + Agregar
              </button>
            )}
          </div>

          {!agregarDeudor && (
            <div className="px-6 py-5">
              <p className="text-sm text-gray-400 italic">Sin deudor — se puede agregar después</p>
            </div>
          )}

          {agregarDeudor && (
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <FieldLabel text="Nombre completo" />
                  <input name="arrendatario_nombre" className={inputClass} placeholder="Juan Pérez" required />
                </div>
                <div>
                  <FieldLabel text="RUT" optional />
                  <input
                    name="arrendatario_rut"
                    value={rutInput}
                    onChange={e => {
                      const raw = cleanRut(e.target.value)
                      setRutInput(raw.length > 1 ? formatRut(raw) : raw)
                    }}
                    placeholder="12.345.678-9"
                    className={inputClass}
                  />
                </div>
                <div>
                  <FieldLabel text="WhatsApp" optional />
                  <input
                    name="arrendatario_celular"
                    type="tel"
                    value={phoneInput}
                    onChange={e => setPhoneInput(e.target.value)}
                    onBlur={e => { if (e.target.value.trim()) setPhoneInput(formatPhone(e.target.value)) }}
                    placeholder="+56 9 1234 5678"
                    className={inputClass}
                  />
                  <p className="text-xs text-gray-400 mt-1">Para enviar recordatorios por WhatsApp</p>
                </div>
                <div>
                  <FieldLabel text="Email" optional />
                  <input name="arrendatario_email" type="email" placeholder="juan@ejemplo.cl" className={inputClass} />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAgregarDeudor(false)}
                className="text-sm text-gray-400 hover:text-gray-600 underline"
              >
                Quitar deudor
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pb-6">
          <Link
            href="/acreedor"
            className="px-5 py-3 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 sm:flex-none bg-blue-800 hover:bg-blue-900 text-white font-bold py-3 px-8 rounded-lg text-base transition-colors disabled:opacity-50"
          >
            {isPending ? 'Guardando...' : 'Crear deuda'}
          </button>
        </div>
      </form>
    </div>
  )
}
