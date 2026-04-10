'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { v4 as uuidv4 } from 'uuid'
import { cleanRut } from '@/lib/utils/rut'
import { enviarWhatsApp } from '@/lib/utils/twilio'
import { todayInChile } from '@/lib/utils/date'

function normalizePhone(raw: string): string | null {
  if (!raw?.trim()) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('56') && digits.length === 11) return `+${digits}`
  if (digits.startsWith('9') && digits.length === 9) return `+56${digits}`
  if (digits.length === 8) return `+569${digits}`
  return raw.trim()
}

/** Devuelve el user autenticado y el cliente admin. */
async function getAuthContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { user, admin: createAdminClient() }
}

const MAX_PROPIEDADES = 10

export async function crearPropiedad(formData: FormData) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const { count } = await admin
    .from('propiedades')
    .select('id', { count: 'exact', head: true })
    .eq('arrendador_id', user.id)
    .eq('activa', true)

  if ((count ?? 0) >= MAX_PROPIEDADES) {
    return { error: `Límite máximo de ${MAX_PROPIEDADES} propiedades alcanzado` }
  }

  const arrendatarioNombre = (formData.get('arrendatario_nombre') as string)?.trim()
  const tieneArrendatario = !!arrendatarioNombre

  const multaMonto = formData.get('multa_monto') as string
  const valorUfRaw = formData.get('valor_uf') as string

  const campos: Record<string, unknown> = {
    arrendador_id: user.id,
    nombre: formData.get('nombre') as string,
    direccion: formData.get('direccion') as string,
    descripcion: (formData.get('descripcion') as string) || null,
  }

  if (tieneArrendatario) {
    const rutRaw = (formData.get('arrendatario_rut') as string)?.trim()
    const celularRaw = (formData.get('arrendatario_celular') as string)?.trim()
    const fechaInicio = (formData.get('fecha_inicio') as string)?.trim()
    const fechaFin = (formData.get('fecha_fin') as string)?.trim()

    campos.arrendatario_informal_nombre = arrendatarioNombre
    campos.arrendatario_informal_rut = rutRaw ? cleanRut(rutRaw) : null
    campos.arrendatario_informal_email = (formData.get('arrendatario_email') as string)?.trim() || null
    campos.arrendatario_informal_celular = normalizePhone(celularRaw ?? '')
    campos.arrendatario_informal_cobro_tipo = (formData.get('cobro_tipo') as string) || 'adelantado'
    campos.arrendatario_informal_fecha_inicio = fechaInicio || null
    campos.arrendatario_informal_fecha_fin = fechaFin || null

    if (valorUfRaw) {
      campos.valor_uf = parseFloat(valorUfRaw)
      campos.moneda = formData.get('moneda') as string
      campos.dia_vencimiento = parseInt(formData.get('dia_vencimiento') as string) || 5
      campos.multa_monto = multaMonto ? parseFloat(multaMonto) : null
      campos.multa_moneda = (formData.get('multa_moneda') as string) || null
    }
  }

  const { error } = await admin.from('propiedades').insert(campos)

  if (error) return { error: error.message }

  revalidatePath('/arrendador')
  return { success: true }
}

export async function actualizarPropiedad(id: string, formData: FormData) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const valorUfRaw = formData.get('valor_uf') as string
  const multaMonto = formData.get('multa_monto') as string

  const campos: Record<string, unknown> = {
    nombre: formData.get('nombre') as string,
    direccion: formData.get('direccion') as string,
    descripcion: formData.get('descripcion') as string,
  }

  // Only update financial fields if they're present in the form (not soloBasico mode)
  if (valorUfRaw) {
    campos.valor_uf = parseFloat(valorUfRaw)
    campos.moneda = formData.get('moneda') as string
    campos.dia_vencimiento = parseInt(formData.get('dia_vencimiento') as string) || 5
    campos.multa_monto = multaMonto ? parseFloat(multaMonto) : null
    campos.multa_moneda = formData.get('multa_moneda') as string
  }

  const { error } = await admin
    .from('propiedades')
    .update(campos)
    .eq('id', id)
    .eq('arrendador_id', user.id)

  if (error) return { error: error.message }

  revalidatePath('/arrendador')
  revalidatePath(`/arrendador/propiedades/${id}`)
  revalidatePath('/arrendador/propiedades')
  return { success: true }
}

export async function generarCodigoInvitacion(propiedadId: string) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  // Verify ownership before generating code
  const { data: propiedad } = await admin
    .from('propiedades')
    .select('id')
    .eq('id', propiedadId)
    .eq('arrendador_id', user.id)
    .single()

  if (!propiedad) return { error: 'Propiedad no encontrada' }

  const codigo = uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()

  const { data, error } = await admin
    .from('codigos_invitacion')
    .insert({ propiedad_id: propiedadId, codigo })
    .select()
    .single()

  if (error) return { error: error.message }

  revalidatePath('/arrendador')
  return { success: true, codigo: data.codigo }
}

export async function registrarPago(contratoId: string, formData: FormData) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const periodo = formData.get('periodo') as string
  const valorUf = parseFloat(formData.get('valor_uf') as string)
  const valorClp = formData.get('valor_clp') ? parseInt(formData.get('valor_clp') as string) : null
  const estado = formData.get('estado') as string
  const notas = formData.get('notas') as string

  const { data: existing } = await admin
    .from('pagos')
    .select('id')
    .eq('contrato_id', contratoId)
    .eq('periodo', periodo)
    .single()

  if (existing) {
    const { error } = await admin
      .from('pagos')
      .update({
        valor_uf: valorUf,
        valor_clp: valorClp,
        estado,
        notas,
        fecha_pago: estado === 'pagado' ? new Date().toISOString() : null,
      })
      .eq('id', existing.id)

    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('pagos').insert({
      contrato_id: contratoId,
      periodo,
      valor_uf: valorUf,
      valor_clp: valorClp,
      estado,
      notas,
      fecha_pago: estado === 'pagado' ? new Date().toISOString() : null,
    })

    if (error) return { error: error.message }
  }

  revalidatePath('/arrendador')
  return { success: true }
}

export async function actualizarContrato(id: string, formData: FormData) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const { error } = await admin
    .from('contratos')
    .update({
      valor_uf: parseFloat(formData.get('valor_uf') as string),
      dia_pago: parseInt(formData.get('dia_pago') as string),
      fecha_fin: formData.get('fecha_fin') || null,
    })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/arrendador')
  return { success: true }
}

export async function eliminarPropiedad(propiedadId: string) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  // Verify ownership
  const { data: propiedad } = await admin
    .from('propiedades')
    .select('id')
    .eq('id', propiedadId)
    .eq('arrendador_id', user.id)
    .single()

  if (!propiedad) return { error: 'Propiedad no encontrada' }

  // Soft delete
  const { error } = await admin
    .from('propiedades')
    .update({ activa: false })
    .eq('id', propiedadId)

  if (error) return { error: error.message }

  revalidatePath('/arrendador')
  return { success: true }
}

export async function guardarArrendatarioInformal(propiedadId: string, formData: FormData) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const multaMonto = formData.get('multa_monto') as string
  const rutRaw = (formData.get('rut') as string)?.trim()
  const celularRaw = (formData.get('celular') as string)?.trim()
  const fechaInicio = (formData.get('fecha_inicio') as string)?.trim()
  const fechaFin = (formData.get('fecha_fin') as string)?.trim()
  const nombre = (formData.get('nombre') as string).trim()
  const celularNorm = normalizePhone(celularRaw)
  const diaVencimiento = parseInt(formData.get('dia_vencimiento') as string) || 5

  // Check if phone changed vs what's currently saved
  const { data: propiedadActual } = await admin
    .from('propiedades')
    .select('arrendatario_informal_celular, nombre')
    .eq('id', propiedadId)
    .eq('arrendador_id', user.id)
    .single()

  if (!propiedadActual) return { error: 'Propiedad no encontrada' }

  const celularCambio = celularNorm && celularNorm !== propiedadActual.arrendatario_informal_celular

  const { error } = await admin
    .from('propiedades')
    .update({
      arrendatario_informal_nombre: nombre,
      arrendatario_informal_rut: rutRaw ? cleanRut(rutRaw) : null,
      arrendatario_informal_email: (formData.get('email') as string)?.trim() || null,
      arrendatario_informal_celular: celularNorm,
      arrendatario_informal_cobro_tipo: formData.get('cobro_tipo') as string || 'adelantado',
      arrendatario_informal_fecha_inicio: fechaInicio || null,
      arrendatario_informal_fecha_fin: fechaFin || null,
      valor_uf: parseFloat(formData.get('valor_uf') as string),
      moneda: formData.get('moneda') as string,
      dia_vencimiento: diaVencimiento,
      multa_monto: multaMonto ? parseFloat(multaMonto) : null,
      multa_moneda: formData.get('multa_moneda') as string,
      // Reset whatsapp_estado when phone changes
      ...(celularCambio ? { whatsapp_estado: 'pendiente' } : {}),
    })
    .eq('id', propiedadId)
    .eq('arrendador_id', user.id)

  if (error) return { error: error.message }

  // Send WhatsApp confirmation if phone is new or changed
  if (celularCambio && celularNorm) {
    const propiedadNombre = propiedadActual.nombre
    const mensaje =
      `Hola ${nombre} 👋\n\n` +
      `Tu arrendador te ha registrado como arrendatario de *${propiedadNombre}*.\n\n` +
      `A partir de ahora podrías recibir recordatorios de pago de arriendo por WhatsApp.\n\n` +
      `¿Estás de acuerdo?\n` +
      `✅ Responde *Si* para confirmar\n` +
      `❌ Responde *No* para rechazar`
    await enviarWhatsApp(celularNorm, mensaje)
  }

  revalidatePath(`/arrendador/propiedades/${propiedadId}`)
  revalidatePath('/arrendador')
  return { success: true }
}

export async function limpiarArrendatarioInformal(propiedadId: string) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const { error } = await admin
    .from('propiedades')
    .update({
      arrendatario_informal_nombre: null,
      arrendatario_informal_celular: null,
    })
    .eq('id', propiedadId)
    .eq('arrendador_id', user.id)

  if (error) return { error: error.message }

  revalidatePath(`/arrendador/propiedades/${propiedadId}`)
  revalidatePath('/arrendador')
  return { success: true }
}

export async function actualizarTelefonoArrendatario(arrendatarioId: string, telefono: string) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  // Verify this arrendatario belongs to one of this arrendador's active contracts
  const { data: contrato } = await admin
    .from('contratos')
    .select('id, propiedades(arrendador_id)')
    .eq('arrendatario_id', arrendatarioId)
    .eq('activo', true)
    .single()

  const arrendadorId = (contrato as unknown as { propiedades?: { arrendador_id: string } } | null)
    ?.propiedades?.arrendador_id

  if (!contrato || arrendadorId !== user.id) return { error: 'No autorizado' }

  const { error } = await admin
    .from('profiles')
    .update({ telefono: telefono.trim() || null })
    .eq('id', arrendatarioId)

  if (error) return { error: error.message }
  revalidatePath('/arrendador/propiedades')
  return { success: true }
}

export async function eliminarPago(pagoId: string) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  // Verify ownership via contrato or propiedad
  const { data: pago } = await admin
    .from('pagos')
    .select('id, contrato_id, propiedad_id')
    .eq('id', pagoId)
    .single()

  if (!pago) return { error: 'Pago no encontrado' }

  if (pago.contrato_id) {
    const { data: contrato } = await admin
      .from('contratos')
      .select('propiedades(arrendador_id)')
      .eq('id', pago.contrato_id)
      .single()
    const arrendadorId = (contrato as unknown as { propiedades?: { arrendador_id: string } })?.propiedades?.arrendador_id
    if (arrendadorId !== user.id) return { error: 'No autorizado' }
  } else if (pago.propiedad_id) {
    const { data: prop } = await admin
      .from('propiedades')
      .select('id')
      .eq('id', pago.propiedad_id)
      .eq('arrendador_id', user.id)
      .single()
    if (!prop) return { error: 'No autorizado' }
  }

  const { error } = await admin.from('pagos').delete().eq('id', pagoId)
  if (error) return { error: error.message }

  revalidatePath('/arrendador')
  revalidatePath('/arrendador/propiedades')
  return { success: true }
}

export async function registrarPagoInformal(propiedadId: string, formData: FormData) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  const { data: propiedad } = await admin
    .from('propiedades')
    .select('id, dia_vencimiento, multa_monto, multa_moneda')
    .eq('id', propiedadId)
    .eq('arrendador_id', user.id)
    .single()

  if (!propiedad) return { error: 'No autorizado' }

  const periodo = formData.get('periodo') as string
  const valorUf = parseFloat(formData.get('valor_uf') as string)
  const valorClp = formData.get('valor_clp') ? parseInt(formData.get('valor_clp') as string) : null
  let estado = formData.get('estado') as string
  let notas = (formData.get('notas') as string) || ''

  // Auto-detect atraso cuando se registra como pagado
  if (estado === 'pagado' && propiedad.dia_vencimiento) {
    const [year, month] = periodo.split('-').map(Number)
    const fechaVencimiento = new Date(year, month - 1, propiedad.dia_vencimiento)
    const hoy = todayInChile()
    if (hoy > fechaVencimiento) {
      const diasAtraso = Math.floor((hoy.getTime() - fechaVencimiento.getTime()) / (24 * 60 * 60 * 1000))
      estado = 'atrasado'
      if (propiedad.multa_monto && diasAtraso > 0) {
        const multaTotal = diasAtraso * propiedad.multa_monto
        const moneda = propiedad.multa_moneda ?? 'CLP'
        const multaStr = moneda === 'CLP'
          ? `$${multaTotal.toLocaleString('es-CL')} CLP`
          : `${multaTotal} ${moneda}`
        notas = `Pago con ${diasAtraso} día(s) de atraso. Multa: ${multaStr}${notas ? '. ' + notas : ''}`
      } else {
        notas = `Pago con ${diasAtraso} día(s) de atraso${notas ? '. ' + notas : ''}`
      }
    }
  }

  const { data: existing } = await admin
    .from('pagos')
    .select('id')
    .eq('propiedad_id', propiedadId)
    .eq('periodo', periodo)
    .maybeSingle()

  if (existing) {
    const { error } = await admin.from('pagos').update({
      valor_uf: valorUf,
      valor_clp: valorClp,
      estado,
      notas,
      fecha_pago: estado === 'pagado' ? new Date().toISOString() : null,
    }).eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('pagos').insert({
      propiedad_id: propiedadId,
      contrato_id: null,
      periodo,
      valor_uf: valorUf,
      valor_clp: valorClp,
      estado,
      notas,
      fecha_pago: estado === 'pagado' ? new Date().toISOString() : null,
    })
    if (error) return { error: error.message }
  }

  revalidatePath(`/arrendador/propiedades/${propiedadId}`)
  revalidatePath('/arrendador')
  return { success: true }
}

export async function desvincularArrendatario(contratoId: string) {
  const { user, admin } = await getAuthContext()
  if (!user) return { error: 'No autenticado' }

  // Verify the contract belongs to a property owned by this user
  const { data: contrato } = await admin
    .from('contratos')
    .select('id, propiedad_id, propiedades(arrendador_id)')
    .eq('id', contratoId)
    .single()

  const arrendadorId = (contrato as { propiedades: { arrendador_id: string } } | null)
    ?.propiedades?.arrendador_id

  if (!contrato || arrendadorId !== user.id) return { error: 'No autorizado' }

  const { error } = await admin
    .from('contratos')
    .update({ activo: false, fecha_fin: new Date().toISOString().split('T')[0] })
    .eq('id', contratoId)

  if (error) return { error: error.message }

  revalidatePath('/arrendador')
  return { success: true }
}
