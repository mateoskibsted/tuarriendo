import { formatCLP } from './currency'

export function generarLinkCobro(phone: string, concepto: string, monto: number, esRecordatorio = false): string {
  const montoStr = formatCLP(monto)
  const msg = esRecordatorio
    ? `Hola! Te recuerdo que tienes un pago pendiente de ${montoStr} por ${concepto} 🔔`
    : `Hola! Te escribo desde Owe 📋 Tienes un pago pendiente de ${montoStr} por ${concepto}. Cuando pagues avísame por acá!`
  const digits = phone.replace(/\D/g, '')
  const normalized = digits.startsWith('56') ? digits : `56${digits.replace(/^0/, '')}`
  return `https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`
}
