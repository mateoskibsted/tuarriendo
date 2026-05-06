import { NextRequest, NextResponse } from 'next/server'

function autenticado(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}` || req.nextUrl.searchParams.get('secret') === secret
}

// Legacy entry point — delegates to manana cron
export async function GET(req: NextRequest) {
  if (!autenticado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const base = req.nextUrl.origin
  const headers = { authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` }
  const notifRes = await fetch(`${base}/api/cron/notificaciones?turno=manana`, { headers }).then(r => r.json()).catch(e => ({ error: String(e) }))
  return NextResponse.json({ ok: true, notificaciones: notifRes })
}
