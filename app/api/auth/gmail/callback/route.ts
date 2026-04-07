import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(`${origin}/arrendador/email?error=cancelled`)
  }

  const cookieStore = await cookies()
  const savedState = cookieStore.get('gmail_oauth_state')?.value
  if (!savedState || savedState !== state) {
    return NextResponse.redirect(`${origin}/arrendador/email?error=invalid_state`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${origin}/api/auth/gmail/callback`
  )

  let tokens
  try {
    const result = await oauth2Client.getToken(code!)
    tokens = result.tokens
  } catch {
    return NextResponse.redirect(`${origin}/arrendador/email?error=token_error`)
  }

  oauth2Client.setCredentials(tokens)
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
  const gmailProfile = await gmail.users.getProfile({ userId: 'me' })
  const email = gmailProfile.data.emailAddress!

  const admin = createAdminClient()
  await admin.from('email_connections').upsert(
    {
      arrendador_id: user.id,
      provider: 'gmail',
      email,
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token ?? undefined,
      expires_at: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : undefined,
    },
    { onConflict: 'arrendador_id' }
  )

  cookieStore.delete('gmail_oauth_state')
  return NextResponse.redirect(`${origin}/arrendador/email?success=connected`)
}
