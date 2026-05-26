'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function login(formData: FormData) {
  const email = (formData.get('email') as string).trim().toLowerCase()
  const password = formData.get('password') as string

  if (!email || !password) return { error: 'Email y contraseña requeridos' }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return { error: 'Email o contraseña incorrectos' }
  }

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('role').eq('id', data.user.id).single()

  revalidatePath('/', 'layout')
  redirect(profile?.role === 'arrendatario' ? '/deudor' : '/acreedor')
}

export async function registro(formData: FormData) {
  const nombre = (formData.get('nombre') as string).trim()
  const email = (formData.get('email') as string).trim().toLowerCase()
  const password = formData.get('password') as string

  if (!nombre || !email || !password) return { error: 'Todos los campos son requeridos' }
  if (password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres' }

  const admin = createAdminClient()

  // Check if email already exists in profiles
  const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
  if (existing) return { error: 'Este email ya está registrado' }

  const supabase = await createClient()
  const { data: authData, error: authError } = await supabase.auth.signUp({ email, password })

  if (authError || !authData.user) {
    return { error: authError?.message ?? 'Error al crear cuenta' }
  }

  const { error: profileError } = await admin.from('profiles').insert({
    id: authData.user.id,
    nombre,
    email,
    role: 'arrendador',
    rut: null,
  })

  if (profileError) {
    await admin.auth.admin.deleteUser(authData.user.id)
    return { error: 'Error al crear perfil: ' + profileError.message }
  }

  // Auto sign in if email confirmation is disabled
  if (!authData.session) {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) return { error: 'Cuenta creada. Por favor inicia sesión.' }
  }

  revalidatePath('/', 'layout')
  redirect('/acreedor')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
