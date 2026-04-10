// Alias de /api/cron/escanear para el turno de las 23:58 Chile (03:58 UTC).
// Vercel no permite duplicar el mismo path en vercel.json, por lo que
// esta ruta simplemente delega al mismo handler.
export { GET } from '@/app/api/cron/escanear/route'
