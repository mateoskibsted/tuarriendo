import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Redirect unauthenticated users to login (including /)
  if (!user && !pathname.startsWith('/login') && !pathname.startsWith('/registro')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Redirect authenticated users away from auth pages using admin client (bypasses RLS)
  if (user && (pathname === '/login' || pathname === '/registro' || pathname === '/')) {
    try {
      const admin = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      // DB role values are still 'arrendador'/'arrendatario' — routes are now /acreedor and /deudor
      if (profile?.role === 'arrendador') {
        return NextResponse.redirect(new URL('/acreedor', request.url))
      } else if (profile?.role === 'arrendatario') {
        return NextResponse.redirect(new URL('/deudor', request.url))
      }
    } catch {
      // If Supabase is unreachable, redirect to login as fallback
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  return supabaseResponse
}
