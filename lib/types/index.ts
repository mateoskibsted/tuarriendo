export type Role = 'arrendador' | 'arrendatario'
export type EstadoPago = 'pendiente' | 'pagado' | 'atrasado' | 'incompleto'

export interface Profile {
  id: string
  rut: string
  nombre: string
  email?: string
  telefono?: string
  role: Role
  created_at: string
}

export type Moneda = 'UF' | 'CLP'
export type CobroTipo = 'adelantado' | 'atrasado'
export type WhatsAppEstado = 'pendiente' | 'confirmado' | 'rechazado'

export interface Propiedad {
  id: string
  arrendador_id: string
  nombre: string
  direccion: string
  descripcion?: string
  valor_uf: number
  moneda: Moneda
  dia_vencimiento: number
  multa_monto?: number
  multa_moneda: Moneda
  activa: boolean
  arrendatario_informal_nombre?: string | null
  arrendatario_informal_rut?: string | null
  arrendatario_informal_email?: string | null
  arrendatario_informal_celular?: string | null
  arrendatario_informal_cobro_tipo?: CobroTipo | null
  arrendatario_informal_fecha_inicio?: string | null
  arrendatario_informal_fecha_fin?: string | null
  whatsapp_estado?: WhatsAppEstado | null
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

export interface Contrato {
  id: string
  propiedad_id: string
  arrendatario_id: string
  fecha_inicio: string
  fecha_fin?: string
  valor_uf: number
  dia_pago: number
  cobro_tipo?: CobroTipo
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
  propiedad_id?: string | null
  contrato_id?: string | null
  arrendatario_phone: string
  arrendatario_nombre?: string | null
  arrendador_id: string
  monto_clp: number
  periodo: string
  estado: 'pendiente' | 'confirmado' | 'rechazado'
  created_at: string
}
