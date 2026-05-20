'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { crearDeudaRecurrente } from '@/app/actions/acreedor'

function StepHeader({ step, total, title }: { step: number; total: number; title: string }) {
  return (
    <div className="px-5 pt-6 pb-4">
      <div className="flex items-center gap-1.5 mb-4">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${i < step ? 'bg-emerald-500' : 'bg-gray-200'}`}
          />
        ))}
      </div>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Paso {step} de {total}</p>
      <h2 className="text-xl font-bold text-gray-900 mt-1">{title}</h2>
    </div>
  )
}

const inputClass = "block w-full rounded-xl border border-gray-300 bg-white px-4 py-3.5 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"

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

const DIAS_SEMANA = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

function diaLabel(dia: number) {
  if (dia === 1) return '1° de cada mes'
  if (dia === 28) return '28 de cada mes (máx.)'
  return `${dia} de cada mes`
}

export default function NuevaDeudaRecurrentePage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [step, setStep] = useState(1)

  // Step 1
  const [titulo, setTitulo] = useState('')
  const [monto, setMonto] = useState('')
  const [diaVencimiento, setDiaVencimiento] = useState(5)
  const [descripcion, setDescripcion] = useState('')

  // Step 2
  const [deudorNombre, setDeudorNombre] = useState('')
  const [deudorCelular, setDeudorCelular] = useState('')

  const montoNum = parseFloat(monto) || 0

  function goStep2() {
    if (!titulo.trim() || montoNum <= 0) return
    setStep(2)
  }

  function goStep3() {
    if (!deudorNombre.trim()) return
    setStep(3)
  }

  function goStep4() {
    setStep(4)
  }

  const [waUrl, setWaUrl] = useState<string | null>(null)
  const [nombreFinal, setNombreFinal] = useState('')

  function handleConfirm() {
    setError('')
    startTransition(async () => {
      const result = await crearDeudaRecurrente({
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        monto: montoNum,
        diaVencimiento,
        deudorNombre: deudorNombre.trim(),
        deudorCelular: deudorCelular.trim() || null,
      })
      if (result?.error) {
        setError(result.error)
      } else {
        setWaUrl(result.waUrl ?? null)
        setNombreFinal(deudorNombre.trim())
        setStep(5)
      }
    })
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-lg mx-auto">
      <div className="px-5 pt-5">
        <button
          type="button"
          onClick={() => step > 1 ? setStep(step - 1) : router.push('/acreedor/deudas/nueva')}
          className="text-sm text-gray-500"
        >
          ← {step > 1 ? 'Atrás' : 'Cancelar'}
        </button>
      </div>

      {/* Step 1: Detalles del cobro */}
      {step === 1 && (
        <>
          <StepHeader step={1} total={4} title="¿En qué es el cobro?" />
          <div className="px-5 flex flex-col gap-4 flex-1">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Título</label>
              <input
                className={inputClass}
                placeholder="Ej: Arriendo depto, Clases de inglés"
                value={titulo}
                onChange={e => setTitulo(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Monto mensual (CLP)</label>
              <input
                className={inputClass}
                type="number"
                min="1"
                step="1"
                placeholder="Ej: 350000"
                value={monto}
                onChange={e => setMonto(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Día de vencimiento: <span className="text-emerald-600">{diaLabel(diaVencimiento)}</span>
              </label>
              <input
                type="range"
                min={1}
                max={28}
                value={diaVencimiento}
                onChange={e => setDiaVencimiento(parseInt(e.target.value))}
                className="w-full accent-emerald-500"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Día 1</span>
                <span>Día 28</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Descripción <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <textarea
                className="block w-full rounded-xl border border-gray-300 bg-white px-4 py-3.5 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                rows={2}
                placeholder="Detalles del cobro..."
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
              />
            </div>
          </div>
          <div className="px-5 py-6 mt-auto">
            <button
              type="button"
              onClick={goStep2}
              disabled={!titulo.trim() || montoNum <= 0}
              className="w-full bg-emerald-500 text-white font-bold py-4 rounded-2xl text-base disabled:opacity-40 active:bg-emerald-600 transition-colors"
            >
              Siguiente →
            </button>
          </div>
        </>
      )}

      {/* Step 2: Deudor */}
      {step === 2 && (
        <>
          <StepHeader step={2} total={4} title="¿Quién es el deudor?" />
          <div className="px-5 flex flex-col gap-4 flex-1">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nombre completo</label>
              <input
                className={inputClass}
                placeholder="Ej: Martín García"
                value={deudorNombre}
                onChange={e => setDeudorNombre(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                WhatsApp <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <input
                className={inputClass}
                type="tel"
                placeholder="+56 9 1234 5678"
                value={deudorCelular}
                onChange={e => setDeudorCelular(e.target.value)}
                onBlur={e => { if (e.target.value.trim()) setDeudorCelular(formatPhone(e.target.value)) }}
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Si agregas WhatsApp, el deudor recibirá una solicitud de opt-in para recordatorios automáticos.
              </p>
            </div>
          </div>
          <div className="px-5 py-6 mt-auto">
            <button
              type="button"
              onClick={goStep3}
              disabled={!deudorNombre.trim()}
              className="w-full bg-emerald-500 text-white font-bold py-4 rounded-2xl text-base disabled:opacity-40 active:bg-emerald-600 transition-colors"
            >
              Siguiente →
            </button>
          </div>
        </>
      )}

      {/* Step 3: Vista previa recordatorios */}
      {step === 3 && (
        <>
          <StepHeader step={3} total={4} title="Recordatorios automáticos" />
          <div className="px-5 flex flex-col gap-3 flex-1">
            <p className="text-sm text-gray-500">
              El bot enviará estos mensajes automáticamente cada mes.
              Vencimiento: día <strong>{diaVencimiento}</strong>.
            </p>
            {[
              { dias: 3, label: '3 días antes', icon: '📅', color: 'bg-blue-50 border-blue-100 text-blue-800' },
              { dias: 2, label: '2 días antes', icon: '⏰', color: 'bg-yellow-50 border-yellow-100 text-yellow-800' },
              { dias: 1, label: '1 día antes', icon: '⚡', color: 'bg-orange-50 border-orange-100 text-orange-800' },
              { dias: 0, label: 'Día de vencimiento', icon: '🔔', color: 'bg-red-50 border-red-100 text-red-800' },
            ].map(r => (
              <div key={r.dias} className={`rounded-2xl border p-4 ${r.color}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span>{r.icon}</span>
                  <span className="text-xs font-bold uppercase tracking-wide">{r.label}</span>
                </div>
                <p className="text-sm">
                  Hola <strong>{deudorNombre || 'Deudor'}</strong>, recuerda que tu pago de{' '}
                  <strong>{formatCLP(montoNum)}</strong> por <strong>{titulo}</strong> vence
                  {r.dias === 0 ? ' hoy' : ` en ${r.dias} día${r.dias > 1 ? 's' : ''}`}.
                </p>
              </div>
            ))}
            <div className="bg-gray-100 rounded-2xl p-4">
              <p className="text-xs text-gray-500 text-center">
                Los recordatorios solo se envían si el deudor acepta el opt-in de WhatsApp.
              </p>
            </div>
          </div>
          <div className="px-5 py-6 mt-auto">
            <button
              type="button"
              onClick={goStep4}
              className="w-full bg-emerald-500 text-white font-bold py-4 rounded-2xl text-base active:bg-emerald-600 transition-colors"
            >
              Siguiente →
            </button>
          </div>
        </>
      )}

      {/* Step 4: Confirmar */}
      {step === 4 && (
        <>
          <StepHeader step={4} total={4} title="Confirmar y activar" />
          <div className="px-5 flex flex-col gap-4 flex-1">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
              <p className="text-xs text-gray-400 uppercase font-medium tracking-wide">Resumen</p>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Cobro</span>
                <span className="text-sm font-bold text-gray-900">{titulo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Monto mensual</span>
                <span className="text-sm font-bold text-emerald-600">{formatCLP(montoNum)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Vencimiento</span>
                <span className="text-sm font-semibold text-gray-900">Día {diaVencimiento} de cada mes</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Deudor</span>
                <span className="text-sm font-semibold text-gray-900">{deudorNombre}</span>
              </div>
              {deudorCelular && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">WhatsApp</span>
                  <span className="text-sm font-semibold text-gray-900">{deudorCelular}</span>
                </div>
              )}
              {descripcion && (
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-500">{descripcion}</p>
                </div>
              )}
            </div>
            <div className="bg-green-50 rounded-2xl border border-green-100 p-4">
              <p className="text-sm text-green-800 font-medium">¿Qué pasa al crear?</p>
              <p className="text-xs text-green-700 mt-1">
                {deudorCelular
                  ? `Podrás cobrarle a ${deudorNombre} por WhatsApp directamente. Cada mes decides cuándo reenviar el cobro.`
                  : 'La deuda quedará activa. Puedes agregar WhatsApp después para cobrar.'}
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
              {isPending ? 'Creando...' : '✅ Crear cobro recurrente'}
            </button>
          </div>
        </>
      )}

      {/* Step 5: Success */}
      {step === 5 && (
        <div className="px-5 pt-10 flex flex-col gap-5 flex-1">
          <div className="text-center">
            <p className="text-5xl mb-4">🎉</p>
            <h2 className="text-2xl font-black text-gray-900">¡Cobro creado!</h2>
            <p className="text-gray-500 mt-2">
              {waUrl ? 'Toca Cobrar para abrir WhatsApp con el mensaje listo' : 'Tu cobro recurrente quedó guardado'}
            </p>
          </div>

          {waUrl && (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-center bg-green-700 hover:bg-green-800 text-white font-bold py-4 rounded-2xl text-base transition-colors"
            >
              💬 Cobrar a {nombreFinal}
            </a>
          )}

          <Link
            href="/acreedor"
            className="w-full text-center py-4 rounded-2xl border border-gray-200 bg-white text-gray-600 font-semibold text-base hover:bg-gray-50 transition-colors"
          >
            Ir al inicio
          </Link>
        </div>
      )}
    </div>
  )
}
