'use client'

import { useState, useTransition } from 'react'
import { registrarPago, registrarPagoInformal, eliminarPago } from '@/app/actions/arrendador'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { formatUF, formatCLP } from '@/lib/utils/uf'
import type { Pago, EstadoPago } from '@/lib/types'

const estadoBadge: Record<EstadoPago, { label: string; variant: 'green' | 'red' | 'yellow' }> = {
  pagado: { label: 'Pagado', variant: 'green' },
  pendiente: { label: 'Pendiente', variant: 'yellow' },
  atrasado: { label: 'Atrasado', variant: 'red' },
}

function formatFechaPago(fechaStr: string | null | undefined): string {
  if (!fechaStr) return '—'
  const d = new Date(fechaStr)
  const fecha = d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const hora = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${fecha} ${hora}`
}

export default function PagosSection({
  contratoId,
  propiedadId,
  valorUf,
  pagos,
  diaVencimiento,
  multaMonto,
  multaMoneda,
  fechaInicio,
  fechaFin,
  moneda,
}: {
  contratoId?: string
  propiedadId?: string
  valorUf: number
  pagos: Pago[]
  diaVencimiento?: number
  multaMonto?: number | null
  multaMoneda?: string | null
  fechaInicio?: string | null
  fechaFin?: string | null
  moneda?: string | null
}) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const esCLP = moneda === 'CLP'
  const montoHeader = esCLP ? 'Monto CLP' : 'Monto UF'

  const now = new Date()
  const currentPeriodo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const pagoMesActual = pagos.find(p => p.periodo === currentPeriodo)

  const fechaVencimiento = diaVencimiento
    ? new Date(now.getFullYear(), now.getMonth(), diaVencimiento)
    : null
  const hoy = new Date(now)
  hoy.setHours(0, 0, 0, 0)

  let pagoFueTarde = false
  let diasAtrasoRegistrado = 0
  let multaRegistrada = 0
  if (pagoMesActual && fechaVencimiento) {
    const fechaPago = pagoMesActual.fecha_pago ? new Date(pagoMesActual.fecha_pago) : null
    if (fechaPago) fechaPago.setHours(0, 0, 0, 0)
    const fueAtrasadoPorFecha = fechaPago && fechaPago > fechaVencimiento
    const fueAtrasadoPorEstado = pagoMesActual.estado === 'atrasado'
    if (fueAtrasadoPorFecha || fueAtrasadoPorEstado) {
      pagoFueTarde = true
      const referencia = fechaPago ?? hoy
      diasAtrasoRegistrado = Math.max(
        0,
        Math.floor((referencia.getTime() - fechaVencimiento.getTime()) / (24 * 60 * 60 * 1000))
      )
      multaRegistrada = multaMonto ? diasAtrasoRegistrado * multaMonto : 0
    }
  }

  let estaAtrasado = false
  let diasAtraso = 0
  let multaAcumulada = 0
  if (!pagoMesActual && fechaVencimiento && hoy > fechaVencimiento) {
    estaAtrasado = true
    diasAtraso = Math.floor((hoy.getTime() - fechaVencimiento.getTime()) / (24 * 60 * 60 * 1000))
    multaAcumulada = multaMonto ? diasAtraso * multaMonto : 0
  }

  const periodosRegistrados = new Set(pagos.map(p => p.periodo))
  const periodosVirtuales: string[] = []
  if (fechaInicio) {
    const [iy, im] = fechaInicio.split('-').map(Number)
    const fin = fechaFin
      ? (() => { const [fy, fm] = fechaFin.split('-').map(Number); return new Date(fy, fm - 1, 1) })()
      : new Date(now.getFullYear(), now.getMonth() + 12, 1)

    const cur = new Date(iy, im - 1, 1)
    const limFin = new Date(fin.getFullYear(), fin.getMonth(), 1)

    while (cur <= limFin) {
      const periodo = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`
      if (!periodosRegistrados.has(periodo)) {
        periodosVirtuales.push(periodo)
      }
      cur.setMonth(cur.getMonth() + 1)
    }
  }

  type FilaPago = { tipo: 'real'; pago: Pago } | { tipo: 'virtual'; periodo: string }
  const todasLasFilas: FilaPago[] = [
    ...pagos.map(p => ({ tipo: 'real' as const, pago: p })),
    ...periodosVirtuales.map(p => ({ tipo: 'virtual' as const, periodo: p })),
  ].sort((a, b) => {
    const pa = a.tipo === 'real' ? a.pago.periodo : a.periodo
    const pb = b.tipo === 'real' ? b.pago.periodo : b.periodo
    return pa.localeCompare(pb)
  })

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      const result = contratoId
        ? await registrarPago(contratoId, formData)
        : await registrarPagoInformal(propiedadId!, formData)
      if (result?.error) {
        setError(result.error)
      } else {
        setShowForm(false)
      }
    })
  }

  // Supress unused variable warnings
  void pagoFueTarde; void diasAtrasoRegistrado; void multaRegistrada
  void estaAtrasado; void diasAtraso; void multaAcumulada

  return (
    <Card title="Historial de pagos" subtitle={fechaFin ? `Contrato hasta ${new Date(fechaFin).toLocaleDateString('es-CL', { year: 'numeric', month: 'long' })}` : 'Registro completo del contrato'}>
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancelar' : '+ Registrar pago'}
          </Button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-gray-50 rounded-lg p-4 space-y-3 border">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Período (YYYY-MM)"
                name="periodo"
                defaultValue={currentPeriodo}
                placeholder="2024-01"
                required
              />
              <Input
                label="Valor UF"
                name="valor_uf"
                type="number"
                step="0.01"
                defaultValue={valorUf}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Valor CLP (opcional)"
                name="valor_clp"
                type="number"
                placeholder="37000000"
              />
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Estado</label>
                <select
                  name="estado"
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="pagado">Pagado</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="atrasado">Atrasado</option>
                </select>
              </div>
            </div>
            <Input
              label="Notas (opcional)"
              name="notas"
              placeholder="Pago realizado por transferencia..."
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" size="sm" loading={isPending}>
              Guardar pago
            </Button>
          </form>
        )}

        {todasLasFilas.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">Sin pagos registrados</p>
        ) : (
          <div className="overflow-x-auto">
            {/* Encabezado */}
            <div className="min-w-[600px]">
              <div className="grid grid-cols-[80px_1fr_1fr_1fr_160px_80px] gap-2 px-1 pb-2 border-b border-gray-200 mb-1">
                <span className="text-xs font-semibold text-gray-400 uppercase">Período</span>
                <span className="text-xs font-semibold text-gray-400 uppercase text-right">{montoHeader}</span>
                <span className="text-xs font-semibold text-gray-400 uppercase text-right">Deuda período</span>
                <span className="text-xs font-semibold text-gray-400 uppercase">Estado</span>
                <span className="text-xs font-semibold text-gray-400 uppercase">Fecha pago</span>
                <span className="text-xs font-semibold text-gray-400 uppercase text-right">Acciones</span>
              </div>

              <div className="space-y-0">
              {todasLasFilas.map((fila) => {
                if (fila.tipo === 'virtual') {
                  const esPasado = fila.periodo < currentPeriodo
                  const montoDisplay = esCLP ? formatCLP(valorUf) : formatUF(valorUf)
                  return (
                    <div key={`virtual-${fila.periodo}`} className="min-w-[600px]">
                      <div className="grid grid-cols-[80px_1fr_1fr_1fr_160px_80px] gap-2 py-2 border-b border-gray-50 px-1 opacity-50">
                        <span className="font-mono text-sm text-gray-500">{fila.periodo}</span>
                        <span className="text-sm text-gray-400 text-right">{montoDisplay}</span>
                        <span className="text-sm text-gray-300 text-right">—</span>
                        <span>
                          <Badge variant={esPasado ? 'red' : 'yellow'}>{esPasado ? 'Sin registrar' : 'Pendiente'}</Badge>
                        </span>
                        <span className="text-sm text-gray-300">—</span>
                        <span />
                      </div>
                    </div>
                  )
                }

                const pago = fila.pago
                const badge = estadoBadge[pago.estado]
                const isEditing = editingId === pago.id

                // Calcular atraso para esta fila
                let filaDiasAtraso = 0
                let filaMulta = 0
                if (diaVencimiento && pago.fecha_pago) {
                  const [py, pm] = pago.periodo.split('-').map(Number)
                  const venc = new Date(py, pm - 1, diaVencimiento)
                  venc.setHours(0, 0, 0, 0)
                  const fp = new Date(pago.fecha_pago)
                  fp.setHours(0, 0, 0, 0)
                  if (fp > venc) {
                    filaDiasAtraso = Math.floor((fp.getTime() - venc.getTime()) / 86400000)
                    filaMulta = multaMonto ? filaDiasAtraso * multaMonto : 0
                  }
                }
                const esFilaAtrasadaSinPago = !pago.fecha_pago && pago.estado === 'atrasado' && diaVencimiento && (() => {
                  const [py, pm] = pago.periodo.split('-').map(Number)
                  const venc = new Date(py, pm - 1, diaVencimiento)
                  venc.setHours(0, 0, 0, 0)
                  const hoyLocal = new Date(); hoyLocal.setHours(0, 0, 0, 0)
                  if (hoyLocal > venc) {
                    filaDiasAtraso = Math.floor((hoyLocal.getTime() - venc.getTime()) / 86400000)
                    filaMulta = multaMonto ? filaDiasAtraso * multaMonto : 0
                    return true
                  }
                  return false
                })()

                const tieneAtraso = filaDiasAtraso > 0 || esFilaAtrasadaSinPago

                // Monto base del período
                const montoBase = esCLP
                  ? formatCLP(pago.valor_clp ?? valorUf)
                  : formatUF(pago.valor_uf)

                // Deuda total = arriendo + multa (en CLP siempre)
                let deudaTotal: string = '—'
                if (tieneAtraso && filaMulta > 0) {
                  const baseClp = pago.valor_clp ?? (esCLP ? valorUf : null)
                  if (baseClp !== null) {
                    deudaTotal = formatCLP(baseClp + filaMulta)
                  }
                }

                if (isEditing) {
                  return (
                    <form
                      key={pago.id}
                      onSubmit={(e) => {
                        e.preventDefault()
                        const fd = new FormData(e.currentTarget)
                        startTransition(async () => {
                          const result = contratoId
                            ? await registrarPago(contratoId, fd)
                            : await registrarPagoInformal(propiedadId!, fd)
                          if (result?.error) setError(result.error)
                          else setEditingId(null)
                        })
                      }}
                      className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2 my-1"
                    >
                      <input type="hidden" name="periodo" value={pago.periodo} />
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="UF" name="valor_uf" type="number" step="0.01" defaultValue={pago.valor_uf} required />
                        <Input label="CLP" name="valor_clp" type="number" defaultValue={pago.valor_clp ?? ''} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Estado</label>
                          <select name="estado" defaultValue={pago.estado} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                            <option value="pagado">Pagado</option>
                            <option value="pendiente">Pendiente</option>
                            <option value="atrasado">Atrasado</option>
                          </select>
                        </div>
                        <Input label="Notas" name="notas" defaultValue={pago.notas ?? ''} />
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" loading={isPending}>Guardar</Button>
                        <button type="button" onClick={() => setEditingId(null)} className="text-sm text-gray-500 hover:text-gray-700 px-2">Cancelar</button>
                      </div>
                    </form>
                  )
                }

                return (
                  <div key={pago.id} className={`border-b border-gray-50 px-1 ${tieneAtraso ? 'bg-orange-50' : ''}`}>
                    <div className="grid grid-cols-[80px_1fr_1fr_1fr_160px_80px] gap-2 py-2 items-center">
                      <span className="font-mono text-sm text-gray-700">{pago.periodo}</span>
                      <span className="text-sm font-medium text-right">{montoBase}</span>
                      <span className={`text-sm text-right font-medium ${tieneAtraso && filaMulta > 0 ? 'text-orange-600' : 'text-gray-300'}`}>
                        {deudaTotal}
                      </span>
                      <span className="flex items-center gap-2 min-w-0">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {pago.email_origen && (
                          <a href={pago.email_origen} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline whitespace-nowrap">
                            Ver correo →
                          </a>
                        )}
                      </span>
                      <span className="text-xs text-gray-400 leading-tight">
                        {formatFechaPago(pago.fecha_pago)}
                      </span>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setEditingId(pago.id)} className="text-xs text-blue-500 hover:underline whitespace-nowrap">Editar</button>
                        <button
                          onClick={() => {
                            if (!confirm('¿Eliminar este pago?')) return
                            startTransition(async () => { await eliminarPago(pago.id) })
                          }}
                          className="text-xs text-red-400 hover:underline whitespace-nowrap"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                    {tieneAtraso && (
                      <p className="text-xs text-orange-600 pb-1.5 pl-1">
                        {filaDiasAtraso} día{filaDiasAtraso !== 1 ? 's' : ''} de atraso
                        {filaMulta > 0 && ` — multa: ${multaMoneda === 'CLP' ? `$${filaMulta.toLocaleString('es-CL')} CLP` : `${filaMulta} ${multaMoneda ?? ''}`}`}
                      </p>
                    )}
                  </div>
                )
              })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
