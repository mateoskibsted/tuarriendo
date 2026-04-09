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
}: {
  contratoId?: string
  propiedadId?: string
  valorUf: number
  pagos: Pago[]
}) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const now = new Date()
  const currentPeriodo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

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
                  <span className="flex-1"><Badge variant={badge.variant}>{badge.label}</Badge></span>
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
