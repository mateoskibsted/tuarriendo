'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  obtenerPagosDetectadosCron,
  confirmarPagoDetectadoCron,
  descartarPagoDetectadoCron,
} from '@/app/actions/email'

type PagoCron = {
  id: string
  email_id: string
  contrato_id: string | null
  propiedad_id: string | null
  arrendatario_nombre: string
  propiedad_nombre: string | null
  monto_clp: number
  periodo: string
  fecha_transferencia: string | null
  uf_valor_dia: number | null
  gmail_link: string | null
  created_at: string
}

function formatCLP(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n)
}

function formatFecha(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function PagosDetectadosCron() {
  const router = useRouter()
  const [pagos, setPagos] = useState<PagoCron[]>([])
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState<string | null>(null)

  useEffect(() => {
    obtenerPagosDetectadosCron().then(res => {
      setPagos(res.pagos ?? [])
      setCargando(false)
    })
  }, [])

  async function handleConfirmar(p: PagoCron) {
    setProcesando(p.id)
    const result = await confirmarPagoDetectadoCron(
      p.id,
      p.contrato_id,
      p.propiedad_id,
      p.monto_clp,
      p.periodo,
      p.email_id,
      p.fecha_transferencia,
    )
    setProcesando(null)
    if (result.error) {
      alert(result.error)
    } else {
      setPagos(prev => prev.filter(x => x.id !== p.id))
      router.refresh()
    }
  }

  async function handleDescartar(p: PagoCron) {
    setProcesando(`d-${p.id}`)
    await descartarPagoDetectadoCron(p.id)
    setProcesando(null)
    setPagos(prev => prev.filter(x => x.id !== p.id))
  }

  if (cargando || pagos.length === 0) return null

  return (
    <section>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
        <h2 className="text-lg font-bold text-gray-900">Pagos detectados mientras no estabas</h2>
        <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-0.5 rounded-full">
          {pagos.length}
        </span>
      </div>

      <div className="bg-white border border-blue-200 rounded-xl overflow-hidden mb-2">
        <div className="px-5 py-3 bg-blue-50 border-b border-blue-100">
          <p className="text-sm text-blue-800">
            El escáner automático encontró estos pagos mientras no tenías el panel abierto. Revísalos y confirma los que correspondan.
          </p>
        </div>

        <div className="divide-y divide-gray-100">
          {pagos.map(p => {
            const fechaTransf = formatFecha(p.fecha_transferencia)
            const fechaDetectado = formatFecha(p.created_at)
            const confirmando = procesando === p.id
            const descartando = procesando === `d-${p.id}`

            return (
              <div key={p.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xl font-bold text-gray-900">{formatCLP(p.monto_clp)}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 font-semibold">
                      Coincidencia exacta
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mt-1">
                    <span className="font-semibold">{p.arrendatario_nombre}</span>
                    {p.propiedad_nombre && <span className="text-gray-400"> — {p.propiedad_nombre}</span>}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
                    {fechaTransf && (
                      <span className="text-xs text-gray-400">Transferencia: {fechaTransf}</span>
                    )}
                    {fechaDetectado && (
                      <span className="text-xs text-gray-400">Detectado: {fechaDetectado}</span>
                    )}
                    {p.gmail_link && (
                      <a
                        href={p.gmail_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline"
                      >
                        Ver correo →
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleDescartar(p)}
                    disabled={!!procesando}
                    className="px-4 py-2 text-sm font-semibold text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    {descartando ? 'Descartando...' : 'Descartar'}
                  </button>
                  <button
                    onClick={() => handleConfirmar(p)}
                    disabled={!!procesando}
                    className="px-5 py-2 text-sm font-bold bg-blue-800 hover:bg-blue-900 text-white rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {confirmando ? 'Registrando...' : 'Confirmar pago'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
