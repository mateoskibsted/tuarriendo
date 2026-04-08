import twilio from 'twilio'

export function getTwilioClient() {
  return twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
  )
}

/** Normalize Chilean phone to WhatsApp format: +569XXXXXXXX */
export function formatWhatsAppNumber(telefono: string): string {
  const digits = telefono.replace(/\D/g, '')
  // If starts with 56 → already has country code
  if (digits.startsWith('56') && digits.length === 11) return `whatsapp:+${digits}`
  // If 9 digits starting with 9 → add +56
  if (digits.startsWith('9') && digits.length === 9) return `whatsapp:+56${digits}`
  // 8 digits → add +569
  if (digits.length === 8) return `whatsapp:+569${digits}`
  return `whatsapp:+${digits}`
}

export async function enviarWhatsApp(telefono: string, mensaje: string): Promise<boolean> {
  try {
    const client = getTwilioClient()
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM!,
      to: formatWhatsAppNumber(telefono),
      body: mensaje,
    })
    return true
  } catch (err) {
    console.error('Error Twilio:', err)
    return false
  }
}
