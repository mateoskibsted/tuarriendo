// DB role values — kept as-is until DB migration
export type Role = 'arrendador' | 'arrendatario'
// DB value is still 'atrasado' — displayed as 'No pagado' until DB migration
export type EstadoPago = 'pendiente' | 'pagado' | 'atrasado' | 'incompleto'
export type WhatsAppEstado = 'pendiente' | 'confirmado' | 'rechazado'
// Kept for backward compat with detail page components pending refactor
export type Moneda = 'UF' | 'CLP'
export type CobroTipo = 'adelantado' | 'atrasado'

export interface Profile {
  id: string
  rut: string
  nombre: string
  email?: string
  telefono?: string
  role: Role
  created_at: string
}

// Deuda = una deuda individual que el acreedor crea para un deudor.
// Internamente mapea a la tabla `propiedades` hasta que se migre la DB.
export interface Deuda {
  id: string
  acreedor_id: string            // DB: arrendador_id
  descripcion: string            // DB: nombre — qué es la deuda
  deudor_nombre?: string | null  // DB: arrendatario_informal_nombre
  deudor_celular?: string | null // DB: arrendatario_informal_celular
  monto: number                  // DB: valor_uf — siempre CLP en Owe
  fecha_vencimiento?: string | null // DB: arrendatario_informal_fecha_fin (reused)
  estado: EstadoPago
  activa: boolean
  whatsapp_estado?: WhatsAppEstado | null
  created_at: string
}

// Alias para compatibilidad con código que aún usa Propiedad
export interface Propiedad {
  id: string
  arrendador_id: string
  nombre: string
  direccion: string
  descripcion?: string
  valor_uf: number
  moneda: 'UF' | 'CLP'
  dia_vencimiento: number
  multa_monto?: number
  multa_moneda: 'UF' | 'CLP'
  activa: boolean
  arrendatario_informal_nombre?: string | null
  arrendatario_informal_rut?: string | null
  arrendatario_informal_email?: string | null
  arrendatario_informal_celular?: string | null
  arrendatario_informal_cobro_tipo?: 'adelantado' | 'atrasado' | null
  arrendatario_informal_fecha_inicio?: string | null
  arrendatario_informal_fecha_fin?: string | null
  whatsapp_estado?: WhatsAppEstado | null
  created_at: string
}

export interface Contrato {
  id: string
  propiedad_id: string
  arrendatario_id: string
  fecha_inicio: string
  fecha_fin?: string
  valor_uf: number
  dia_pago: number
  cobro_tipo?: 'adelantado' | 'atrasado'
  activo: boolean
  created_at: string
  propiedades?: Propiedad
  profiles?: Profile
}

export interface Pago {
  id: string
  contrato_id?: string | null
  propiedad_id?: string | null
  periodo: string
  valor_uf: number
  valor_clp?: number
  uf_valor_dia?: number | null
  estado: EstadoPago
  fecha_pago?: string
  notas?: string
  email_origen?: string | null
  created_at: string
}

export interface PagoPendiente {
  id: string
  propiedad_id?: string | null  // deuda_id en modelo Owe
  contrato_id?: string | null
  arrendatario_phone: string    // deudor_phone en modelo Owe
  arrendatario_nombre?: string | null
  arrendador_id: string         // acreedor_id en modelo Owe
  monto_clp: number
  periodo: string
  estado: 'pendiente' | 'confirmado' | 'rechazado'
  created_at: string
}

export interface CodigoInvitacion {
  id: string
  propiedad_id: string
  codigo: string
  usado: boolean
  arrendatario_id?: string
  created_at: string
  expires_at: string
}
