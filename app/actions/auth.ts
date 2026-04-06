'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { cleanRut, validateRut } from '@/lib/utils/rut'
import type { Role } from '@/lib/types'

export async function login(formData: FormData) {
  const rut = cleanRut(formData.get('rut') as string)
  const password = formData.get('password') as string

  if (!validateRut(rut)) {
    return { error: 'RUT inválido' }
  }

  // Use admin client to look up email by RUT — user isn't authenticated yet
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('email, role')
    .eq('rut', rut)
    .single()

  if (!profile?.email) {
    return { error: 'RUT no registrado' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password,
  })

  if (error) {
    return { error: 'Contraseña incorrecta' }
  }

  revalidatePath('/', 'layout')
  redirect(profile.role === 'arrendador' ? '/arrendador' : '/arrendatario')
}

export async function registro(formData: FormData) {
  const rut = cleanRut(formData.get('rut') as string)
  const nombre = (formData.get('nombre') as string).trim()
  const email = (formData.get('email') as string).trim()
  const password = formData.get('password') as string
  const role = formData.get('role') as Role
  const codigoInvitacion = formData.get('codigo_invitacion') as string | null

  if (!validateRut(rut)) {
    return { error: 'RUT inválido' }
  }

  if (password.length < 8) {
    return { error: 'La contraseña debe tener al menos 8 caracteres' }
  }

  // Use admin client for all DB operations during registration —
  // the user has no session yet, so RLS would block every write.
  const admin = createAdminClient()

  // Check if RUT already exists
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('rut', rut)
    .single()

  if (existing) {
    return { error: 'Este RUT ya está registrado' }
  }

  // For arrendatario, validate invitation code
  let codigoData = null
  if (role === 'arrendatario') {
    if (!codigoInvitacion) {
      return { error: 'Se requiere código de invitación para arrendatarios' }
    }

    const { data: codigo } = await admin
      .from('codigos_invitacion')
      .select('*')
      .eq('codigo', codigoInvitacion.toUpperCase())
      .eq('usado', false)
      .single()

    if (!codigo) {
      return { error: 'Código de invitación inválido o ya utilizado' }
    }

    if (new Date(codigo.expires_at) < new Date()) {
      return { error: 'El código de invitación ha expirado' }
    }

    codigoData = codigo
  }

  // Create auth user via the session-aware client so the cookie gets set
  const supabase = await createClient()
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  })

  if (authError || !authData.user) {
    return { error: authError?.message ?? 'Error al crear cuenta' }
  }

  // Insert profile via admin client (bypasses RLS — session not available yet)
  const { error: profileError } = await admin.from('profiles').insert({
    id: authData.user.id,
    rut,
    nombre,
    email,
    role,
  })

  if (profileError) {
    // Clean up the auth user so the account isn't left in a broken state
    await admin.auth.admin.deleteUser(authData.user.id)
    return { error: 'Error al crear perfil: ' + profileError.message }
  }

  // If arrendatario with valid code, link to property
  if (role === 'arrendatario' && codigoData) {
    await admin
      .from('codigos_invitacion')
      .update({ usado: true, arrendatario_id: authData.user.id })
      .eq('id', codigoData.id)

    await admin.from('contratos').insert({
      propiedad_id: codigoData.propiedad_id,
      arrendatario_id: authData.user.id,
      fecha_inicio: new Date().toISOString().split('T')[0],
      valor_uf: 0,
      activo: true,
    })
  }

  // signUp may not create a session if email confirmation is enabled in Supabase.
  // Sign in immediately so the session cookie is set before the redirect —
  // otherwise the middleware can't read the profile and sends the user to the wrong panel.
  if (!authData.session) {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      return { error: 'Cuenta creada, pero no se pudo iniciar sesión: ' + signInError.message }
    }
  }

  revalidatePath('/', 'layout')
  redirect(role === 'arrendador' ? '/arrendador' : '/arrendatario')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
