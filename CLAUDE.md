# ArriendoPro — Instrucciones del proyecto

App web de gestión de arriendos para Chile. Permite a arrendadores administrar sus propiedades y a arrendatarios ver sus pagos.

## Stack técnico
- **Framework**: Next.js 14 con App Router y TypeScript
- **Base de datos y auth**: Supabase (RLS habilitado en todas las tablas)
- **Estilos**: Tailwind CSS
- **Deploy**: Vercel (Hobby plan — 2 crons)
- **WhatsApp**: Twilio Sandbox (bot bidireccional: notificaciones + reporte de pagos)
- **Cron**: 2 Vercel Cron Jobs — mañana (10 AM Chile) y noche (9 PM Chile)

## Estructura de carpetas real
```
app/
  arrendador/
    page.tsx                        # Dashboard: stats, pagos pendientes WhatsApp, propiedades
    TelefonoArrendadorForm.tsx      # Form cliente para que arrendador guarde su WhatsApp
    PagosPendientesWhatsApp.tsx     # Server component: lista pagos_pendientes del arrendador
    ConfirmarRechazarPago.tsx       # Client component: botones confirmar/rechazar pago pendiente
    propiedades/
      [id]/page.tsx                 # Detalle de propiedad (formal e informal)
      nueva/page.tsx                # Formulario nueva propiedad
  arrendatario/
    page.tsx
  api/
    cron/
      manana/route.ts   # 10 AM Chile: llama notificaciones?turno=manana
      noche/route.ts    # 9 PM Chile: llama notificaciones?turno=noche
      notificaciones/route.ts  # WhatsApp salientes: aviso_3d/2d/1d + vencimiento + atraso
    whatsapp/
      webhook/route.ts  # Bidireccional: arrendatario reporta pago, arrendador confirma
  actions/
    arrendador.ts       # Server Actions: CRUD propiedades, pagos, arrendatarios, teléfonos
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
    uf.ts         # getUFValue(), getUFValueForDate(), formatUF(), formatCLP()
    date.ts       # todayInChile() — UTC-4 fijo
    twilio.ts     # enviarWhatsApp(), formatWhatsAppNumber()
    rut.ts
vercel.json       # 2 crons: manana (0 14 * * *) y noche (0 1 * * *)
```

## Base de datos (tablas reales en Supabase)

Todas las tablas tienen **RLS habilitado**. El `createAdminClient()` (service role) bypasa RLS.

### profiles
- id (= auth.users.id), nombre, rut, email, rol ('arrendador' | 'arrendatario')
- telefono (WhatsApp — tanto arrendadores como arrendatarios), created_at

### propiedades
- id, arrendador_id, nombre, direccion, tipo
- valor_uf (número), moneda ('UF' | 'CLP')
- dia_vencimiento, activa, created_at
- multa_monto, multa_moneda ('UF' | 'CLP') — multa diaria por atraso
- **Arrendatario informal**:
  - arrendatario_informal_nombre, arrendatario_informal_rut
  - arrendatario_informal_celular (WhatsApp)
  - arrendatario_informal_cobro_tipo ('adelantado' | 'atrasado')
  - arrendatario_informal_fecha_inicio, arrendatario_informal_fecha_fin
  - whatsapp_estado ('pendiente' | 'confirmado' | 'rechazado')

### contratos
- id, propiedad_id, arrendatario_id, fecha_inicio, fecha_fin, activo
- dia_pago

### pagos
- id, contrato_id (nullable), propiedad_id (nullable — para informales)
- periodo (YYYY-MM), valor_uf, monto_clp, estado ('pagado' | 'atrasado' | 'incompleto')
- fecha_pago, notas, created_at

### pagos_pendientes
- id, propiedad_id (nullable), contrato_id (nullable)
- arrendatario_phone, arrendatario_nombre
- arrendador_id, monto_clp, periodo
- estado ('pendiente' | 'confirmado' | 'rechazado'), created_at
- Creado cuando arrendatario reporta pago por WhatsApp; arrendador confirma/rechaza desde dashboard o WhatsApp

### whatsapp_sesiones
- phone (PK), estado ('esperando_monto')
- propiedad_id (nullable), contrato_id (nullable), periodo (nullable)
- updated_at
- Estado de conversación multi-turno en el webhook

### notificaciones_log
- id, contrato_id, propiedad_id (nullable), tipo, periodo, mensaje, exitosa, created_at
- Previene duplicar notificaciones salientes del cron

### codigos_invitacion
- id, arrendador_id, propiedad_id, arrendatario_rut, arrendatario_nombre
- arrendatario_email, codigo, usado, expira_en, created_at

## Reglas de negocio críticas

### RUT chileno
- Almacenar sin puntos ni guión; mostrar formateado "12.345.678-9"
- Usar `lib/utils/rut.ts`

### Valor UF
- Obtener desde: https://mindicador.cl/api/uf — cachear 24 horas
- `lib/utils/uf.ts`: `getUFValue()`, `getUFValueForDate(date)`, `formatUF()`, `formatCLP()`
- **CRÍTICO**: `Math.round(Number(valor_uf))` — Supabase devuelve numéricos como strings

### Fecha y hora en Chile
- `todayInChile()` de `lib/utils/date.ts` — UTC-4 fijo desde 2024

### Roles y acceso
- **Arrendador**: crea propiedades, gestiona arrendatarios/pagos, confirma reportes WhatsApp
- **Arrendatario**: ve su propiedad, monto y historial de pagos
- Redirigir automáticamente según rol tras login

### Arrendatarios informales vs formales
- **Formal**: contrato en `contratos`, vinculado a `profiles`
- **Informal**: campos `arrendatario_informal_*` en `propiedades`, sin contrato
- Pagos informales usan `propiedad_id`; formales usan `contrato_id`

### Flujo WhatsApp bidireccional (webhook `/api/whatsapp/webhook`)

**Identificación por número entrante (orden de prioridad):**
1. Arrendador (`profiles.rol = 'arrendador'` con telefono)
2. Arrendatario informal (`propiedades.arrendatario_informal_celular`)
3. Arrendatario formal (`profiles.rol = 'arrendatario'` con telefono)

**Arrendatario → "Pagué" (o variantes):**
1. Webhook detecta keyword de pago → guarda sesión `whatsapp_sesiones.estado = 'esperando_monto'`
2. Arrendatario responde con el monto → webhook crea `pagos_pendientes`, borra sesión
3. Notifica al arrendador por Twilio outbound (si tiene telefono configurado)
4. Responde al arrendatario: "Tu reporte fue enviado"

**Arrendador → "Confirmar" / "Rechazar":**
1. Webhook detecta arrendador → busca `pagos_pendientes` más antiguo (FIFO)
2. "Confirmar" → crea `pagos` record, actualiza `pagos_pendientes.estado = 'confirmado'`, notifica arrendatario
3. "Rechazar" → actualiza estado, notifica arrendatario
4. Sin pendientes → muestra mensaje informativo

**Opt-in arrendatario:**
- "Si" → `propiedades.whatsapp_estado = 'confirmado'`
- "No" → `propiedades.whatsapp_estado = 'rechazado'`
- Opt-in se envía automáticamente al crear/editar arrendatario con celular nuevo

### Bot de WhatsApp — notificaciones salientes (cron)
- Usa Twilio Sandbox: `whatsapp:+14155238886`
- Webhook URL: `https://tuarriendo-ten.vercel.app/api/whatsapp/webhook`
- **Mañana** (10 AM Chile, `0 14 * * *` UTC): aviso_3d, aviso_2d, aviso_1d, vencimiento_m, atraso_N_m
- **Noche** (9 PM Chile, `0 1 * * *` UTC): vencimiento_n, atraso_N_n
- Deduplicación: `notificaciones_log` previene repetir el mismo `tipo` en el mismo `periodo`
- Maneja ambos: contratos formales + informales

### Multas por atraso
- Configuradas por propiedad: `multa_monto` + `multa_moneda`
- `multaAcumuladaCLP = multaDiariaCLP * diasAtraso`
- Total = `Math.round(Number(montoPrincipal)) + multaAcumuladaCLP`

### Identificación de arrendador en webhook
- El arrendador también debe tener su WhatsApp en `profiles.telefono`
- Se puede configurar desde el dashboard (`TelefonoArrendadorForm`)
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
UF_CACHE_HOURS=24
```

## Vercel — notas de deploy

- Si el build falla por archivos stale del `.next/` (tipo `validator.ts` referenciando rutas eliminadas): usar `vercel deploy --prod --force` para bypassar el cache de Vercel
- Variables de entorno "Needs Attention": abrir cada una en Settings → Environment Variables → Edit → Save (sin cambiar el valor). Las obsoletas se eliminan con `vercel env rm NOMBRE --yes`
- Variables obsoletas ya eliminadas (mayo 2026): `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

## Regla de colaboración
Antes de empezar cualquier tarea siempre ejecutar:
`git pull origin main`

Después de terminar cada tarea siempre ejecutar:
`git add . && git commit -m "descripción breve" && git push origin main && vercel --prod`

Al final de cada sesión: actualizar este CLAUDE.md con lo que cambió (nuevas tablas, decisiones de arquitectura, bugs conocidos, notas de deploy).
