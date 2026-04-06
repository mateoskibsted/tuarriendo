/**
 * Validates and formats Chilean RUT
 */
export function formatRut(rut: string): string {
  const cleaned = rut.replace(/[^0-9kK]/g, '').toUpperCase()
  if (cleaned.length < 2) return cleaned
  const body = cleaned.slice(0, -1)
  const dv = cleaned.slice(-1)
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`
}

export function cleanRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, '').toUpperCase()
}

export function validateRut(rut: string): boolean {
  const cleaned = cleanRut(rut)
  if (cleaned.length < 8 || cleaned.length > 9) return false

  const body = cleaned.slice(0, -1)
  const dv = cleaned.slice(-1)

  let sum = 0
  let multiplier = 2

  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * multiplier
    multiplier = multiplier === 7 ? 2 : multiplier + 1
  }

  const remainder = 11 - (sum % 11)
  const expectedDv =
    remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder)

  return dv === expectedDv
}
