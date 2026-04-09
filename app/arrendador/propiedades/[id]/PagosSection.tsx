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

export default function PagosSection({
  contratoId,
  propiedadId,
  valorUf,
  pagos,
  diaVencimiento,
  multaMonto,
  multaMoneda,
}: {
  contratoId?: string
  propiedadId?: string
  valorUf: number
  pagos: Pago[]
  diaVencimiento?: number
  multaMonto?: number | null
  multaMoneda?: string | null
}) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const now = new Date()
  const currentPeriodo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // Calcular estado del mes actual
  const pagoMesActual = pagos.find(p => p.periodo === currentPeriodo)

  // Fecha de vencimiento para el mes actual
  const fechaVencimiento = diaVencimiento
    ? new Date(now.getFullYear(), now.getMonth(), diaVencimiento)
    : null
  const hoy = new Date(now)
  hoy.setHours(0, 0, 0, 0)

  // Caso 1: ya hay pago este mes — detectar si fue tarde (por fecha_pago o estado)
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

  // Caso 2: sin pago y ya vencido
  let estaAtrasado = false
  let diasAtraso = 0
  let multaAcumulada = 0
  if (!pagoMesActual && fechaVencimiento && hoy > fechaVencimiento) {
    estaAtrasado = true
    diasAtraso = Math.floor((hoy.getTime() - fechaVencimiento.getTime()) / (24 * 60 * 60 * 1000))
    multaAcumulada = multaMonto ? diasAtraso * multaMonto : 0
  }

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

  return (
    <Card title="Historial de pagos" subtitle="Últimos 12 meses">
      <div className="space-y-4">
        {/* Pago recibido pero tarde */}
        {pagoFueTarde && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-orange-700">
              Pago de {currentPeriodo} recibido con {diasAtrasoRegistrado} día{diasAtrasoRegistrado !== 1 ? 's' : ''} de atraso
            </p>
            {multaRegistrada > 0 && (
              <p className="text-sm text-orange-600 mt-1">
                Multa correspondiente:{' '}
                <span className="font-bold">
                  {multaMoneda === 'CLP'
                    ? `$${multaRegistrada.toLocaleString('es-CL')} CLP`
                    : `${multaRegistrada} ${multaMoneda ?? ''}`}
                </span>
                {multaMonto && (
                  <span className="text-orange-400 font-normal">
                    {' '}({multaMoneda === 'CLP' ? `$${multaMonto.toLocaleString('es-CL')}` : multaMonto}/día × {diasAtrasoRegistrado} días)
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        {/* Sin pago y ya vencido */}
        {estaAtrasado && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-red-700">
              ⚠ Pago de {currentPeriodo} no recibido — {diasAtraso} día{diasAtraso !== 1 ? 's' : ''} de atraso
            </p>
            {multaAcumulada > 0 && (
              <p className="text-sm text-red-600 mt-1">
                Multa acumulada:{' '}
                <span className="font-bold">
                  {multaMoneda === 'CLP'
                    ? `$${multaAcumulada.toLocaleString('es-CL')} CLP`
                    : `${multaAcumulada} ${multaMoneda ?? ''}`}
                </span>
                {multaMonto && (
                  <span className="text-red-400 font-normal">
                    {' '}({multaMoneda === 'CLP' ? `$${multaMonto.toLocaleString('es-CL')}` : multaMonto}/día × {diasAtraso} días)
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        {/* Pendiente antes del vencimiento */}
        {!pagoMesActual && !estaAtrasado && diaVencimiento && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
            <p className="text-sm text-yellow-700">
              Pago de {currentPeriodo} pendiente — vence el día {diaVencimiento} de este mes
            </p>
          </div>
        )}

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

        {pagos.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">Sin pagos registrados</p>
        ) : (
          <div className="space-y-1">
            {pagos.map((pago) => {
              const badge = estadoBadge[pago.estado]
              const isEditing = editingId === pago.id

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
                )
              }

              return (
                <div key={pago.id} className="flex items-center gap-2 py-2 border-b border-gray-50 hover:bg-gray-50 rounded px-1 group">
                  <span className="font-mono text-sm text-gray-700 w-20 shrink-0">{pago.periodo}</span>
                  <span className="text-sm font-medium w-16 text-right shrink-0">{formatUF(pago.valor_uf)}</span>
                  <span className="text-sm text-gray-500 w-28 text-right shrink-0">{pago.valor_clp ? formatCLP(pago.valor_clp) : '—'}</span>
                  <span className="flex-1 flex items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {pago.email_origen && (
                      <a href={pago.email_origen} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline">
                        Ver correo →
                      </a>
                    )}
                  </span>
                  <span className="text-sm text-gray-400 shrink-0">{pago.fecha_pago ? new Date(pago.fecha_pago).toLocaleDateString('es-CL') : '—'}</span>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
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
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}
