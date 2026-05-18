export function formatCLP(amount: number): string {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Math.round(amount))
}

export function formatMonto(amount: number, moneda = 'CLP'): string {
  if (moneda === 'CLP') return formatCLP(amount)
  return `${amount.toLocaleString('es-CL')} ${moneda}`
}
