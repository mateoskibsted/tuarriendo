'use client'

import { useState, useTransition } from 'react'
import { crearPropiedad } from '@/app/actions/arrendador'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Link from 'next/link'
import type { Moneda, CobroTipo } from '@/lib/types'
import { formatRut, cleanRut } from '@/lib/utils/rut'

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('56') && digits.length === 11) return `+56 9 ${digits.slice(3, 7)} ${digits.slice(7)}`
  if (digits.startsWith('9') && digits.length === 9) return `+56 9 ${digits.slice(1, 5)} ${digits.slice(5)}`
  if (digits.length === 8) return `+56 9 ${digits.slice(0, 4)} ${digits.slice(4)}`
  return raw
}

export default function NuevaPropiedadPage() {
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  // Arrendatario section toggle
  const [agregarArrendatario, setAgregarArrendatario] = useState(false)

  // Arrendatario form state
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
      <div className="mb-6">
        <Link href="/arrendador" className="text-sm text-gray-500 hover:text-gray-700">
          ← Volver al panel
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Nueva propiedad</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Sección 1: Información de la propiedad */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">Información de la propiedad</h2>
          </div>
          <div className="p-6 space-y-4">
            <Input label="Nombre" name="nombre" placeholder="Ej: Depto 201, Casa Las Condes" required />
            <Input label="Dirección" name="direccion" placeholder="Av. Providencia 123, Piso 2" required />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripción <span className="text-gray-400 font-normal">(opcional)</span></label>
              <textarea
                name="descripcion"
                rows={2}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="2 dormitorios, 1 baño, estacionamiento incluido..."
              />
            </div>
          </div>
        </div>

        {/* Sección 2: Arrendatario (opcional) */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Arrendatario</h2>
              <p className="text-sm text-gray-500 mt-0.5">Puedes agregar esto ahora o más tarde</p>
            </div>
            {!agregarArrendatario && (
              <button
                type="button"
                onClick={() => setAgregarArrendatario(true)}
                className="text-sm text-blue-600 hover:underline font-medium"
              >
                + Agregar arrendatario
              </button>
            )}
          </div>

          {agregarArrendatario && (
            <div className="p-6 space-y-5">
              {/* Datos personales */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Nombre completo *" name="arrendatario_nombre" placeholder="Juan Pérez González" required />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">RUT</label>
                  <input
                    name="arrendatario_rut"
                    value={rutInput}
                    onChange={e => {
                      const raw = cleanRut(e.target.value)
                      setRutInput(raw.length > 1 ? formatRut(raw) : raw)
                    }}
                    placeholder="12.345.678-9"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input name="arrendatario_email" type="email" placeholder="juan@ejemplo.cl"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp <span className="text-xs text-gray-400">(para alertas)</span></label>
                  <input
                    name="arrendatario_celular"
                    type="tel"
                    value={phoneInput}
                    onChange={e => setPhoneInput(e.target.value)}
                    onBlur={e => { if (e.target.value.trim()) setPhoneInput(formatPhone(e.target.value)) }}
                    placeholder="+56 9 1234 5678"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Contrato */}
              <div className="border-t border-gray-100 pt-4 space-y-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contrato</p>

                {/* Moneda + valor */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Moneda del arriendo *</label>
                  <div className="flex rounded-lg border border-gray-200 p-1 w-fit mb-3">
                    {(['UF', 'CLP'] as Moneda[]).map(m => (
                      <button key={m} type="button" onClick={() => setMoneda(m)}
                        className={`px-5 py-1.5 text-sm font-medium rounded-md transition-colors ${moneda === m ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                  <input type="hidden" name="moneda" value={moneda} />
                  <Input label={`Valor mensual en ${moneda} *`} name="valor_uf" type="number"
                    step={moneda === 'UF' ? '0.01' : '1'} min="0"
                    placeholder={moneda === 'UF' ? 'Ej: 15.50' : 'Ej: 650000'} required />
                </div>

                {/* Día vencimiento */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Día de vencimiento *</label>
                  <input name="dia_vencimiento" type="number" min={1} max={28} defaultValue={5} required
                    className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-gray-400 mt-1">Entre el 1 y el 28 de cada mes</p>
                </div>

                {/* Tipo de cobro */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de cobro</label>
                  <div className="flex rounded-lg border border-gray-200 p-1 w-fit">
                    {([{ value: 'adelantado', label: 'Adelantado' }, { value: 'atrasado', label: 'Mes siguiente' }] as { value: CobroTipo; label: string }[]).map(opt => (
                      <button key={opt.value} type="button" onClick={() => setCobroTipo(opt.value)}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${cobroTipo === opt.value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {cobroTipo === 'adelantado' ? 'Se cobra al inicio del mes de uso' : 'Se cobra al inicio del mes siguiente'}
                  </p>
                  <input type="hidden" name="cobro_tipo" value={cobroTipo} />
                </div>

                {/* Fechas contrato */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
                    <input name="fecha_inicio" type="date"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
                    <input name="fecha_fin" type="date"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                {/* Multa */}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer mb-3">
                    <input type="checkbox" checked={tieneMulta} onChange={e => setTieneMulta(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600" />
                    <span className="text-sm text-gray-700">Aplicar multa diaria por atraso</span>
                  </label>
                  {tieneMulta && (
                    <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 space-y-3">
                      <div className="flex rounded-lg border border-gray-200 p-1 w-fit bg-white">
                        {(['UF', 'CLP'] as Moneda[]).map(m => (
                          <button key={m} type="button" onClick={() => setMultaMoneda(m)}
                            className={`px-5 py-1.5 text-sm font-medium rounded-md transition-colors ${multaMoneda === m ? 'bg-amber-500 text-white' : 'text-gray-600'}`}>
                            {m}
                          </button>
                        ))}
                      </div>
                      <Input label={`Monto diario en ${multaMoneda}`} name="multa_monto" type="number"
                        step={multaMoneda === 'UF' ? '0.01' : '1'} min="0"
                        placeholder={multaMoneda === 'UF' ? 'Ej: 0.5' : 'Ej: 20000'} required />
                    </div>
                  )}
                  {!tieneMulta && <input type="hidden" name="multa_monto" value="" />}
                  <input type="hidden" name="multa_moneda" value={multaMoneda} />
                </div>
              </div>

              <button type="button" onClick={() => setAgregarArrendatario(false)}
                className="text-sm text-gray-400 hover:text-gray-600">
                — Quitar arrendatario
              </button>
            </div>
          )}

          {!agregarArrendatario && (
            <div className="px-6 py-4 text-sm text-gray-400 italic">Sin arrendatario — puedes agregarlo después</div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <Link href="/arrendador">
            <Button variant="secondary" type="button">Cancelar</Button>
          </Link>
          <Button type="submit" loading={isPending}>Crear propiedad</Button>
        </div>
      </form>
    </div>
  )
}
