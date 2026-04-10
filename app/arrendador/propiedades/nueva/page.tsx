'use client'

import { useState, useTransition } from 'react'
import { crearPropiedad } from '@/app/actions/arrendador'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Moneda, CobroTipo } from '@/lib/types'
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

export default function NuevaPropiedadPage() {
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const [agregarArrendatario, setAgregarArrendatario] = useState(false)
  const [moneda, setMoneda] = useState<Moneda>('UF')
  const [multaMoneda, setMultaMoneda] = useState<Moneda>('UF')
  const [tieneMulta, setTieneMulta] = useState(false)
  const [cobroTipo, setCobroTipo] = useState<CobroTipo>('adelantado')
  const [rutInput, setRutInput] = useState('')
  const [phoneInput, setPhoneInput] = useState('')

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
      {/* Back + title */}
      <div className="mb-6">
        <Link href="/arrendador" className="text-sm text-gray-500 hover:text-gray-700">
          ← Volver al panel
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Nueva propiedad</h1>
        <p className="text-gray-500 mt-1">Completa los datos de la propiedad. El arrendatario puedes agregarlo ahora o después.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Paso 1: Info propiedad */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <SectionHeader number="1" title="Información de la propiedad" />
          <div className="p-6 space-y-5">
            <div>
              <FieldLabel text="Nombre de la propiedad" />
              <input name="nombre" className={inputClass} placeholder="Ej: Depto 201 Providencia" required />
            </div>
            <div>
              <FieldLabel text="Dirección" />
              <input name="direccion" className={inputClass} placeholder="Av. Providencia 123, Piso 2" required />
            </div>
            <div>
              <FieldLabel text="Descripción" optional />
              <textarea
                name="descripcion"
                rows={2}
                className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent resize-none"
                placeholder="2 dormitorios, 1 baño, estacionamiento incluido..."
              />
            </div>
          </div>
        </div>

        {/* Paso 2: Arrendatario */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-blue-800 text-white text-sm font-bold flex items-center justify-center shrink-0 mt-0.5">
                2
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Arrendatario</h2>
                <p className="text-sm text-gray-500 mt-0.5">Puedes agregarlo ahora o más tarde desde la ficha de la propiedad</p>
              </div>
            </div>
            {!agregarArrendatario && (
              <button
                type="button"
                onClick={() => setAgregarArrendatario(true)}
                className="shrink-0 text-sm font-semibold text-blue-700 hover:text-blue-900 border border-blue-200 hover:border-blue-400 px-4 py-2 rounded-lg transition-colors"
              >
                + Agregar
              </button>
            )}
          </div>

          {!agregarArrendatario && (
            <div className="px-6 py-5">
              <p className="text-sm text-gray-400 italic">Sin arrendatario — se puede agregar después</p>
            </div>
          )}

          {agregarArrendatario && (
            <div className="p-6 space-y-6">
              {/* Datos personales */}
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Datos personales</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel text="Nombre completo" />
                    <input name="arrendatario_nombre" className={inputClass} placeholder="Juan Pérez González" required />
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
                    <FieldLabel text="Email" optional />
                    <input name="arrendatario_email" type="email" placeholder="juan@ejemplo.cl" className={inputClass} />
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
                  </div>
                </div>
              </div>

              {/* Contrato */}
              <div className="border-t border-gray-100 pt-5 space-y-5">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Contrato</p>

                {/* Moneda */}
                <div>
                  <FieldLabel text="Moneda del arriendo" />
                  <div className="flex rounded-xl border border-gray-200 p-1 bg-gray-50 w-fit">
                    {(['UF', 'CLP'] as Moneda[]).map(m => (
                      <button key={m} type="button" onClick={() => setMoneda(m)}
                        className={`px-8 py-2.5 text-sm font-bold rounded-lg transition-colors ${moneda === m ? 'bg-blue-800 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                  <input type="hidden" name="moneda" value={moneda} />
                </div>

                {/* Valor */}
                <div>
                  <FieldLabel text={`Valor mensual en ${moneda}`} />
                  <input
                    name="valor_uf"
                    type="number"
                    step={moneda === 'UF' ? '0.01' : '1'}
                    min="0"
                    placeholder={moneda === 'UF' ? 'Ej: 15.50' : 'Ej: 650000'}
                    required
                    className={inputClass + ' max-w-xs'}
                  />
                </div>

                {/* Día vencimiento */}
                <div>
                  <FieldLabel text="Día de vencimiento del mes" />
                  <input
                    name="dia_vencimiento"
                    type="number"
                    min={1}
                    max={28}
                    defaultValue={5}
                    required
                    className={inputClass + ' max-w-[120px]'}
                  />
                  <p className="text-sm text-gray-400 mt-1.5">Entre el 1 y el 28 de cada mes</p>
                </div>

                {/* Tipo cobro */}
                <div>
                  <FieldLabel text="Tipo de cobro" />
                  <div className="flex rounded-xl border border-gray-200 p-1 bg-gray-50 w-fit">
                    {([
                      { value: 'adelantado', label: 'Adelantado' },
                      { value: 'atrasado', label: 'Mes siguiente' },
                    ] as { value: CobroTipo; label: string }[]).map(opt => (
                      <button key={opt.value} type="button" onClick={() => setCobroTipo(opt.value)}
                        className={`px-5 py-2.5 text-sm font-bold rounded-lg transition-colors ${cobroTipo === opt.value ? 'bg-blue-800 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-sm text-gray-400 mt-1.5">
                    {cobroTipo === 'adelantado' ? 'Se cobra al inicio del mes de uso' : 'Se cobra al inicio del mes siguiente'}
                  </p>
                  <input type="hidden" name="cobro_tipo" value={cobroTipo} />
                </div>

                {/* Fechas */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel text="Fecha inicio" optional />
                    <input name="fecha_inicio" type="date" className={inputClass} />
                  </div>
                  <div>
                    <FieldLabel text="Fecha fin" optional />
                    <input name="fecha_fin" type="date" className={inputClass} />
                  </div>
                </div>

                {/* Multa */}
                <div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tieneMulta}
                      onChange={e => setTieneMulta(e.target.checked)}
                      className="w-5 h-5 rounded border-gray-300 text-blue-700 focus:ring-blue-700"
                    />
                    <span className="text-sm font-semibold text-gray-700">Aplicar multa diaria por atraso</span>
                  </label>

                  {tieneMulta && (
                    <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-4">
                      <div className="flex rounded-xl border border-gray-200 p-1 bg-white w-fit">
                        {(['UF', 'CLP'] as Moneda[]).map(m => (
                          <button key={m} type="button" onClick={() => setMultaMoneda(m)}
                            className={`px-6 py-2 text-sm font-bold rounded-lg transition-colors ${multaMoneda === m ? 'bg-amber-500 text-white' : 'text-gray-600'}`}>
                            {m}
                          </button>
                        ))}
                      </div>
                      <div>
                        <FieldLabel text={`Monto diario en ${multaMoneda}`} />
                        <input
                          name="multa_monto"
                          type="number"
                          step={multaMoneda === 'UF' ? '0.01' : '1'}
                          min="0"
                          placeholder={multaMoneda === 'UF' ? 'Ej: 0.5' : 'Ej: 20000'}
                          required
                          className={inputClass + ' max-w-xs'}
                        />
                      </div>
                    </div>
                  )}
                  {!tieneMulta && <input type="hidden" name="multa_monto" value="" />}
                  <input type="hidden" name="multa_moneda" value={multaMoneda} />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAgregarArrendatario(false)}
                className="text-sm text-gray-400 hover:text-gray-600 underline"
              >
                Quitar arrendatario
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
            href="/arrendador"
            className="px-5 py-3 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 sm:flex-none bg-blue-800 hover:bg-blue-900 text-white font-bold py-3 px-8 rounded-lg text-base transition-colors disabled:opacity-50"
          >
            {isPending ? 'Guardando...' : 'Crear propiedad'}
          </button>
        </div>
      </form>
    </div>
  )
}
