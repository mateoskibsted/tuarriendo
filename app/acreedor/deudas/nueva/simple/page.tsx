'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
  const [meIncluyo, setMeIncluyo] = useState(true)
  const [deudores, setDeudores] = useState<Deudor[]>([{ nombre: '', celular: '', monto: 0 }])

  // Step 3 state — montos ajustados
  const [montos, setMontos] = useState<number[]>([])

  const [step, setStep] = useState(1)
  const [creadas, setCreadas] = useState<Array<{ nombre: string; monto: number; waUrl: string | null }>>([])
  const [tituloFinal, setTituloFinal] = useState('')

  const totalNum = parseFloat(total) || 0

  // Derived split values
  const partes = meIncluyo ? deudores.length + 1 : deudores.length
  const splitBase = partes > 0 ? Math.round(totalNum / partes) : 0
  const totalACobrar = splitBase * deudores.length
  const miParte = meIncluyo ? totalNum - totalACobrar : 0

  // ---------- Step transitions ----------

  function goStep2() {
    if (!titulo.trim() || !total || totalNum <= 0) return
    setStep(2)
  }

  function goStep3() {
    const valid = deudores.every(d => d.nombre.trim())
    if (!valid || deudores.length === 0) return
    // Auto-split: each deudor pays splitBase, remainder absorbed by acreedor's share
    const initial = deudores.map(() => splitBase)
    setMontos(initial)
    setStep(3)
  }

  function goStep4() {
    const sum = montos.reduce((a, b) => a + b, 0)
    if (Math.abs(sum - totalACobrar) > deudores.length) {
      setError(`Los montos suman ${formatCLP(sum)}, pero el total a cobrar es ${formatCLP(totalACobrar)}`)
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
      } else if (result?.creadas) {
        setTituloFinal(titulo.trim())
        setCreadas(result.creadas)
        setStep(5)
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
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Monto total de la cuenta (CLP)</label>
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

            {/* Me incluyo toggle */}
            <button
              type="button"
              onClick={() => setMeIncluyo(v => !v)}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border-2 transition-colors ${
                meIncluyo
                  ? 'bg-blue-50 border-blue-400'
                  : 'bg-white border-gray-200'
              }`}
            >
              <div className="text-left">
                <p className={`text-sm font-bold ${meIncluyo ? 'text-blue-800' : 'text-gray-700'}`}>
                  ¿Participas en la cuenta?
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {meIncluyo
                    ? `Sí — tu parte (${formatCLP(miParte > 0 ? miParte : splitBase)}) se descuenta del total`
                    : 'No — cobras el total completo a los demás'}
                </p>
              </div>
              <div className={`w-12 h-6 rounded-full transition-colors flex items-center px-1 ${meIncluyo ? 'bg-blue-500' : 'bg-gray-300'}`}>
                <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${meIncluyo ? 'translate-x-6' : 'translate-x-0'}`} />
              </div>
            </button>

            {/* Summary chip when meIncluyo */}
            {meIncluyo && totalNum > 0 && deudores.length > 0 && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 flex justify-between items-center">
                <span className="text-xs text-blue-700">
                  {deudores.length + 1} personas en total · cada uno paga
                </span>
                <span className="text-sm font-bold text-blue-800">{formatCLP(splitBase)}</span>
              </div>
            )}

            {/* Deudores */}
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

            {!meIncluyo && totalNum > 0 && deudores.length > 0 && (
              <p className="text-xs text-gray-400 text-center pb-2">
                División: {formatCLP(Math.round(totalNum / deudores.length))} por persona
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
            <p className="text-sm text-gray-500">
              {meIncluyo
                ? <>Tu parte es <strong>{formatCLP(miParte > 0 ? miParte : splitBase)}</strong>. Ajusta los montos de los demás si es necesario.</>
                : <>Cobras el total completo. Ajusta si la división no es igual.</>}
            </p>

            {/* Tu parte (acreedor) si meIncluyo */}
            {meIncluyo && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-center justify-between opacity-60">
                <div>
                  <p className="text-sm font-semibold text-blue-800">Tú (tu parte)</p>
                  <p className="text-xs text-blue-600">No se cobra — ya la pagas tú</p>
                </div>
                <span className="text-sm font-bold text-blue-800">{formatCLP(miParte > 0 ? miParte : splitBase)}</span>
              </div>
            )}

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
              <span className="text-sm text-gray-600">
                {meIncluyo ? 'Total a cobrar (sin tu parte)' : 'Total a cobrar'}
              </span>
              <span className={`text-sm font-bold ${
                Math.abs(montos.reduce((a, b) => a + b, 0) - totalACobrar) <= deudores.length
                  ? 'text-green-600'
                  : 'text-red-500'
              }`}>
                {formatCLP(montos.reduce((a, b) => a + b, 0))} / {formatCLP(totalACobrar)}
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
              <p className="text-xs text-gray-400 uppercase font-medium tracking-wide">Cuenta</p>
              <p className="text-lg font-bold text-gray-900">{titulo}</p>
              {descripcion && <p className="text-sm text-gray-500">{descripcion}</p>}
              <div className="flex justify-between text-sm pt-1">
                <span className="text-gray-500">Total cuenta</span>
                <span className="font-semibold text-gray-900">{formatCLP(totalNum)}</span>
              </div>
              {meIncluyo && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Tu parte (descontada)</span>
                  <span className="font-semibold text-blue-700">− {formatCLP(miParte > 0 ? miParte : splitBase)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm border-t border-gray-100 pt-1">
                <span className="text-gray-700 font-medium">Total a cobrar</span>
                <span className="font-bold text-blue-600">{formatCLP(totalACobrar)}</span>
              </div>
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
            <div className="bg-green-50 rounded-2xl border border-green-100 p-4">
              <p className="text-sm text-green-800 font-medium">¿Qué pasa al confirmar?</p>
              <p className="text-xs text-green-700 mt-1">
                Se crean las deudas y te abrimos WhatsApp para cada deudor con el mensaje listo para enviar.
                Cuando te paguen, marca la deuda como pagada desde el detalle.
              </p>
            </div>
            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
          </div>
          <div className="px-5 py-6 mt-auto">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isPending}
              className="w-full bg-green-700 text-white font-bold py-4 rounded-2xl text-base disabled:opacity-50 active:bg-green-800 transition-colors"
            >
              {isPending ? 'Creando...' : '✅ Crear deuda'}
            </button>
          </div>
        </>
      )}

      {/* Step 5: Success — cobrar */}
      {step === 5 && (
        <div className="px-5 pt-10 flex flex-col gap-5 flex-1">
          <div className="text-center">
            <p className="text-5xl mb-4">🎉</p>
            <h2 className="text-2xl font-black text-gray-900">¡Deuda creada!</h2>
            <p className="text-gray-500 mt-2">
              {creadas.filter(c => c.waUrl).length > 0
                ? 'Toca Cobrar para abrir WhatsApp con el mensaje listo'
                : 'Tu deuda quedó guardada'}
            </p>
          </div>

          <div className="space-y-3 mt-2">
            {creadas.map((c, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{c.nombre}</p>
                  <p className="text-sm text-gray-500">{formatCLP(c.monto)}</p>
                </div>
                {c.waUrl ? (
                  <a
                    href={c.waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 bg-green-700 hover:bg-green-800 text-white font-bold px-4 py-2.5 rounded-xl text-sm transition-colors"
                  >
                    💬 Cobrar
                  </a>
                ) : (
                  <span className="text-xs text-gray-400 shrink-0">Sin WhatsApp</span>
                )}
              </div>
            ))}
          </div>

          <Link
            href="/acreedor"
            className="w-full text-center py-4 rounded-2xl border border-gray-200 bg-white text-gray-600 font-semibold text-base hover:bg-gray-50 transition-colors mt-auto"
          >
            Ir al inicio
          </Link>
        </div>
      )}
    </div>
  )
}
