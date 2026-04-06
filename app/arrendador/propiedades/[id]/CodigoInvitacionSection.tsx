'use client'

import { useState, useTransition } from 'react'
import { generarCodigoInvitacion } from '@/app/actions/arrendador'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import type { CodigoInvitacion } from '@/lib/types'

export default function CodigoInvitacionSection({
  propiedadId,
  codigos,
}: {
  propiedadId: string
  codigos: CodigoInvitacion[]
}) {
  const [isPending, startTransition] = useTransition()
  const [nuevoCodigo, setNuevoCodigo] = useState('')
  const [copied, setCopied] = useState(false)

  function handleGenerar() {
    startTransition(async () => {
      const result = await generarCodigoInvitacion(propiedadId)
      if (result.success && result.codigo) setNuevoCodigo(result.codigo)
    })
  }

  function handleCopy() {
    navigator.clipboard.writeText(nuevoCodigo)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      {nuevoCodigo && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-xs text-blue-600 font-medium mb-1">Código generado — compártelo con tu arrendatario</p>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-mono font-bold text-blue-800 tracking-widest">{nuevoCodigo}</span>
            <button
              onClick={handleCopy}
              className="text-xs text-blue-600 hover:text-blue-800 border border-blue-300 rounded px-2 py-1"
            >
              {copied ? '¡Copiado!' : 'Copiar'}
            </button>
          </div>
          <p className="text-xs text-blue-500 mt-2">Válido por 7 días · Un solo uso</p>
        </div>
      )}

      <Button onClick={handleGenerar} loading={isPending} variant="secondary" size="sm">
        Generar código de invitación
      </Button>

      {codigos.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Códigos anteriores</p>
          <div className="space-y-1">
            {codigos.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-gray-700">{c.codigo}</span>
                <Badge variant={c.usado ? 'gray' : new Date(c.expires_at) < new Date() ? 'red' : 'green'}>
                  {c.usado ? 'Usado' : new Date(c.expires_at) < new Date() ? 'Expirado' : 'Activo'}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
