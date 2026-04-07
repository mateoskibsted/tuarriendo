'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { escanearEmails, confirmarPagoEmail } from '@/app/actions/email'
import type { PagoSugerido } from '@/lib/types'

function formatCLPLocal(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n)
}

const CONFIANZA_COLOR: Record<PagoSugerido['confianza'], string> = {
  alta: 'bg-green-100 text-green-800',
  media: 'bg-yellow-100 text-yellow-800',
  baja: 'bg-gray-100 text-gray-500',
}

export default function PagosDetectadosAuto() {
  const router = useRouter()
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando')
  const [sugerencias, setSugerencias] = useState<PagoSugerido[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    escanearEmails().then(result => {
      if (result.error) {
        setErrorMsg(result.error)
        setEstado('error')
      } else {
        // Only show suggestions with at least a detected amount
        setSugerencias((result.sugerencias ?? []).filter(s => !!s.monto_clp))
        setEstado('listo')
      }
    })
  }, [])

  async function handleConfirmar(s: PagoSugerido) {
    if (!s.contrato_id || !s.monto_clp) return
    setConfirming(s.emailId)
    const result = await confirmarPagoEmail(s.contrato_id, s.monto_clp, s.periodo)
    setConfirming(null)
    if (result.error) {
      alert(result.error)
    } else {
      setConfirmed(prev => new Set([...prev, s.emailId]))
      router.refresh() // Update property cards to show paid status
    }
  }

  const pendientes = sugerencias.filter(s => !confirmed.has(s.emailId) && !!s.contrato_id)
  const sinMatch = sugerencias.filter(s => !confirmed.has(s.emailId) && !s.contrato_id)

  if (estado === 'cargando') {
    return (
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center gap-3 text-blue-700 text-sm">
        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
        Escaneando correos en busca de transferencias...
      </div>
    )
  }

  if (estado === 'error') {
    return (
      <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-red-600 text-sm">
        Error al escanear correos: {errorMsg}
      </div>
    )
  }

  if (sugerencias.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-500 text-sm">
        No se detectaron transferencias en los últimos 30 días.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Pagos identificados con arrendatario */}
      {pendientes.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-green-50 border-b border-green-100">
            <p className="text-sm font-semibold text-green-800">
              {pendientes.length} pago(s) detectado(s) — confirma para registrarlos
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {pendientes.map(s => (
              <div key={s.emailId} className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{formatCLPLocal(s.monto_clp!)}</span>
                    {s.banco && <span className="text-xs text-gray-500">{s.banco}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONFIANZA_COLOR[s.confianza]}`}>
                      {s.confianza === 'alta' ? 'RUT coincide' : 'Nombre similar'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">
                    {s.arrendatario_nombre} — {s.propiedad_nombre}
                  </p>
                </div>
                {confirmed.has(s.emailId) ? (
                  <span className="text-green-600 text-sm font-medium shrink-0">Registrado</span>
                ) : (
                  <button
                    onClick={() => handleConfirmar(s)}
                    disabled={confirming === s.emailId}
                    className="shrink-0 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {confirming === s.emailId ? 'Registrando...' : 'Confirmar pago'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sin match — mostrar colapsado */}
      {sinMatch.length > 0 && (
        <p className="text-xs text-gray-400 px-1">
          {sinMatch.length} transferencia(s) detectada(s) sin arrendatario identificado —{' '}
          <a href="/arrendador/email" className="text-blue-500 hover:underline">ver en Correos y pagos</a>
        </p>
      )}
    </div>
  )
}
