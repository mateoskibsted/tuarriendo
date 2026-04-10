'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { escanearEmails, confirmarPagoEmail, confirmarPagoEmailInformal } from '@/app/actions/email'
import type { PagoSugerido } from '@/lib/types'

function formatCLPLocal(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n)
}

const CONFIANZA_LABEL: Record<PagoSugerido['confianza'], string> = {
  alta: 'Coincidencia exacta',
  media: 'Coincidencia parcial',
  baja: 'Sin coincidencia',
}

// Enrich sugerencias with a detectedAt timestamp (client-side)
interface SugerenciaConFecha extends PagoSugerido {
  detectedAt: string
}

export default function PagosDetectadosAuto() {
  const router = useRouter()
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando')
  const [sugerencias, setSugerencias] = useState<SugerenciaConFecha[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [montos, setMontos] = useState<Record<string, string>>({})
  const [scanning, setScanning] = useState(false)
  const [nuevoPago, setNuevoPago] = useState(false)
  const [ultimoEscaneo, setUltimoEscaneo] = useState<Date | null>(null)

  // Track known email IDs to detect newly arrived payments
  const knownIds = useRef<Set<string>>(new Set())

  const runScan = useCallback(async (manual = false) => {
    if (manual) setScanning(true)

    const result = await escanearEmails()

    if (result.error) {
      setErrorMsg(result.error)
      setEstado('error')
      if (manual) setScanning(false)
      return
    }

    const ahora = new Date().toISOString()
    const incoming = result.sugerencias ?? []

    // Detect genuinely new payments (not seen in previous scans)
    const nuevas = incoming.filter(s => !knownIds.current.has(s.emailId))

    if (nuevas.length > 0 && estado === 'listo') {
      setNuevoPago(true)
    }

    // Merge: keep existing detectedAt for known entries, add new timestamp for new ones
    setSugerencias(prev => {
      const prevMap = new Map(prev.map(s => [s.emailId, s]))
      return incoming.map(s => ({
        ...s,
        detectedAt: prevMap.get(s.emailId)?.detectedAt ?? ahora,
      }))
    })

    // Update known IDs
    incoming.forEach(s => knownIds.current.add(s.emailId))

    setUltimoEscaneo(new Date())
    setEstado('listo')
    if (manual) setScanning(false)
  }, [estado])

  // Initial scan
  useEffect(() => {
    runScan()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      runScan()
    }, 30_000)
    return () => clearInterval(interval)
  }, [runScan])

  async function handleConfirmar(s: SugerenciaConFecha) {
    const monto = s.monto_clp ?? parseInt(montos[s.emailId] ?? '0')
    if (!monto) return
    setConfirming(s.emailId)
    const result = s.contrato_id
      ? await confirmarPagoEmail(s.contrato_id, monto, s.periodo, s.emailId, s.fecha)
      : await confirmarPagoEmailInformal(s.propiedad_id!, monto, s.periodo, s.emailId, s.fecha)
    setConfirming(null)
    if (result.error) {
      alert(result.error)
    } else {
      knownIds.current.delete(s.emailId)
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

  return (
    <div className="space-y-3">
      {/* Notification banner for newly detected payments */}
      {nuevoPago && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-green-800 text-sm font-medium">
            <span className="text-green-500 text-base">✓</span>
            ¡Nuevo pago detectado!
          </div>
          <button
            onClick={() => setNuevoPago(false)}
            className="text-green-600 hover:text-green-800 text-xs"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Header with scan button and last-scan time */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {ultimoEscaneo
            ? `Último escaneo: ${ultimoEscaneo.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
            : 'Actualizando cada 30 segundos'}
        </p>
        <button
          onClick={() => runScan(true)}
          disabled={scanning}
          className="flex items-center gap-1.5 text-xs bg-white border border-gray-200 hover:border-blue-400 hover:text-blue-600 text-gray-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {scanning ? (
            <>
              <span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
              Escaneando...
            </>
          ) : (
            <>
              <span>↻</span>
              Escanear ahora
            </>
          )}
        </button>
      </div>

      {sugerencias.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-500 text-sm">
          No se detectaron transferencias en los últimos 30 días.
        </div>
      ) : (
        <>
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
                  const detectedDate = new Date(s.detectedAt)
                  const detectedTexto = !isNaN(detectedDate.getTime())
                    ? detectedDate.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
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
                          {s.monto_faltante && s.monto_faltante > 0 ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-800">
                              Pago incompleto
                            </span>
                          ) : (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              s.confianza === 'alta' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {CONFIANZA_LABEL[s.confianza]}
                            </span>
                          )}
                          {s.monto_faltante && s.monto_faltante > 0 && (
                            <span className="text-xs font-semibold text-red-600">
                              Falta {formatCLPLocal(s.monto_faltante)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-0.5">
                          {s.arrendatario_nombre} — {s.propiedad_nombre}
                        </p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {fechaTexto && (
                            <span className="text-xs text-gray-400">Transferencia: {fechaTexto}</span>
                          )}
                          {detectedTexto && (
                            <span className="text-xs text-gray-400">Detectado: {detectedTexto}</span>
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
                  )
                })}
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
        </>
      )}
    </div>
  )
}
