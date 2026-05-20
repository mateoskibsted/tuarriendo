# Owe — Instrucciones del proyecto

App mobile-first para cobrar deudas fácilmente por WhatsApp sin ser incómodo.

**Concepto**: Owe cobra por ti. Registras una deuda → la app genera el mensaje → abres WhatsApp y solo aprietas enviar.

**Casos de uso**: clases particulares, gastos compartidos, ligas deportivas, préstamos entre amigos, servicios freelance.

## Stack técnico
- **Framework**: Next.js 14 con App Router y TypeScript
- **Base de datos y auth**: Supabase (RLS habilitado)
- **Estilos**: Tailwind CSS
- **Deploy**: Vercel (Hobby plan)
- **WhatsApp**: links nativos `https://wa.me/NUMERO?text=MENSAJE` — sin Twilio, sin bots

## Diseño
- **Mobile-first**: pantallas de ~375px, botones grandes
- **Bottom navigation**: Inicio | Nueva | Historial | Perfil
- **Sin sidebar** — layout simple con header negro y nav inferior
- **Colores**: navbar gris-950, botones de acción verde-700, badges azul/morado para tipo

## Flujo principal
1. Acreedor crea deuda (wizard paso a paso)
2. Al crear → app genera link `wa.me` con mensaje prellenado
3. Acreedor abre WhatsApp y envía el mensaje con un toque
4. Cuando le pagan → acreedor marca la deuda como pagada manualmente desde el detalle
5. Deuda se mueve al historial

## Mensajes WhatsApp
- **Primera vez**: `Hola! Te escribo desde Owe 📋 Tienes un pago pendiente de $[monto] por [concepto]. Cuando pagues avísame por acá!`
- **Recordatorio**: `Hola! Te recuerdo que tienes un pago pendiente de $[monto] por [concepto] 🔔`
- Generados por `lib/utils/whatsapp.ts` → `generarLinkCobro(phone, concepto, monto, esRecordatorio?)`

## Estructura de carpetas
```
app/
  acreedor/
    layout.tsx              # Auth check + bottom nav
    page.tsx                # Dashboard: total pendiente + lista deudas activas
    historial/page.tsx      # Deudas pagadas (activa = false)
    perfil/page.tsx         # Perfil + logout
    deudas/
      nueva/
        page.tsx            # Selector tipo: Simple | Recurrente
        simple/page.tsx     # Wizard 4 pasos + paso 5 éxito con links WA
        recurrente/page.tsx # Wizard 4 pasos + paso 5 éxito con link WA
      [id]/
        page.tsx            # Detalle: monto, deudor, botones Cobrar / Recordatorio / Marcar pagada
        MarcarPagadaButton.tsx # Client component — set activa=false
  deudor/page.tsx
  actions/acreedor.ts       # Server actions (sin Twilio)
  login/page.tsx
  registro/page.tsx
components/
  BottomNav.tsx             # Bottom tabs (client component, usePathname)
  ui/Badge.tsx, Button.tsx, Input.tsx
lib/
  utils/
    whatsapp.ts  # generarLinkCobro() — genera links wa.me
    currency.ts  # formatCLP()
    date.ts      # todayInChile() — UTC-4 fijo
    rut.ts
vercel.json
```

## Base de datos
Sigue usando la tabla `propiedades` (nombre histórico) para deudas.

### propiedades (= deudas en Owe)
- `arrendador_id` = acreedor_id
- `nombre` = título de la deuda
- `valor_uf` = monto CLP (nombre histórico, siempre CLP en Owe)
- `dia_vencimiento = null` → deuda **simple** (evento único)
- `dia_vencimiento IS NOT NULL` → deuda **recurrente** (cobro mensual)
- `arrendatario_informal_nombre` = nombre del deudor
- `arrendatario_informal_celular` = WhatsApp del deudor
- `activa = true` → pendiente (aparece en dashboard)
- `activa = false` → pagada (aparece en historial)
- `descripcion` = detalle opcional

### profiles
- `id`, `nombre`, `email`, `rut`, `role` ('arrendador' | 'arrendatario'), `created_at`

### Otras tablas (legacy, no usadas activamente)
- `pagos` — historial de pagos por período (ArriendoPro legacy)
- `contratos` — contratos formales (ArriendoPro legacy)
- `pagos_pendientes` — reportes WhatsApp (bot legacy, sin uso activo)
- `notificaciones_log` — log de crons (legacy)

## Reglas de negocio

### Moneda
- Solo CLP
- **CRÍTICO**: `Math.round(Number(monto))` — Supabase devuelve numéricos como strings
- `formatCLP()` en `lib/utils/currency.ts`

### Tipos de deuda
- **Simple** (`dia_vencimiento = null`): evento único. Se puede dividir entre N personas con montos editables. Acreedor se puede incluir en el split.
- **Recurrente** (`dia_vencimiento = 1..28`): cobro mensual fijo. Un solo deudor por deuda.

### Marcar como pagada
- `marcarDeudaComoPagada(id)` → `update propiedades set activa = false`
- Mueve la deuda del dashboard al historial
- Para deudas recurrentes: marcar como pagada cierra esa instancia. Si quiere cobrar el mes siguiente, el acreedor crea una nueva o reactiva.

### WhatsApp links
- `generarLinkCobro(phone, concepto, monto, esRecordatorio?)` en `lib/utils/whatsapp.ts`
- Normaliza número a `56XXXXXXXXX` sin el `+`
- Retorna `https://wa.me/{numero}?text={mensaje_encodificado}`
- Los links se muestran en: pantalla de éxito al crear, detalle de deuda, tarjeta en dashboard

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
CRON_SECRET=
```
(Twilio eliminado — ya no se usa)

## Vercel — notas de deploy
- Deploy automático al pushear a main en GitHub
- **NO correr `vercel --prod` manualmente** — genera deployments duplicados
- Si el build falla por archivos stale: borrar `.next/` localmente y hacer push limpio
- Variables obsoletas eliminadas: `ANTHROPIC_API_KEY`, `GOOGLE_*`, `UF_CACHE_HOURS`, `TWILIO_*`

## Regla de colaboración
Antes de empezar cualquier tarea siempre ejecutar:
`git pull origin main`

Después de terminar cada tarea siempre ejecutar:
`git add . && git commit -m "descripción breve" && git push origin main`

Vercel despliega automáticamente al detectar el push en GitHub — NO correr `vercel --prod` manualmente para evitar deployments duplicados.

Al final de cada sesión: actualizar este CLAUDE.md con lo que cambió (nuevas tablas, decisiones de arquitectura, bugs conocidos, notas de deploy).
