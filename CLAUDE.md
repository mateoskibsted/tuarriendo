# ArriendoPro — Instrucciones del proyecto

App web de gestión de arriendos para Chile. Permite a arrendadores administrar sus propiedades y a arrendatarios ver sus pagos.

## Stack técnico
- **Framework**: Next.js 14 con App Router y TypeScript
- **Base de datos y auth**: Supabase
- **Estilos**: Tailwind CSS
- **Deploy**: Vercel
- **Email**: Nodemailer o Resend (para notificaciones)

## Estructura de carpetas esperada
```
app/
  (auth)/login/          # Página de login
  (arrendador)/          # Rutas protegidas del arrendador
    dashboard/
    propiedades/
    arrendatarios/
    invitar/
    email/
  (arrendatario)/        # Rutas protegidas del arrendatario
    dashboard/
    pagos/
components/              # Componentes reutilizables
lib/
  supabase.ts            # Cliente de Supabase
  uf.ts                  # Utilidades para valor UF
  rut.ts                 # Validación de RUT chileno
  email.ts               # Lógica de detección de pagos
```

## Base de datos (tablas en Supabase)

### usuarios
- id, rut (único), nombre, email, rol (arrendador | arrendatario), password_hash, created_at

### propiedades
- id, arrendador_id, nombre, direccion, tipo (depto | casa | oficina | local)
- uf_mensual, dia_vencimiento, cuenta_bancaria, activa, created_at

### contratos
- id, propiedad_id, arrendatario_id, fecha_inicio, fecha_fin, activo

### pagos
- id, contrato_id, periodo (YYYY-MM), uf_valor, monto_uf, monto_clp
- fecha_pago, confirmado, email_origen, created_at

### invitaciones
- id, arrendador_id, propiedad_id, arrendatario_rut, arrendatario_nombre
- arrendatario_email, codigo (único), usado, expira_en, created_at

## Reglas de negocio críticas

### RUT chileno
- Siempre validar formato y dígito verificador
- Almacenar sin puntos ni guión: "123456789" internamente
- Mostrar formateado: "12.345.678-9" en la UI
- Usar el archivo `lib/rut.ts` para todas las operaciones con RUT

### Valor UF
- Obtener el valor diario desde: https://mindicador.cl/api/uf
- Cachear el valor por 24 horas (no llamar la API en cada render)
- Siempre mostrar el monto en UF y su equivalente en CLP lado a lado
- Usar el archivo `lib/uf.ts` para todas las conversiones

### Roles y acceso
- **Arrendador**: puede crear propiedades, generar códigos de invitación, ver todos sus arrendatarios y pagos, conectar su email
- **Arrendatario**: solo puede ver su propia propiedad, su monto actual y su historial de pagos
- Redirigir automáticamente según rol después del login

### Códigos de invitación
- Formato: APR-XXXX (4 dígitos aleatorios)
- Válidos por 7 días desde su creación
- Un solo uso: marcar como usado al ser canjeado
- Al canjear: crear el contrato y vincular arrendatario a propiedad automáticamente

### Detección de pagos por email
- El arrendador conecta su correo (Gmail u Outlook)
- El sistema escanea correos con asunto que contenga "transferencia" o "depósito"
- Detectar RUT o nombre del arrendatario en el cuerpo del correo
- Mostrar coincidencia sugerida al arrendador para que confirme
- Al confirmar: registrar pago en tabla `pagos` y notificar al arrendatario

## Convenciones de código

- Todos los componentes en TypeScript estricto (no usar `any`)
- Usar Server Components por defecto, Client Components solo cuando sea necesario (formularios, estado)
- Manejo de errores siempre con try/catch y mensajes en español
- Variables de entorno: nunca hardcodear credenciales, siempre usar `.env.local`
- Comentarios en español cuando el código no sea autoevidente

## Variables de entorno necesarias (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=           # Para envío de emails de notificación
UF_CACHE_HOURS=24
```

## Flujos principales a implementar en orden

1. **Login** — validar RUT + contraseña, redirigir según rol
2. **Dashboard arrendador** — resumen de propiedades y pagos del mes
3. **Agregar propiedad** — formulario con validaciones
4. **Invitar arrendatario** — generar código, mostrar para compartir
5. **Onboarding arrendatario** — canjear código, confirmar propiedad
6. **Dashboard arrendatario** — ver propiedad, monto en UF y CLP, historial
7. **Registro de pagos** — detección por email + confirmación manual
8. **Notificaciones** — email al arrendatario cuando se confirma su pago

## Lo que NO hacer
- No usar `localStorage` para guardar sesiones (usar cookies de Supabase)
- No mostrar montos sin su equivalente en CLP
- No permitir que un arrendatario vea datos de otro arrendatario
- No generar dos códigos activos para la misma propiedad al mismo tiempo
- No hardcodear el valor de la UF
