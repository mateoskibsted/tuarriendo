'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { crearDeudaSimple } from '@/app/actions/acreedor'

interface Deudor {
  nombre: string
  celular: string
  monto: number
}

function StepHeader({ step, total, title }: { step: number; total: number; title: string }) {
  return (
    <div className="px-5 pt-6 pb-4">
      <div className="flex items-center gap-1.5 mb-4">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${i < step ? 'bg-blue-600' : 'bg-gray-200'}`}
          />
        ))}
      </div>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Paso {step} de {total}</p>
      <h2 className="text-xl font-bold text-gray-900 mt-1">{title}</h2>
    </div>
  )
}

const inputClass = "block w-full rounded-xl border border-gray-300 bg-white px-4 py-3.5 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('56') && digits.length === 11) return `+56 9 ${digits.slice(3, 7)} ${digits.slice(7)}`
  if (digits.startsWith('9') && digits.length === 9) return `+56 9 ${digits.slice(1, 5)} ${digits.slice(5)}`
  if (digits.length === 8) return `+56 9 ${digits.slice(0, 4)} ${digits.slice(4)}`
  return raw
}

function formatCLP(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n)
}

export default function NuevaDeudaSimplePage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  // Step 1 state
  const [titulo, setTitulo] = useState('')
  const [total, setTotal] = useState('')
  const [descripcion, setDescripcion] = useState('')

  // Step 2 state
  const [deudores, setDeudores] = useState<Deudor[]>([{ nombre: '', celular: '', monto: 0 }])

  // Step 3 state — montos ajustados
  const [montos, setMontos] = useState<number[]>([])

  const [step, setStep] = useState(1)

  const totalNum = parseFloat(total) || 0

  // ---------- Step transitions ----------

  function goStep2() {
    if (!titulo.trim() || !total || totalNum <= 0) return
    setStep(2)
  }

  function goStep3() {
    const valid = deudores.every(d => d.nombre.trim())
    if (!valid || deudores.length === 0) return
    // Auto-split equally
    const split = Math.round(totalNum / deudores.length)
    const initial = deudores.map(() => split)
    // Assign remainder to first
    const diff = totalNum - split * deudores.length
    if (diff !== 0) initial[0] += diff
    setMontos(initial)
    setStep(3)
  }

  function goStep4() {
    const sum = montos.reduce((a, b) => a + b, 0)
    if (Math.abs(sum - totalNum) > 1) {
      setError(`Los montos suman ${formatCLP(sum)}, pero el total es ${formatCLP(totalNum)}`)
      return
    }
    setError('')
    setStep(4)
  }

  // ---------- Deudores list helpers ----------

  function addDeudor() {
    setDeudores(prev => [...prev, { nombre: '', celular: '', monto: 0 }])
  }

  function updateDeudor(idx: number, field: keyof Deudor, value: string | number) {
    setDeudores(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d))
  }

  function removeDeudor(idx: number) {
    setDeudores(prev => prev.filter((_, i) => i !== idx))
  }

  // ---------- Submit ----------

  function handleConfirm() {
    setError('')
    const payload = deudores.map((d, i) => ({
      nombre: d.nombre.trim(),
      celular: d.celular.trim() || null,
      monto: montos[i],
    }))
    startTransition(async () => {
      const result = await crearDeudaSimple(titulo.trim(), descripcion.trim(), payload)
      if (result?.error) {
        setError(result.error)
      } else {
        router.push('/acreedor')
      }
    })
  }

  // ---------- Render ----------

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-lg mx-auto">
      {/* Back */}
      <div className="px-5 pt-5">
        <button
          type="button"
          onClick={() => step > 1 ? setStep(step - 1) : router.push('/acreedor/deudas/nueva')}
          className="text-sm text-gray-500"
        >
          ← {step > 1 ? 'Atrás' : 'Cancelar'}
        </button>
      </div>

      {/* Step 1: Datos del evento */}
      {step === 1 && (
        <>
          <StepHeader step={1} total={4} title="¿De qué es la deuda?" />
          <div className="px-5 flex flex-col gap-4 flex-1">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Título</label>
              <input
                className={inputClass}
                placeholder="Ej: Cena cumpleaños Javiera, Liga fútbol marzo"
                value={titulo}
                onChange={e => setTitulo(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Monto total (CLP)</label>
              <input
                className={inputClass}
                type="number"
                min="1"
                step="1"
                placeholder="Ej: 120000"
                value={total}
                onChange={e => setTotal(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Descripción <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <textarea
                className="block w-full rounded-xl border border-gray-300 bg-white px-4 py-3.5 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none"
                rows={2}
                placeholder="Detalles adicionales..."
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
              />
            </div>
          </div>
          <div className="px-5 py-6 mt-auto">
            <button
              type="button"
              onClick={goStep2}
              disabled={!titulo.trim() || totalNum <= 0}
              className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl text-base disabled:opacity-40 active:bg-blue-700 transition-colors"
            >
              Siguiente →
            </button>
          </div>
        </>
      )}

      {/* Step 2: Agregar personas */}
      {step === 2 && (
        <>
          <StepHeader step={2} total={4} title="¿Quiénes deben?" />
          <div className="px-5 flex flex-col gap-3 flex-1">
            {deudores.map((d, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-gray-700">Persona {i + 1}</span>
                  {deudores.length > 1 && (
                    <button type="button" onClick={() => removeDeudor(i)} className="text-xs text-red-400 hover:text-red-600">
                      Quitar
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-3">
                  <input
                    className={inputClass}
                    placeholder="Nombre completo"
                    value={d.nombre}
                    onChange={e => updateDeudor(i, 'nombre', e.target.value)}
                  />
                  <input
                    className={inputClass}
                    type="tel"
                    placeholder="WhatsApp (opcional)"
                    value={d.celular}
                    onChange={e => updateDeudor(i, 'celular', e.target.value)}
                    onBlur={e => { if (e.target.value.trim()) updateDeudor(i, 'celular', formatPhone(e.target.value)) }}
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addDeudor}
              className="flex items-center gap-2 text-blue-600 font-semibold text-sm py-3"
            >
              + Agregar otra persona
            </button>
            {totalNum > 0 && deudores.length > 0 && (
              <p className="text-xs text-gray-400 text-center pb-2">
                División automática: {formatCLP(Math.round(totalNum / deudores.length))} por persona
              </p>
            )}
          </div>
          <div className="px-5 py-6 mt-auto">
            <button
              type="button"
              onClick={goStep3}
              disabled={deudores.some(d => !d.nombre.trim())}
              className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl text-base disabled:opacity-40 active:bg-blue-700 transition-colors"
            >
              Siguiente →
            </button>
          </div>
        </>
      )}

      {/* Step 3: Ajustar montos */}
      {step === 3 && (
        <>
          <StepHeader step={3} total={4} title="Ajustar montos" />
          <div className="px-5 flex flex-col gap-3 flex-1">
            <p className="text-sm text-gray-500">Cambia los montos si la división no es igual. Total: <strong>{formatCLP(totalNum)}</strong></p>
            {deudores.map((d, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">{d.nombre}</p>
                  {d.celular && <p className="text-xs text-gray-400">{d.celular}</p>}
                </div>
                <div className="w-32">
                  <input
                    className="block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-600"
                    type="number"
                    min="0"
                    step="1"
                    value={montos[i] ?? 0}
                    onChange={e => setMontos(prev => prev.map((m, j) => j === i ? (parseInt(e.target.value) || 0) : m))}
                  />
                </div>
              </div>
            ))}
            {/* Running sum */}
            <div className="bg-gray-100 rounded-xl px-4 py-3 flex justify-between items-center">
              <span className="text-sm text-gray-600">Suma actual</span>
              <span className={`text-sm font-bold ${Math.abs(montos.reduce((a, b) => a + b, 0) - totalNum) <= 1 ? 'text-green-600' : 'text-red-500'}`}>
                {formatCLP(montos.reduce((a, b) => a + b, 0))} / {formatCLP(totalNum)}
              </span>
            </div>
            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
          </div>
          <div className="px-5 py-6 mt-auto">
            <button
              type="button"
              onClick={goStep4}
              className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl text-base active:bg-blue-700 transition-colors"
            >
              Siguiente →
            </button>
          </div>
        </>
      )}

      {/* Step 4: Confirmar */}
      {step === 4 && (
        <>
          <StepHeader step={4} total={4} title="Confirmar y enviar" />
          <div className="px-5 flex flex-col gap-4 flex-1">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
              <p className="text-xs text-gray-400 uppercase font-medium tracking-wide">Deuda</p>
              <p className="text-lg font-bold text-gray-900">{titulo}</p>
              {descripcion && <p className="text-sm text-gray-500">{descripcion}</p>}
              <p className="text-sm font-semibold text-blue-600">Total: {formatCLP(totalNum)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
              {deudores.map((d, i) => (
                <div key={i} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{d.nombre}</p>
                    {d.celular
                      ? <p className="text-xs text-gray-400">{d.celular} · recibirá WhatsApp</p>
                      : <p className="text-xs text-gray-400">Sin WhatsApp</p>
                    }
                  </div>
                  <span className="text-sm font-bold text-gray-900">{formatCLP(montos[i])}</span>
                </div>
              ))}
            </div>
            <div className="bg-blue-50 rounded-2xl border border-blue-100 p-4">
              <p className="text-sm text-blue-800 font-medium">¿Qué pasa al confirmar?</p>
              <p className="text-xs text-blue-600 mt-1">
                Cada deudor con WhatsApp recibirá un mensaje inmediato con el monto que debe.
                Cuando paguen, responderán <strong>LISTO</strong> y tú recibirás la notificación.
              </p>
            </div>
            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
          </div>
          <div className="px-5 py-6 mt-auto">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isPending}
              className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl text-base disabled:opacity-50 active:bg-blue-700 transition-colors"
            >
              {isPending ? 'Enviando...' : '✅ Confirmar y enviar'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
