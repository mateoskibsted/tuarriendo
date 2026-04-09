export type Role = 'arrendador' | 'arrendatario'
export type EstadoPago = 'pendiente' | 'pagado' | 'atrasado'

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
  estado: EstadoPago
  fecha_pago?: string
  notas?: string
  created_at: string
}

export interface EmailConnection {
  id: string
  arrendador_id: string
  provider: 'gmail'
  email: string
  connected_at: string
}

export interface PagoSugerido {
  emailId: string
  fecha: string
  asunto: string
  monto_clp?: number
  rut_detectado?: string
  nombre_detectado?: string
  banco?: string
  contrato_id?: string
  propiedad_id?: string
  arrendatario_nombre?: string
  propiedad_nombre?: string
  confianza: 'alta' | 'media' | 'baja'
  periodo: string
}
