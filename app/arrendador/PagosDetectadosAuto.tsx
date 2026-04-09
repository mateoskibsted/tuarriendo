'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { escanearEmails, confirmarPagoEmail, confirmarPagoEmailInformal } from '@/app/actions/email'
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
  const [errorMsg, setErrorMsg] = useState('')
  const [montos, setMontos] = useState<Record<string, string>>({})

  useEffect(() => {
    escanearEmails().then(result => {
      if (result.error) {
        setErrorMsg(result.error)
        setEstado('error')
      } else {
          setSugerencias(result.sugerencias ?? [])
        setEstado('listo')
      }
    })
  }, [])

  async function handleConfirmar(s: PagoSugerido) {
    const monto = s.monto_clp ?? parseInt(montos[s.emailId] ?? '0')
    if (!monto) return
    setConfirming(s.emailId)
    const result = s.contrato_id
      ? await confirmarPagoEmail(s.contrato_id, monto, s.periodo)
      : await confirmarPagoEmailInformal(s.propiedad_id!, monto, s.periodo)
    setConfirming(null)
    if (result.error) {
      alert(result.error)
    } else {
      setSugerencias(prev => prev.filter(x => x.emailId !== s.emailId))
      router.refresh()
    }
  }

  const pendientes = sugerencias.filter(s => !!s.contrato_id || !!s.propiedad_id)
  const sinMatch = sugerencias.filter(s => !s.contrato_id && !s.propiedad_id)

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
            {pendientes.map(s => {
              const fechaDate = s.fecha ? new Date(s.fecha) : null
              const fechaTexto = fechaDate && !isNaN(fechaDate.getTime())
                ? fechaDate.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                : null
              const gmailLink = `https://mail.google.com/mail/u/0/#all/${s.emailId}`

              return (
              <div key={s.emailId} className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {s.monto_clp ? (
                      <span className="font-semibold text-gray-900">{formatCLPLocal(s.monto_clp)}</span>
                    ) : (
                      <input
                        type="number"
                        placeholder="Monto CLP"
                        value={montos[s.emailId] ?? ''}
                        onChange={e => setMontos(prev => ({ ...prev, [s.emailId]: e.target.value }))}
                        className="w-36 border border-gray-300 rounded px-2 py-1 text-sm font-semibold"
                      />
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONFIANZA_COLOR[s.confianza]}`}>
                      {s.confianza === 'alta' ? 'Coincidencia exacta' : 'Coincidencia parcial'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">
                    {s.arrendatario_nombre} — {s.propiedad_nombre}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    {fechaTexto && (
                      <span className="text-xs text-gray-400">{fechaTexto}</span>
                    )}
                    <a
                      href={gmailLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline"
                    >
                      Ver correo →
                    </a>
                  </div>
                </div>
                <button
                  onClick={() => handleConfirmar(s)}
                  disabled={confirming === s.emailId || (!s.monto_clp && !montos[s.emailId])}
                  className="shrink-0 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {confirming === s.emailId ? 'Registrando...' : 'Confirmar pago'}
                </button>
              </div>
            )})}
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
