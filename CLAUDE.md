# ArriendoPro — Instrucciones del proyecto

App web de gestión de arriendos para Chile. Permite a arrendadores administrar sus propiedades y a arrendatarios ver sus pagos.

## Stack técnico
- **Framework**: Next.js 14 con App Router y TypeScript
- **Base de datos y auth**: Supabase (RLS habilitado en todas las tablas)
- **Estilos**: Tailwind CSS
- **Deploy**: Vercel (Hobby plan — 1 cron máximo)
- **Email**: Gmail OAuth (Google API) para escáner de pagos
- **WhatsApp**: Twilio Sandbox (bot de notificaciones)
- **Cron**: Vercel Cron Jobs — 1 job diario a las 9 AM Chile (`/api/cron/diario`)

## Estructura de carpetas real
```
app/
  arrendador/            # Dashboard arrendador (Server Component)
    page.tsx             # Panel principal con stats, propiedades y pagos detectados
    PagosDetectadosAuto.tsx   # Escáner en tiempo real (polling 30s)
    PagosDetectadosCron.tsx   # Pagos detectados por el cron mientras no estabas
    email/               # Página de conexión Gmail y escáner manual
      page.tsx
      EmailPageClient.tsx
    propiedades/
      [id]/page.tsx      # Detalle de propiedad (formal e informal)
      nueva/page.tsx     # Formulario nueva propiedad
  arrendatario/          # Dashboard arrendatario
    page.tsx
  api/
    auth/gmail/
      init/route.ts      # Inicia OAuth con Google
      callback/route.ts  # Recibe el código y guarda tokens
    cron/
      diario/route.ts    # Wrapper: llama notificaciones + escanear en paralelo
      notificaciones/route.ts  # WhatsApp: 2d/1d/vencimiento/atraso con multa
      escanear/route.ts        # Gmail scan: detecta pagos y guarda en pagos_informales
    whatsapp/
      webhook/route.ts   # Recibe mensajes WhatsApp, responde con TwiML
  actions/
    email.ts             # Server Actions: escanear, confirmar, descartar pagos
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
    admin.ts    # createAdminClient() — service role, bypasa RLS
    client.ts   # createClient() — anon key, usa RLS
    server.ts   # createClient() server-side con cookies
    middleware.ts
  types/index.ts
  utils/
    uf.ts       # getUFValue(), getUFValueForDate(), formatUF(), formatCLP()
    date.ts     # todayInChile() usando Intl.DateTimeFormat('America/Santiago')
    email-parser.ts  # extractTextFromPayload, decodeBase64Url
    rut.ts
vercel.json     # { "crons": [{ "path": "/api/cron/diario", "schedule": "0 12 * * *" }] }
```

## Base de datos (tablas reales en Supabase)

Todas las tablas tienen **RLS habilitado**. El `createAdminClient()` (service role) bypasa RLS
para todas las operaciones del servidor. El `createClient()` (anon) queda bloqueado sin policies.

### profiles
- id (= auth.users.id), nombre, rut, email, rol ('arrendador' | 'arrendatario')
- telefono (para WhatsApp), created_at

### propiedades
- id, arrendador_id, nombre, direccion, tipo (depto | casa | oficina | local)
- valor_uf (número — puede ser CLP o UF), moneda ('UF' | 'CLP')
- dia_vencimiento, cuenta_bancaria, activa, created_at
- multa_monto, multa_moneda ('UF' | 'CLP') — multa diaria por atraso
- **Arrendatario informal** (sin contrato formal):
  - arrendatario_informal_nombre, arrendatario_informal_rut
  - arrendatario_informal_celular (para WhatsApp)
  - arrendatario_informal_cobro_tipo ('adelantado' | 'atrasado')
  - arrendatario_informal_fecha_inicio, arrendatario_informal_fecha_fin
  - whatsapp_estado ('pendiente' | 'confirmado' | 'rechazado')

### contratos
- id, propiedad_id, arrendatario_id, fecha_inicio, fecha_fin, activo
- dia_pago (día del mes en que vence el pago)

### pagos
- id, contrato_id (nullable), propiedad_id (nullable — para informales)
- periodo (YYYY-MM), uf_valor, monto_clp, estado ('pagado' | 'atrasado' | 'incompleto')
- fecha_pago, email_id (para dedup), created_at

### pagos_informales
- Detectados por el cron en Gmail para arrendatarios informales
- id, arrendador_id, email_id, propiedad_id, arrendatario_nombre, propiedad_nombre
- monto_clp, periodo, fecha_transferencia, uf_valor_dia, gmail_link, created_at

### email_connections
- id, arrendador_id, provider ('gmail'), email
- access_token, refresh_token, expires_at, connected_at

### notificaciones_log
- id, contrato_id, tipo (aviso_2d | aviso_1d | vencimiento | atraso_N | confirmacion_whatsapp | rechazo_whatsapp)
- periodo, mensaje, exitosa, created_at
- Previene enviar el mismo mensaje dos veces en el mismo período

### codigos_invitacion
- id, arrendador_id, propiedad_id, arrendatario_rut, arrendatario_nombre
- arrendatario_email, codigo (APR-XXXX), usado, expira_en, created_at

## Reglas de negocio críticas

### RUT chileno
- Siempre validar formato y dígito verificador
- Almacenar sin puntos ni guión: "123456789" internamente
- Mostrar formateado: "12.345.678-9" en la UI
- Usar `lib/utils/rut.ts` para todas las operaciones con RUT

### Valor UF
- Obtener el valor diario desde: https://mindicador.cl/api/uf
- Cachear el valor por 24 horas (no llamar la API en cada render)
- Siempre mostrar UF y equivalente CLP lado a lado
- Usar `lib/utils/uf.ts`: `getUFValue()`, `getUFValueForDate(date)`, `formatUF()`, `formatCLP()`
- **CRÍTICO**: Al sumar montos, siempre `Math.round(Number(valor_uf))` — Supabase puede devolver
  campos numéricos como strings, causando concatenación en lugar de suma

### Fecha y hora en Chile
- Usar siempre `todayInChile()` de `lib/utils/date.ts` para la fecha actual
- Chile está en UTC-4 permanentemente desde 2024 (sin cambio de horario)

### Roles y acceso
- **Arrendador**: crea propiedades, genera invitaciones, ve todos sus arrendatarios/pagos, conecta Gmail
- **Arrendatario**: solo ve su propiedad, monto y historial de pagos
- Redirigir automáticamente según rol después del login

### Arrendatarios informales vs formales
- **Formal**: tiene contrato en tabla `contratos`, vinculado a `profiles`
- **Informal**: campos `arrendatario_informal_*` directamente en `propiedades`, sin contrato
- Toda lógica (escáner, WhatsApp, dashboard) maneja ambos tipos
- Los pagos informales usan `propiedad_id` en lugar de `contrato_id`

### Escáner de emails (Gmail)
- OAuth con Google: `access_type: 'offline'`, `prompt: 'consent'` para obtener refresh_token
- El OAuth client escucha el evento `tokens` para guardar nuevos access_tokens automáticamente
- Si expira el refresh_token (inactividad 6 meses o revocación): mostrar banner amber "Reconectar Gmail"
- La detección de expiración es doble: proactiva en `page.tsx` (compara `expires_at`) + reactiva
  en `escanearEmails` (detecta error 401/invalid_grant y retorna `needsReconnect: true`)
- Reconectar con `/api/auth/gmail/init` hace upsert con `onConflict: 'arrendador_id'` — preserva configuración
- Query de búsqueda: `subject:(transferencia OR depósito OR deposito OR abono OR "pago recibido") newer_than:30d`

### Detección de pagos (cron + real-time)
- **Real-time** (`PagosDetectadosAuto`): polling cada 30s mientras el arrendador tiene el panel abierto
  - Muestra sugerencias con botón "Confirmar pago"
  - Si hay ambigüedad de período (mes anterior sin pagar), muestra selector de radio
- **Cron** (`PagosDetectadosCron`): el cron diario guarda detecciones en `pagos_informales`
  - Se muestran en sección "Pagos detectados mientras no estabas"
  - También tiene selector de período si hay ambigüedad

### Bot de WhatsApp (Twilio)
- Usa Twilio Sandbox: `whatsapp:+14155238886`
- Webhook en `/api/whatsapp/webhook` responde con TwiML
- El usuario inicia la sesión enviando "join <sandbox-keyword>" a Twilio
- Flujo: usuario envía cualquier mensaje → bot responde con estado del arriendo
- Respuestas:
  - **Si** → confirma recordatorios, muestra estado de pagos
  - **No** → desuscribe de recordatorios
  - **Cualquier otro** → muestra menú de bienvenida
- Si es un día de notificación (2d/1d/vencimiento/atraso), envía dos mensajes TwiML (`<Message>` doble)
- Nunca duplica el mensaje de cron del mismo día (chequea `notificaciones_log`)

### Cron diario (`/api/cron/diario`)
- Corre a las 9 AM Chile (`0 12 * * *` UTC)
- Llama en paralelo:
  1. `/api/cron/notificaciones` — envía WhatsApp según días de vencimiento/atraso
  2. `/api/cron/escanear` — escanea Gmail de todos los arrendadores y guarda en `pagos_informales`
- Autenticado con header `Authorization: Bearer ${CRON_SECRET}`

### Multas por atraso
- Configuradas por propiedad: `multa_monto` + `multa_moneda`
- Se calculan desde el día siguiente al vencimiento
- `multaAcumuladaCLP = multaDiariaCLP * diasAtraso`
- Total a pagar = `Math.round(Number(montoPrincipal)) + multaAcumuladaCLP`

## Convenciones de código
- TypeScript estricto (no usar `any`)
- Server Components por defecto, Client Components solo para formularios/estado
- Manejo de errores con try/catch y mensajes en español
- Variables de entorno: nunca hardcodear, siempre `.env.local`
- Comentarios en español cuando el código no sea autoevidente
- **No** usar `.catch()` en queries de Supabase — devuelven `PostgrestFilterBuilder`, no `Promise`

## Variables de entorno (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

GOOGLE_CLIENT_ID=          # Gmail OAuth
GOOGLE_CLIENT_SECRET=
# Redirect URI en Google Cloud Console: https://tuarriendo-ten.vercel.app/api/auth/gmail/callback

TWILIO_ACCOUNT_SID=        # WhatsApp bot
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
# Webhook URL en Twilio: https://tuarriendo-ten.vercel.app/api/whatsapp/webhook

CRON_SECRET=               # Header auth para cron jobs
UF_CACHE_HOURS=24
```

## Regla de colaboración
Antes de empezar cualquier tarea siempre ejecutar:
`git pull origin main`

Después de terminar cada tarea siempre ejecutar:
`git add . && git commit -m "descripción breve" && git push origin main && vercel --prod`
