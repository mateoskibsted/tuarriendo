'use client'

import { useState } from 'react'
import { escanearEmails, confirmarPagoEmail, desconectarEmail } from '@/app/actions/email'
import Button from '@/components/ui/Button'
import type { PagoSugerido } from '@/lib/types'

const CONFIANZA_STYLE: Record<PagoSugerido['confianza'], string> = {
  alta: 'bg-green-100 text-green-800',
  media: 'bg-yellow-100 text-yellow-800',
  baja: 'bg-gray-100 text-gray-600',
}

const CONFIANZA_LABEL: Record<PagoSugerido['confianza'], string> = {
  alta: 'Coincidencia alta',
  media: 'Coincidencia media',
  baja: 'Sin coincidencia',
}

function formatCLPLocal(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n)
}

export default function EmailPageClient({
  connected,
  emailAddress,
}: {
  connected: boolean
  emailAddress?: string
}) {
  const [scanning, setScanning] = useState(false)
  const [sugerencias, setSugerencias] = useState<PagoSugerido[] | null>(null)
  const [scanError, setScanError] = useState('')
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  async function handleScan() {
    setScanning(true)
    setScanError('')
    setSugerencias(null)
    const result = await escanearEmails()
    setScanning(false)
    if (result.error) {
      setScanError(result.error)
    } else {
      setSugerencias(result.sugerencias ?? [])
    }
  }

  async function handleConfirmar(s: PagoSugerido) {
    if (!s.contrato_id || !s.monto_clp) return
    setConfirming(s.emailId)
    const result = await confirmarPagoEmail(s.contrato_id, s.monto_clp, s.periodo)
    setConfirming(null)
    if (result.error) {
      alert(result.error)
    } else {
      setConfirmed(prev => new Set([...prev, s.emailId]))
    }
  }

  async function handleDesconectar() {
    if (!confirm('¿Desconectar tu cuenta de Gmail?')) return
    setDisconnecting(true)
    await desconectarEmail()
    setDisconnecting(false)
  }

  if (!connected) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center space-y-4">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-2 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Conecta tu Gmail</h2>
          <p className="text-gray-500 text-sm mt-1">
            tuarriendo leerá solo los correos de transferencias bancarias para detectar pagos.
            Nunca enviará correos ni modificará tu bandeja de entrada.
          </p>
        </div>
        <a href="/api/auth/gmail/init">
          <Button className="bg-red-600 hover:bg-red-700 text-white">
            Conectar con Gmail
          </Button>
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Connected account */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-2 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
            </svg>
          </div>
          <div>
            <p className="font-medium text-gray-900">{emailAddress}</p>
            <p className="text-xs text-green-600">Gmail conectado</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? 'Escaneando...' : 'Escanear correos'}
          </Button>
          <Button
            variant="secondary"
            onClick={handleDesconectar}
            disabled={disconnecting}
          >
            Desconectar
          </Button>
        </div>
      </div>

      {scanError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {scanError}
        </div>
      )}

      {/* Scan results */}
      {sugerencias !== null && (
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            {sugerencias.length === 0
              ? 'No se encontraron transferencias en los últimos 30 días'
              : `${sugerencias.length} transferencia(s) detectada(s)`}
          </h2>

          <div className="space-y-3">
            {sugerencias.map(s => {
              const isConfirmed = confirmed.has(s.emailId)
              const isConfirming = confirming === s.emailId
              const canConfirm = !!s.contrato_id && !!s.monto_clp && !isConfirmed

              return (
                <div
                  key={s.emailId}
                  className={`bg-white rounded-xl border p-4 space-y-3 ${isConfirmed ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{s.asunto}</p>
                      <p className="text-xs text-gray-500">{s.fecha}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${CONFIANZA_STYLE[s.confianza]}`}>
                      {CONFIANZA_LABEL[s.confianza]}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {s.monto_clp && (
                      <div>
                        <span className="text-gray-500 text-xs">Monto</span>
                        <p className="font-semibold text-gray-900">{formatCLPLocal(s.monto_clp)}</p>
                      </div>
                    )}
                    {s.banco && (
                      <div>
                        <span className="text-gray-500 text-xs">Banco</span>
                        <p className="text-gray-900">{s.banco}</p>
                      </div>
                    )}
                    {s.nombre_detectado && (
                      <div>
                        <span className="text-gray-500 text-xs">Nombre detectado</span>
                        <p className="text-gray-900">{s.nombre_detectado}</p>
                      </div>
                    )}
                    {s.rut_detectado && (
                      <div>
                        <span className="text-gray-500 text-xs">RUT detectado</span>
                        <p className="text-gray-900">{s.rut_detectado}</p>
                      </div>
                    )}
                  </div>

                  {s.arrendatario_nombre && (
                    <div className="bg-blue-50 rounded-lg px-3 py-2 text-sm">
                      <span className="text-blue-600 font-medium">Arrendatario identificado: </span>
                      <span className="text-blue-900">{s.arrendatario_nombre}</span>
                      {s.propiedad_nombre && (
                        <span className="text-blue-700"> — {s.propiedad_nombre}</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Período: {s.periodo}</span>
                    {isConfirmed ? (
                      <span className="text-sm text-green-600 font-medium">Pago registrado</span>
                    ) : canConfirm ? (
                      <Button
                        size="sm"
                        onClick={() => handleConfirmar(s)}
                        disabled={isConfirming}
                      >
                        {isConfirming ? 'Registrando...' : 'Confirmar pago'}
                      </Button>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {s.monto_clp ? 'Sin arrendatario identificado' : 'Sin monto detectado'}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
