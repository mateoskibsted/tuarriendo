# Owe — Instrucciones del proyecto

App web para gestionar deudas personales entre personas. Permite a acreedores crear y hacer seguimiento de deudas, y a deudores ver lo que deben y reportar pagos.

**Casos de uso**: clases particulares, gastos compartidos, ligas deportivas, préstamos entre amigos, servicios freelance.

## Pivote desde ArriendoPro (mayo 2026)
- `arrendador` → `acreedor` (quien cobra)
- `arrendatario` → `deudor` (quien debe)
- `propiedad` → `deuda` (concepto, monto, fecha límite)
- Eliminado: UF, días fijos de vencimiento, multas automáticas, contratos formales/informales
- Mantenido: bot WhatsApp bidireccional, crons, Supabase, Twilio

## Stack técnico
- **Framework**: Next.js 14 con App Router y TypeScript
- **Base de datos y auth**: Supabase (RLS habilitado en todas las tablas)
- **Estilos**: Tailwind CSS
- **Deploy**: Vercel (Hobby plan — 2 crons)
- **WhatsApp**: Twilio Sandbox (bot bidireccional: recordatorios + reporte de pagos)
- **Cron**: 2 Vercel Cron Jobs — mañana (10 AM Chile) y noche (9 PM Chile)

## Estructura de carpetas objetivo
```
app/
  acreedor/
    page.tsx                        # Dashboard: stats, pagos pendientes WhatsApp, deudas
    TelefonoAcreedorForm.tsx        # Form cliente para que acreedor guarde su WhatsApp
    PagosPendientesWhatsApp.tsx     # Server component: lista pagos_pendientes del acreedor
    ConfirmarRechazarPago.tsx       # Client component: botones confirmar/rechazar pago pendiente
    deudas/
      [id]/page.tsx                 # Detalle de deuda
      nueva/page.tsx                # Formulario nueva deuda
  deudor/
    page.tsx
  api/
    cron/
      manana/route.ts   # 10 AM Chile: llama notificaciones?turno=manana
      noche/route.ts    # 9 PM Chile: llama notificaciones?turno=noche
      notificaciones/route.ts  # WhatsApp salientes: aviso_3d/2d/1d + vencimiento + atraso
    whatsapp/
      webhook/route.ts  # Bidireccional: deudor reporta pago, acreedor confirma
  actions/
    acreedor.ts         # Server Actions: CRUD deudas, pagos, deudores, teléfonos
  login/page.tsx
  registro/page.tsx
  layout.tsx
components/
  ui/
    Badge.tsx
    Button.tsx
    Input.tsx
  Navbar.tsx
lib/
  supabase/
    admin.ts      # createAdminClient() — service role, bypasa RLS
    client.ts     # createClient() — anon key, usa RLS
    server.ts     # createClient() server-side con cookies
    middleware.ts
  types/index.ts
  utils/
    currency.ts   # formatCLP(), formatMonto() — sin UF
    date.ts       # todayInChile() — UTC-4 fijo
    twilio.ts     # enviarWhatsApp(), formatWhatsAppNumber()
    rut.ts        # Opcional — identificación chilena
vercel.json       # 2 crons: manana (0 14 * * *) y noche (0 1 * * *)
```

## Base de datos (tablas objetivo en Supabase)

Todas las tablas tienen **RLS habilitado**. El `createAdminClient()` (service role) bypasa RLS.

### profiles
- id (= auth.users.id), nombre, rut (opcional), email, rol ('acreedor' | 'deudor')
- telefono (WhatsApp), created_at

### deudas
- id, acreedor_id (FK → profiles)
- descripcion — qué es la deuda ("Clases de inglés marzo", "Mitad cena cumpleaños")
- deudor_nombre, deudor_celular (WhatsApp del deudor — no requiere cuenta)
- monto (CLP), fecha_vencimiento (DATE — fecha límite de pago)
- estado ('pendiente' | 'pagada' | 'vencida'), activa, created_at
- whatsapp_estado ('pendiente' | 'confirmado' | 'rechazado') — opt-in del deudor

### pagos_pendientes
- id, deuda_id (FK → deudas)
- deudor_phone, deudor_nombre
- acreedor_id, monto, fecha_reporte
- estado ('pendiente' | 'confirmado' | 'rechazado'), created_at
- Creado cuando deudor reporta pago por WhatsApp; acreedor confirma/rechaza desde dashboard o WhatsApp

### whatsapp_sesiones
- phone (PK), estado ('esperando_monto')
- deuda_id (nullable)
- updated_at
- Estado de conversación multi-turno en el webhook

### notificaciones_log
- id, deuda_id, tipo, fecha_referencia, mensaje, exitosa, created_at
- Previene duplicar notificaciones salientes del cron

### codigos_invitacion
- id, acreedor_id, deuda_id, deudor_email, codigo, usado, expira_en, created_at
- Para vincular deudores que quieren tener cuenta

## Reglas de negocio

### Moneda
- Solo CLP (o monto libre ingresado por el acreedor)
- `formatCLP()` en `lib/utils/currency.ts`
- **CRÍTICO**: `Math.round(Number(monto))` — Supabase devuelve numéricos como strings

### Fecha y hora en Chile
- `todayInChile()` de `lib/utils/date.ts` — UTC-4 fijo desde 2024

### Roles y acceso
- **Acreedor**: crea deudas, gestiona deudores, confirma reportes WhatsApp
- **Deudor**: ve sus deudas y estado de pagos (opcional — no requiere cuenta)
- Redirigir automáticamente según rol tras login

### Flujo principal
1. Acreedor crea deuda con descripción, monto, fecha_vencimiento y celular del deudor
2. Bot WhatsApp envía opt-in al deudor automáticamente
3. Cron envía recordatorios: 3d antes, 2d antes, 1d antes, día de vencimiento, días de atraso
4. Deudor responde "Pagado" → sesión multi-turno → reporta monto → crea `pagos_pendientes`
5. Acreedor recibe notificación y confirma/rechaza desde dashboard o WhatsApp

### Flujo WhatsApp bidireccional (webhook `/api/whatsapp/webhook`)

**Identificación por número entrante (orden de prioridad):**
1. Acreedor (`profiles.rol = 'acreedor'` con telefono)
2. Deudor (`deudas.deudor_celular`)

**Deudor → "Pagado" (o variantes):**
1. Webhook detecta keyword de pago → guarda sesión `whatsapp_sesiones.estado = 'esperando_monto'`
2. Deudor responde con el monto → webhook crea `pagos_pendientes`, borra sesión
3. Notifica al acreedor por Twilio outbound (si tiene telefono configurado)
4. Responde al deudor: "Tu reporte fue enviado"

**Acreedor → "Confirmar" / "Rechazar":**
1. Webhook detecta acreedor → busca `pagos_pendientes` más antiguo (FIFO)
2. "Confirmar" → actualiza `deudas.estado = 'pagada'`, actualiza `pagos_pendientes.estado = 'confirmado'`, notifica deudor
3. "Rechazar" → actualiza estado, notifica deudor
4. Sin pendientes → muestra mensaje informativo

**Opt-in deudor:**
- "Si" → `deudas.whatsapp_estado = 'confirmado'`
- "No" → `deudas.whatsapp_estado = 'rechazado'`
- Opt-in se envía automáticamente al crear deuda con celular

### Bot de WhatsApp — notificaciones salientes (cron)
- Usa Twilio Sandbox: `whatsapp:+14155238886`
- Webhook URL: `https://owe-app.vercel.app/api/whatsapp/webhook` *(actualizar con dominio real)*
- **Mañana** (10 AM Chile, `0 14 * * *` UTC): aviso_3d, aviso_2d, aviso_1d, vencimiento_m, atraso_N_m
- **Noche** (9 PM Chile, `0 1 * * *` UTC): vencimiento_n, atraso_N_n
- Deduplicación: `notificaciones_log` previene repetir el mismo `tipo` en la misma `fecha_referencia`

### Identificación de acreedor en webhook
- El acreedor debe tener su WhatsApp en `profiles.telefono`
- Configurable desde dashboard (`TelefonoAcreedorForm`)
- Sin telefono → los reportes WhatsApp solo aparecen en el dashboard web

## Convenciones de código
- TypeScript estricto (no usar `any`)
- Server Components por defecto, Client Components solo para formularios/estado
- Manejo de errores con try/catch y mensajes en español
- Variables de entorno: nunca hardcodear, siempre `.env.local`
- **No** usar `.catch()` en queries de Supabase

## Variables de entorno (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

CRON_SECRET=
```

## Vercel — notas de deploy

- Si el build falla por archivos stale del `.next/`: usar `vercel deploy --prod --force`
- Variables de entorno "Needs Attention": Edit → Save sin cambiar valor
- Variables obsoletas ya eliminadas (mayo 2026): `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `UF_CACHE_HOURS`

## Regla de colaboración
Antes de empezar cualquier tarea siempre ejecutar:
`git pull origin main`

Después de terminar cada tarea siempre ejecutar:
`git add . && git commit -m "descripción breve" && git push origin main && vercel --prod`

Al final de cada sesión: actualizar este CLAUDE.md con lo que cambió (nuevas tablas, decisiones de arquitectura, bugs conocidos, notas de deploy).
