'use client'

import { useState } from 'react'
import { guardarArrendatarioInformal, limpiarArrendatarioInformal } from '@/app/actions/arrendador'

interface Props {
  propiedadId: string
  nombreActual?: string | null
  celularActual?: string | null
}

export default function MarcarArrendadaSection({ propiedadId, nombreActual, celularActual }: Props) {
  const [mostrarModal, setMostrarModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [nombre, setNombre] = useState('')
  const [celular, setCelular] = useState('')
  const [error, setError] = useState('')

  const tieneInformal = !!nombreActual

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) {
      setError('El nombre es obligatorio')
      return
    }
    setLoading(true)
    const res = await guardarArrendatarioInformal(propiedadId, nombre.trim(), celular.trim())
    setLoading(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setMostrarModal(false)
  }

  async function handleLimpiar() {
    setLoading(true)
    await limpiarArrendatarioInformal(propiedadId)
    setLoading(false)
  }

  function abrirModal() {
    setNombre('')
    setCelular('')
    setError('')
    setMostrarModal(true)
  }

  if (tieneInformal) {
    return (
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-900">{nombreActual}</p>
          {celularActual && (
            <p className="text-xs text-blue-700 mt-0.5">{celularActual}</p>
          )}
          <p className="text-xs text-blue-400 mt-1">Registrado manualmente · sin cuenta en la app</p>
        </div>
        <button
          onClick={handleLimpiar}
          disabled={loading}
          className="shrink-0 text-xs text-red-500 hover:text-red-700 underline disabled:opacity-50"
        >
          Quitar
        </button>
      </div>
    )
  }

  return (
    <>
      <label className="flex items-center gap-3 cursor-pointer select-none group">
        <input
          type="checkbox"
          checked={false}
          onChange={abrirModal}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
        />
        <span className="text-sm text-gray-600 group-hover:text-gray-800">
          Marcar como arrendada (sin cuenta de arrendatario)
        </span>
      </label>

      {mostrarModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Datos del arrendatario</h3>
            <p className="text-xs text-gray-500 mb-4">
              Esta información queda guardada solo para tu referencia.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">
                  Nombre completo <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  placeholder="Ej: Juan Pérez"
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Número de celular</label>
                <input
                  type="tel"
                  value={celular}
                  onChange={e => setCelular(e.target.value)}
                  placeholder="+56 9 1234 5678"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setMostrarModal(false)}
                  className="flex-1 border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
