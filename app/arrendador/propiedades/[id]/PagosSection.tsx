'use client'

import { useState, useTransition } from 'react'
import { registrarPago, registrarPagoInformal } from '@/app/actions/arrendador'
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 font-medium text-gray-500">Período</th>
                  <th className="text-right py-2 font-medium text-gray-500">UF</th>
                  <th className="text-right py-2 font-medium text-gray-500">CLP</th>
                  <th className="text-center py-2 font-medium text-gray-500">Estado</th>
                  <th className="text-right py-2 font-medium text-gray-500">Fecha pago</th>
                </tr>
              </thead>
              <tbody>
                {pagos.map((pago) => {
                  const badge = estadoBadge[pago.estado]
                  return (
                    <tr key={pago.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 font-mono text-gray-700">{pago.periodo}</td>
                      <td className="py-2.5 text-right font-medium">{formatUF(pago.valor_uf)}</td>
                      <td className="py-2.5 text-right text-gray-500">
                        {pago.valor_clp ? formatCLP(pago.valor_clp) : '—'}
                      </td>
                      <td className="py-2.5 text-center">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                      <td className="py-2.5 text-right text-gray-500">
                        {pago.fecha_pago
                          ? new Date(pago.fecha_pago).toLocaleDateString('es-CL')
                          : '—'}
                      </td>
                    </tr>
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
