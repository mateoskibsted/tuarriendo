import { NextRequest, NextResponse } from 'next/server'

function autenticado(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}` || req.nextUrl.searchParams.get('secret') === secret
}

// Runs at 10 AM Chile (14:00 UTC): sends morning notifications + scans Gmail
export async function GET(req: NextRequest) {
  if (!autenticado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const base = req.nextUrl.origin
  const headers = { authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` }

  const [notifRes, escanearRes] = await Promise.allSettled([
    fetch(`${base}/api/cron/notificaciones?turno=manana`, { headers }).then(r => r.json()),
    fetch(`${base}/api/cron/escanear`, { headers }).then(r => r.json()),
  ])

  return NextResponse.json({
    ok: true,
    turno: 'manana',
    notificaciones: notifRes.status === 'fulfilled' ? notifRes.value : { error: String(notifRes.reason) },
    escanear: escanearRes.status === 'fulfilled' ? escanearRes.value : { error: String(escanearRes.reason) },
  })
}
