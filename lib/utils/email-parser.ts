export interface EmailParseResult {
  monto_clp?: number
  rut?: string
  nombre?: string
  banco?: string
}

const BANKS = [
  { pattern: /banco\s*estado/i, name: 'BancoEstado' },
  { pattern: /santander/i, name: 'Santander' },
  { pattern: /bci\b/i, name: 'BCI' },
  { pattern: /banco de chile/i, name: 'Banco de Chile' },
  { pattern: /edwards/i, name: 'Banco de Chile' },
  { pattern: /itaú|itau/i, name: 'Itaú' },
  { pattern: /falabella/i, name: 'Falabella' },
  { pattern: /scotiabank/i, name: 'Scotiabank' },
  { pattern: /security/i, name: 'Banco Security' },
  { pattern: /bice\b/i, name: 'BICE' },
]

// Normalize Chilean amount strings like "1.234.567" or "1,234,567" to a number
function parseChileanAmount(raw: string): number {
  // Remove thousand separators (dots in Chile) and parse
  const cleaned = raw.replace(/\./g, '').replace(',', '')
  return parseInt(cleaned, 10)
}

export function parseEmailForPayment(subject: string, body: string): EmailParseResult {
  const result: EmailParseResult = {}
  const text = `${subject}\n${body}`

  // Detect bank
  for (const { pattern, name } of BANKS) {
    if (pattern.test(text)) {
      result.banco = name
      break
    }
  }

  // Extract CLP amount — prefer labeled lines, fall back to any $ amount
  const labeledAmount = body.match(/(?:monto|valor|importe|abono|dep[oó]sito)[:\s$]*\$?\s*([\d]{1,3}(?:\.[\d]{3})*)/i)
  if (labeledAmount) {
    const n = parseChileanAmount(labeledAmount[1])
    if (n >= 10000) result.monto_clp = n
  } else {
    // Find all dollar amounts and pick the largest (likely the transfer amount)
    const allAmounts = [...body.matchAll(/\$\s*([\d]{1,3}(?:\.[\d]{3})+)/g)]
    const parsed = allAmounts
      .map(m => parseChileanAmount(m[1]))
      .filter(n => n >= 10000)
    if (parsed.length > 0) result.monto_clp = Math.max(...parsed)
  }

  // Extract RUT (with or without dots/dash)
  const rutMatch = body.match(/\b(\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK])\b/)
  if (rutMatch) {
    // Normalize: remove dots and dash for storage comparison
    result.rut = rutMatch[1].replace(/\./g, '').replace('-', '').toUpperCase()
  }

  // Extract sender name using common label prefixes
  const nameMatch = body.match(
    /(?:nombre|de|remitente|ordenante|emisor)[:\s]+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s]{3,40})/
  )
  if (nameMatch) {
    result.nombre = nameMatch[1].trim().replace(/\s{2,}/g, ' ')
  }

  return result
}

/** Decode Gmail base64url encoded body */
export function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

/** Recursively extract plain text from a Gmail MIME payload */
export function extractTextFromPayload(payload: {
  mimeType?: string | null
  body?: { data?: string | null } | null
  parts?: Array<{
    mimeType?: string | null
    body?: { data?: string | null } | null
    parts?: unknown[]
  }> | null
}): string {
  if (!payload) return ''

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data)
  }

  if (payload.parts) {
    // Prefer text/plain part, fall back to text/html
    let htmlFallback = ''
    for (const part of payload.parts) {
      const text = extractTextFromPayload(part as Parameters<typeof extractTextFromPayload>[0])
      if (part.mimeType === 'text/plain' && text) return text
      if (part.mimeType === 'text/html' && text) htmlFallback = text
    }
    return htmlFallback
  }

  if (payload.mimeType === 'text/html' && payload.body?.data) {
    const html = decodeBase64Url(payload.body.data)
    // Strip tags for basic text extraction
    return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ')
  }

  return ''
}
