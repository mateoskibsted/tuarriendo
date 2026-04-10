/**
 * Fetches current UF value from mindicador.cl
 */
export async function getUFValue(): Promise<number> {
  try {
    const res = await fetch('https://mindicador.cl/api/uf', {
      next: { revalidate: 3600 }, // Cache for 1 hour
    })
    const data = await res.json()
    return data.serie[0]?.valor ?? 37000
  } catch {
    return 37000 // Fallback value
  }
}

/**
 * Fetches UF value for a specific date (YYYY-MM-DD).
 * Uses mindicador.cl/api/uf/YYYY-MM-DD.
 * If the date has no data (weekend/holiday), falls back to the most recent value.
 * Cached 24h since historical values never change.
 */
export async function getUFValueForDate(dateISO: string): Promise<number> {
  // dateISO can be a full ISO string — extract YYYY-MM-DD
  const datePart = dateISO.slice(0, 10)
  try {
    const res = await fetch(`https://mindicador.cl/api/uf/${datePart}`, {
      next: { revalidate: 86400 }, // Cache 24h — historical values never change
    })
    const data = await res.json()
    const valor = data.serie?.[0]?.valor
    if (valor && typeof valor === 'number' && valor > 0) return valor
    // Fallback: try the current value
    return getUFValue()
  } catch {
    return getUFValue()
  }
}

export function formatUF(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatCLP(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    minimumFractionDigits: 0,
  }).format(value)
}
