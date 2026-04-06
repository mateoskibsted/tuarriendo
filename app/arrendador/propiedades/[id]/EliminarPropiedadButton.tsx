'use client'

import { useState, useTransition } from 'react'
import { eliminarPropiedad } from '@/app/actions/arrendador'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'

export default function EliminarPropiedadButton({ propiedadId }: { propiedadId: string }) {
  const [confirmando, setConfirmando] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleEliminar() {
    startTransition(async () => {
      const result = await eliminarPropiedad(propiedadId)
      if (result.success) router.push('/arrendador')
    })
  }

  if (!confirmando) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirmando(true)}>
        Eliminar propiedad
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
      <span className="text-sm text-red-700 font-medium">¿Confirmar eliminación?</span>
      <Button variant="danger" size="sm" loading={isPending} onClick={handleEliminar}>Sí, eliminar</Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirmando(false)}>Cancelar</Button>
    </div>
  )
}
