import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  // Must be logged in as arrendador
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL!))

  const state = randomBytes(16).toString('hex')
  const cookieStore = await cookies()
  cookieStore.set('gmail_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  })

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/gmail/callback`
  )

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    state,
    prompt: 'consent', // Needed to always get a refresh_token
  })

  return NextResponse.redirect(url)
}
