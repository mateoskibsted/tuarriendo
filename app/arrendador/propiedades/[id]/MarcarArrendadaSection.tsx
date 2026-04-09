'use client'

import { useState, useTransition } from 'react'
import { guardarArrendatarioInformal, limpiarArrendatarioInformal } from '@/app/actions/arrendador'
import type { Moneda, CobroTipo, Propiedad } from '@/lib/types'
import { formatUF, formatCLP } from '@/lib/utils/uf'
import { formatRut, cleanRut } from '@/lib/utils/rut'

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('56') && digits.length === 11) {
    return `+56 9 ${digits.slice(3, 7)} ${digits.slice(7)}`
  }
  if (digits.startsWith('9') && digits.length === 9) {
    return `+56 9 ${digits.slice(1, 5)} ${digits.slice(5)}`
  }
  if (digits.length === 8) {
    return `+56 9 ${digits.slice(0, 4)} ${digits.slice(4)}`
  }
  return raw
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('56') && digits.length === 11) return `+${digits}`
  if (digits.startsWith('9') && digits.length === 9) return `+56${digits}`
  if (digits.length === 8) return `+569${digits}`
  return raw
}

type Props = Pick<Propiedad,
  'id' | 'valor_uf' | 'moneda' | 'dia_vencimiento' | 'multa_monto' | 'multa_moneda' |
  'arrendatario_informal_nombre' | 'arrendatario_informal_rut' |
  'arrendatario_informal_email' | 'arrendatario_informal_celular' |
  'arrendatario_informal_cobro_tipo' | 'arrendatario_informal_fecha_inicio' | 'arrendatario_informal_fecha_fin'
>

function InfoFila({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  )
}

export default function MarcarArrendadaSection(props: Props) {
  const tiene = !!props.arrendatario_informal_nombre
  const [editando, setEditando] = useState(false)
  const [moneda, setMoneda] = useState<Moneda>(props.moneda ?? 'UF')
  const [multaMoneda, setMultaMoneda] = useState<Moneda>(props.multa_moneda ?? 'UF')
  const [tieneMulta, setTieneMulta] = useState(!!props.multa_monto)
  const [rutInput, setRutInput] = useState(props.arrendatario_informal_rut ? formatRut(props.arrendatario_informal_rut) : '')
  const [phoneInput, setPhoneInput] = useState(props.arrendatario_informal_celular ?? '')
  const [cobroTipo, setCobroTipo] = useState<CobroTipo>(props.arrendatario_informal_cobro_tipo ?? 'adelantado')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await guardarArrendatarioInformal(props.id, fd)
      if (res.error) setError(res.error)
      else setEditando(false)
    })
  }

  function handleQuitar() {
    if (!confirm('¿Quitar los datos del arrendatario?')) return
    startTransition(async () => {
      await limpiarArrendatarioInformal(props.id)
    })
  }

  const valorTexto = props.moneda === 'CLP'
    ? formatCLP(props.valor_uf)
    : `${formatUF(props.valor_uf)} UF`

  const multaTexto = props.multa_monto
    ? props.multa_moneda === 'CLP'
      ? formatCLP(props.multa_monto)
      : `${formatUF(props.multa_monto)} UF`
    : null

  // --- Read mode (has arrendatario, not editing) ---
  if (tiene && !editando) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <InfoFila label="Nombre" value={props.arrendatario_informal_nombre} />
          <InfoFila label="RUT" value={props.arrendatario_informal_rut ? formatRut(props.arrendatario_informal_rut) : undefined} />
          <InfoFila label="Email" value={props.arrendatario_informal_email} />
          <InfoFila label="WhatsApp" value={props.arrendatario_informal_celular ? formatPhone(props.arrendatario_informal_celular) : undefined} />
          <InfoFila label="Valor mensual" value={valorTexto} />
          <InfoFila label="Día de vencimiento" value={`Día ${props.dia_vencimiento} de cada mes`} />
          <InfoFila label="Tipo de cobro" value={props.arrendatario_informal_cobro_tipo === 'atrasado' ? 'Mes atrasado (cobra el mes siguiente)' : 'Mes adelantado (cobra al inicio del mes)'} />
          {props.arrendatario_informal_fecha_inicio && (
            <InfoFila label="Inicio contrato" value={new Date(props.arrendatario_informal_fecha_inicio + 'T12:00:00').toLocaleDateString('es-CL')} />
          )}
          {props.arrendatario_informal_fecha_fin && (
            <InfoFila label="Fin contrato" value={new Date(props.arrendatario_informal_fecha_fin + 'T12:00:00').toLocaleDateString('es-CL')} />
          )}
          {props.arrendatario_informal_fecha_fin && (() => {
            const fin = new Date(props.arrendatario_informal_fecha_fin + 'T12:00:00')
            const hoy = new Date()
            if (fin < hoy) return <InfoFila label="Estado contrato" value="⚠️ Contrato vencido — necesita revisión" />
            const meses = (fin.getFullYear() - hoy.getFullYear()) * 12 + (fin.getMonth() - hoy.getMonth())
            return <InfoFila label="Cobros restantes" value={`${meses + 1} meses`} />
          })()}
          {multaTexto && <InfoFila label="Multa diaria por atraso" value={multaTexto} />}
        </div>
        <div className="flex gap-3 pt-2 border-t border-gray-100">
          <button
            onClick={() => {
              setRutInput(props.arrendatario_informal_rut ? formatRut(props.arrendatario_informal_rut) : '')
              setPhoneInput(props.arrendatario_informal_celular ?? '')
              setCobroTipo(props.arrendatario_informal_cobro_tipo ?? 'adelantado')
              setEditando(true)
            }}
            className="text-sm text-blue-600 hover:underline"
          >
            Editar datos
          </button>
          <button
            onClick={handleQuitar}
            disabled={isPending}
            className="text-sm text-red-500 hover:underline disabled:opacity-50"
          >
            Quitar arrendatario
          </button>
        </div>
      </div>
    )
  }

  // --- Edit / Create form ---
  if (tiene || editando) {
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Datos personales */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre completo <span className="text-red-500">*</span>
            </label>
            <input
              name="nombre"
              defaultValue={props.arrendatario_informal_nombre ?? ''}
              placeholder="Juan Pérez González"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">RUT</label>
            <input
              name="rut"
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
            <input
              name="email"
              type="email"
              defaultValue={props.arrendatario_informal_email ?? ''}
              placeholder="juan@ejemplo.cl"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              WhatsApp <span className="text-xs text-gray-400">(para alertas de pago)</span>
            </label>
            <input
              name="celular"
              type="tel"
              value={phoneInput}
              onChange={e => setPhoneInput(e.target.value)}
              onBlur={e => {
                const v = e.target.value.trim()
                if (v) setPhoneInput(formatPhone(v))
              }}
              placeholder="+56 9 1234 5678"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Detalles del contrato */}
        <div className="border-t border-gray-100 pt-4 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contrato</p>

          {/* Moneda + valor */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Moneda del arriendo</label>
            <div className="flex rounded-lg border border-gray-200 p-1 w-fit mb-3">
              {(['UF', 'CLP'] as Moneda[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMoneda(m)}
                  className={`px-5 py-1.5 text-sm font-medium rounded-md transition-colors ${moneda === m ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <input type="hidden" name="moneda" value={moneda} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Valor mensual en {moneda} <span className="text-red-500">*</span>
              </label>
              <input
                name="valor_uf"
                type="number"
                step={moneda === 'UF' ? '0.01' : '1'}
                min="0"
                defaultValue={props.valor_uf || ''}
                placeholder={moneda === 'UF' ? 'Ej: 15.50' : 'Ej: 650000'}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Día de vencimiento */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Día de vencimiento <span className="text-red-500">*</span>
            </label>
            <input
              name="dia_vencimiento"
              type="number"
              min={1}
              max={28}
              defaultValue={props.dia_vencimiento ?? 5}
              required
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Entre el 1 y el 28 de cada mes</p>
          </div>

          {/* Tipo de cobro */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de cobro</label>
            <div className="flex rounded-lg border border-gray-200 p-1 w-fit">
              {([
                { value: 'adelantado', label: 'Adelantado' },
                { value: 'atrasado', label: 'Mes siguiente' },
              ] as { value: CobroTipo; label: string }[]).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCobroTipo(opt.value)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${cobroTipo === opt.value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {cobroTipo === 'adelantado'
                ? 'El arriendo se cobra al inicio del mes de uso (ej: abril se paga el 1 de abril)'
                : 'El arriendo se cobra al inicio del mes siguiente (ej: abril se paga el 1 de mayo)'}
            </p>
            <input type="hidden" name="cobro_tipo" value={cobroTipo} />
          </div>

          {/* Duración del contrato */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Duración del contrato</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Fecha inicio</label>
                <input
                  name="fecha_inicio"
                  type="date"
                  defaultValue={props.arrendatario_informal_fecha_inicio ?? ''}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Fecha fin</label>
                <input
                  name="fecha_fin"
                  type="date"
                  defaultValue={props.arrendatario_informal_fecha_fin ?? ''}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Multa */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={tieneMulta}
                onChange={e => setTieneMulta(e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">Aplicar multa diaria por atraso</span>
            </label>
            {tieneMulta && (
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 space-y-3">
                <div className="flex rounded-lg border border-gray-200 p-1 w-fit bg-white">
                  {(['UF', 'CLP'] as Moneda[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMultaMoneda(m)}
                      className={`px-5 py-1.5 text-sm font-medium rounded-md transition-colors ${multaMoneda === m ? 'bg-amber-500 text-white' : 'text-gray-600'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Monto diario en {multaMoneda}
                  </label>
                  <input
                    name="multa_monto"
                    type="number"
                    step={multaMoneda === 'UF' ? '0.01' : '1'}
                    min="0"
                    defaultValue={props.multa_monto ?? ''}
                    placeholder={multaMoneda === 'UF' ? 'Ej: 0.5' : 'Ej: 20000'}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
            {!tieneMulta && <input type="hidden" name="multa_monto" value="" />}
            <input type="hidden" name="multa_moneda" value={multaMoneda} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
          >
            {isPending ? 'Guardando...' : 'Guardar'}
          </button>
          {tiene && (
            <button
              type="button"
              onClick={() => setEditando(false)}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>
    )
  }

  // --- Empty state: no arrendatario yet ---
  return (
    <button
      onClick={() => setEditando(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-lg p-6 text-center hover:border-blue-300 hover:bg-blue-50 transition-colors group"
    >
      <p className="text-sm font-medium text-gray-600 group-hover:text-blue-700">
        + Agregar arrendatario
      </p>
      <p className="text-xs text-gray-400 mt-1">
        Ingresa los datos del inquilino y las condiciones del arriendo
      </p>
    </button>
  )
}
