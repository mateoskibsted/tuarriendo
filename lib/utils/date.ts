/**
 * Returns midnight of today in Chile timezone (America/Santiago).
 * Use this for ALL server-side overdue/date comparisons to avoid UTC drift
 * (Vercel runs UTC; Chile is UTC-4 so after 8pm Chile, server is next day).
 */
export function todayInChile(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parseInt(parts.find(p => p.type === 'year')!.value)
  const month = parseInt(parts.find(p => p.type === 'month')!.value)
  const day = parseInt(parts.find(p => p.type === 'day')!.value)

  // Return as a plain Date at midnight (server local = UTC), but with
  // the correct Chile calendar date so comparisons against vencimiento are right.
  return new Date(year, month - 1, day)
}
