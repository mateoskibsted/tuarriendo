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
