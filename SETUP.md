# ArriendoPro - Setup

## 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com)
2. Ve a **SQL Editor** y ejecuta el archivo `supabase/schema.sql`
3. Copia las credenciales desde **Settings > API**

## 2. Variables de entorno

Edita `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

## 3. Correr localmente

```bash
npm run dev
```

Abre http://localhost:3000

## Flujo de uso

### Arrendador
1. Registrarse como arrendador
2. Crear propiedades (nombre, dirección, valor UF)
3. Generar código de invitación para cada propiedad
4. Compartir el código al arrendatario
5. Ver pagos y registrarlos mes a mes

### Arrendatario
1. Recibir código de invitación del arrendador
2. Registrarse como arrendatario ingresando el código
3. Ver su propiedad, valor en UF y historial de pagos
