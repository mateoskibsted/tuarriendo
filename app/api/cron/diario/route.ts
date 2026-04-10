import { NextRequest, NextResponse } from 'next/server'

function autenticado(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const auth = req.headers.get('authorization')
  const qs = req.nextUrl.searchParams.get('secret')
  return auth === `Bearer ${secret}` || qs === secret
}

// Single daily cron that runs both notifications and email scanner.
// Hobby plan only allows one cron per day — this consolidates them.
export async function GET(req: NextRequest) {
  if (!autenticado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const base = req.nextUrl.origin

  const [notifRes, escanearRes] = await Promise.allSettled([
    fetch(`${base}/api/cron/notificaciones`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
    }).then(r => r.json()),
    fetch(`${base}/api/cron/escanear`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
    }).then(r => r.json()),
  ])

  return NextResponse.json({
    ok: true,
    notificaciones: notifRes.status === 'fulfilled' ? notifRes.value : { error: String(notifRes.reason) },
    escanear: escanearRes.status === 'fulfilled' ? escanearRes.value : { error: String(escanearRes.reason) },
  })
}
