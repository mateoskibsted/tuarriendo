'use client'

import { useState } from 'react'
import Input from '@/components/ui/Input'
import type { Propiedad, Moneda } from '@/lib/types'

export default function CamposPropiedad({ propiedad }: { propiedad?: Propiedad }) {
  const [moneda, setMoneda] = useState<Moneda>(propiedad?.moneda ?? 'UF')
  const [multaMoneda, setMultaMoneda] = useState<Moneda>(propiedad?.multa_moneda ?? 'UF')
  const [tieneMulta, setTieneMulta] = useState(!!propiedad?.multa_monto)

  return (
    <div className="space-y-5">
      {/* Nombre y dirección */}
      <Input
        label="Nombre de la propiedad"
        name="nombre"
        defaultValue={propiedad?.nombre}
        placeholder="Ej: Depto 201, Casa Las Condes"
        required
      />
      <Input
        label="Dirección"
        name="direccion"
        defaultValue={propiedad?.direccion}
        placeholder="Av. Providencia 123, Piso 2"
        required
      />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Descripción (opcional)</label>
        <textarea
          name="descripcion"
          rows={2}
          defaultValue={propiedad?.descripcion ?? ''}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="2 dormitorios, 1 baño, estacionamiento incluido..."
        />
      </div>

      {/* Moneda + valor */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Moneda del arriendo</label>
        <div className="flex rounded-lg border border-gray-200 p-1 mb-3 w-fit">
          {(['UF', 'CLP'] as Moneda[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMoneda(m)}
              className={`px-5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                moneda === m ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <input type="hidden" name="moneda" value={moneda} />
        <Input
          label={`Valor mensual en ${moneda}`}
          name="valor_uf"
          type="number"
          step={moneda === 'UF' ? '0.01' : '1'}
          min="0"
          defaultValue={propiedad?.valor_uf}
          placeholder={moneda === 'UF' ? 'Ej: 15.50' : 'Ej: 650000'}
          required
        />
      </div>

      {/* Día de vencimiento */}
      <Input
        label="Día de vencimiento del pago (cada mes)"
        name="dia_vencimiento"
        type="number"
        min={1}
        max={28}
        defaultValue={propiedad?.dia_vencimiento ?? 5}
        hint="Entre el 1 y el 28 de cada mes"
        required
      />

      {/* Multa */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Multa por atraso</label>
        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={tieneMulta}
            onChange={(e) => setTieneMulta(e.target.checked)}
            className="rounded border-gray-300 text-blue-600"
          />
          <span className="text-sm text-gray-600">Aplicar multa si el pago está atrasado</span>
        </label>

        {tieneMulta && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 space-y-3">
            <div className="flex rounded-lg border border-gray-200 p-1 w-fit bg-white">
              {(['UF', 'CLP'] as Moneda[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMultaMoneda(m)}
                  className={`px-5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    multaMoneda === m ? 'bg-amber-500 text-white' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <Input
              label={`Monto de la multa en ${multaMoneda}`}
              name="multa_monto"
              type="number"
              step={multaMoneda === 'UF' ? '0.01' : '1'}
              min="0"
              defaultValue={propiedad?.multa_monto ?? ''}
              placeholder={multaMoneda === 'UF' ? 'Ej: 0.5' : 'Ej: 20000'}
              required
            />
          </div>
        )}

        {/* Si no hay multa, limpiar el valor */}
        {!tieneMulta && <input type="hidden" name="multa_monto" value="" />}
        <input type="hidden" name="multa_moneda" value={multaMoneda} />
      </div>
    </div>
  )
}
