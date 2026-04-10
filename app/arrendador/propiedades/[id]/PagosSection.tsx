'use client'

import { useState, useTransition } from 'react'
import { registrarPago, registrarPagoInformal, eliminarPago } from '@/app/actions/arrendador'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { formatUF, formatCLP } from '@/lib/utils/uf'
import type { Pago, EstadoPago } from '@/lib/types'

const estadoBadge: Record<EstadoPago, { label: string; variant: 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'orange' }> = {
  pagado: { label: 'Pagado', variant: 'green' },
  pendiente: { label: 'Pendiente', variant: 'yellow' },
  atrasado: { label: 'Pagado (tarde)', variant: 'green' },
  incompleto: { label: 'Incompleto', variant: 'orange' },
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
      if (!periodosRegistrados.has(periodo)) periodosVirtuales.push(periodo)
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
      if (result?.error) setError(result.error)
      else setShowForm(false)
    })
  }

  function calcularAtraso(pago: Pago): { dias: number; multa: number } {
    const hoyLocal = new Date(); hoyLocal.setHours(0, 0, 0, 0)

    if (diaVencimiento) {
      const [py, pm] = pago.periodo.split('-').map(Number)
      const venc = new Date(py, pm - 1, diaVencimiento)
      venc.setHours(0, 0, 0, 0)

      const ref = pago.fecha_pago
        ? (() => { const d = new Date(pago.fecha_pago!); d.setHours(0, 0, 0, 0); return d })()
        : hoyLocal

      if (ref > venc) {
        const dias = Math.floor((ref.getTime() - venc.getTime()) / 86400000)
        const multa = multaMonto ? dias * multaMonto : 0
        return { dias, multa }
      }
    }
    return { dias: 0, multa: 0 }
  }

  function montoBase(pago: Pago): string {
    if (esCLP) return formatCLP(pago.valor_clp ?? valorUf)
    return formatUF(pago.valor_uf)
  }

  function montoBaseVirtual(): string {
    return esCLP ? formatCLP(valorUf) : formatUF(valorUf)
  }

  return (
    <Card
      title="Historial de pagos"
      subtitle={fechaFin
        ? `Contrato hasta ${new Date(fechaFin).toLocaleDateString('es-CL', { year: 'numeric', month: 'long' })}`
        : 'Registro completo del contrato'}
    >
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancelar' : '+ Registrar pago'}
          </Button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-gray-50 rounded-lg p-4 space-y-3 border">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Período (YYYY-MM)" name="periodo" defaultValue={currentPeriodo} placeholder="2024-01" required />
              <Input label="Valor UF" name="valor_uf" type="number" step="0.01" defaultValue={valorUf} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Valor CLP (opcional)" name="valor_clp" type="number" placeholder="37000000" />
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Estado</label>
                <select name="estado" className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="pagado">Pagado</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="atrasado">Atrasado</option>
                </select>
              </div>
            </div>
            <Input label="Notas (opcional)" name="notas" placeholder="Pago realizado por transferencia..." />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" size="sm" loading={isPending}>Guardar pago</Button>
          </form>
        )}

        {todasLasFilas.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">Sin pagos registrados</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Período</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">{montoHeader}</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Deuda período</th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Estado</th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Fecha pago</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {todasLasFilas.map((fila) => {
                  if (fila.tipo === 'virtual') {
                    const esPasado = fila.periodo < currentPeriodo
                    return (
                      <tr key={`virtual-${fila.periodo}`} className="border-b border-gray-50 opacity-50">
                        <td className="py-2 px-2 font-mono text-gray-500">{fila.periodo}</td>
                        <td className="py-2 px-2 text-right text-gray-400">{montoBaseVirtual()}</td>
                        <td className="py-2 px-2 text-right text-gray-300">—</td>
                        <td className="py-2 px-2 text-center">
                          <Badge variant={esPasado ? 'red' : 'yellow'}>{esPasado ? 'Sin registrar' : 'Pendiente'}</Badge>
                        </td>
                        <td className="py-2 px-2 text-center text-gray-300">—</td>
                        <td className="py-2 px-2" />
                      </tr>
                    )
                  }

                  const pago = fila.pago
                  const badge = estadoBadge[pago.estado]
                  const isEditing = editingId === pago.id
                  const { dias: filaDiasAtraso, multa: filaMulta } = calcularAtraso(pago)
                  const tieneAtraso = filaDiasAtraso > 0 || pago.estado === 'atrasado'

                  // Deuda total: base + multa (solo si hay atraso real con multa configurada)
                  let deudaTotal = '—'
                  if (tieneAtraso && filaMulta > 0) {
                    const baseClp = pago.valor_clp ?? (esCLP ? valorUf : null)
                    if (baseClp !== null) deudaTotal = formatCLP(baseClp + filaMulta)
                  }

                  if (isEditing) {
                    return (
                      <tr key={pago.id}>
                        <td colSpan={6} className="py-2 px-2">
                          <form
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
                            className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2"
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
                        </td>
                      </tr>
                    )
                  }

                  return (
                    <>
                      <tr
                        key={pago.id}
                        className={`border-b border-gray-50 group ${tieneAtraso ? 'bg-orange-50' : 'hover:bg-gray-50'}`}
                      >
                        <td className="py-2 px-2 font-mono text-gray-700">{pago.periodo}</td>
                        <td className="py-2 px-2 text-right font-medium text-gray-800">{montoBase(pago)}</td>
                        <td className={`py-2 px-2 text-right font-medium ${tieneAtraso && filaMulta > 0 ? 'text-orange-600' : 'text-gray-300'}`}>
                          {deudaTotal}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                            {pago.email_origen && (
                              <a href={pago.email_origen} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline whitespace-nowrap">
                                Ver correo →
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-center text-xs text-gray-400 whitespace-nowrap">
                          {formatFechaPago(pago.fecha_pago)}
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex gap-3 justify-end">
                            <button onClick={() => setEditingId(pago.id)} className="text-xs text-blue-500 hover:underline">Editar</button>
                            <button
                              onClick={() => {
                                if (!confirm('¿Eliminar este pago?')) return
                                startTransition(async () => { await eliminarPago(pago.id) })
                              }}
                              className="text-xs text-red-400 hover:underline"
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                      {tieneAtraso && (
                        <tr className={tieneAtraso ? 'bg-orange-50' : ''}>
                          <td colSpan={6} className="px-2 pb-1.5 text-xs text-orange-600">
                            {filaDiasAtraso} día{filaDiasAtraso !== 1 ? 's' : ''} de atraso
                            {filaMulta > 0 && ` — multa: ${multaMoneda === 'CLP' ? `$${filaMulta.toLocaleString('es-CL')} CLP` : `${filaMulta} ${multaMoneda ?? ''}`}`}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}
