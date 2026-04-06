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
  const [waSent, setWaSent] = useState(false)

  function handleGenerar() {
    startTransition(async () => {
      const result = await generarCodigoInvitacion(propiedadId)
      if (result.success && result.codigo) {
        setNuevoCodigo(result.codigo)
        setWaSent(false)
      }
    })
  }

  function handleWhatsApp() {
    const base = window.location.origin
    const link = `${base}/registro?codigo=${nuevoCodigo}`
    const mensaje = encodeURIComponent(
      `Hola, te invito a registrarte en tuarriendo para ver los detalles de tu arriendo.\n\nHaz clic en este link y crea tu cuenta:\n${link}\n\nTu código de acceso es: *${nuevoCodigo}*\n(válido por 7 días)`
    )
    window.open(`https://wa.me/?text=${mensaje}`, '_blank')
    setWaSent(true)
  }

  return (
    <div className="space-y-4">
      {nuevoCodigo ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-green-700 mb-1">Link listo para enviar</p>
            <p className="text-xs text-green-600 break-all font-mono bg-white border border-green-100 rounded px-2 py-1.5">
              {window?.location?.origin}/registro?codigo={nuevoCodigo}
            </p>
          </div>
          <button
            onClick={handleWhatsApp}
            className="flex items-center gap-2 bg-[#25D366] hover:bg-[#20b558] text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors w-full justify-center"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            {waSent ? 'Abrir WhatsApp de nuevo' : 'Enviar por WhatsApp'}
          </button>
          {waSent && (
            <p className="text-xs text-green-600 text-center">
              WhatsApp abierto. El arrendatario recibirá el link con el código ya incluido.
            </p>
          )}
          <button
            onClick={() => setNuevoCodigo('')}
            className="text-xs text-gray-400 hover:text-gray-600 w-full text-center"
          >
            Generar otro código
          </button>
        </div>
      ) : (
        <Button onClick={handleGenerar} loading={isPending} variant="secondary" size="sm">
          Generar link de invitación
        </Button>
      )}

      {codigos.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Invitaciones anteriores</p>
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
