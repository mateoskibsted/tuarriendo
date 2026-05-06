'use client'

import { useState, useTransition } from 'react'
import { actualizarTelefonoArrendador } from '@/app/actions/arrendador'

export default function TelefonoArrendadorForm({ telefonoActual }: { telefonoActual?: string | null }) {
  const [editando, setEditando] = useState(false)
  const [telefono, setTelefono] = useState(telefonoActual ?? '')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleGuardar() {
    setError('')
    startTransition(async () => {
      const result = await actualizarTelefonoArrendador(telefono)
      if (result.error) setError(result.error)
      else setEditando(false)
    })
  }

  if (!editando) {
    return (
      <div className="flex items-center gap-3">
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Tu WhatsApp (para recibir reportes de pago)</p>
          <p className="text-sm font-medium">
            {telefonoActual
              ? <span className="text-green-700">{telefonoActual} ✓</span>
              : <span className="text-amber-600 italic">Sin número — no recibirás reportes de pago por WhatsApp</span>
            }
          </p>
        </div>
        <button
          onClick={() => setEditando(true)}
          className="ml-auto text-xs text-blue-600 hover:underline shrink-0"
        >
          {telefonoActual ? 'Editar' : '+ Agregar'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">Número WhatsApp (con código de país)</p>
      <div className="flex gap-2">
        <input
          type="tel"
          value={telefono}
          onChange={e => setTelefono(e.target.value)}
          placeholder="+56 9 1234 5678"
          className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleGuardar}
          disabled={isPending}
          className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Guardando...' : 'Guardar'}
        </button>
        <button
          onClick={() => { setEditando(false); setTelefono(telefonoActual ?? '') }}
          className="text-sm text-gray-500 hover:text-gray-700 px-2"
        >
          Cancelar
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
