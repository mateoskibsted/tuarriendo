-- ArriendoPro Schema

-- Users table (extends Supabase auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  rut TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('arrendador', 'arrendatario')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Properties table
CREATE TABLE IF NOT EXISTS public.propiedades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  arrendador_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  nombre TEXT NOT NULL,
  direccion TEXT NOT NULL,
  descripcion TEXT,
  valor_uf NUMERIC(10, 2) NOT NULL,
  moneda TEXT DEFAULT 'UF' CHECK (moneda IN ('UF', 'CLP')),
  dia_vencimiento INTEGER DEFAULT 5 CHECK (dia_vencimiento BETWEEN 1 AND 28),
  multa_monto NUMERIC(10, 2),
  multa_moneda TEXT DEFAULT 'UF' CHECK (multa_moneda IN ('UF', 'CLP')),
  activa BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invitation codes
CREATE TABLE IF NOT EXISTS public.codigos_invitacion (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  propiedad_id UUID REFERENCES public.propiedades(id) ON DELETE CASCADE NOT NULL,
  codigo TEXT UNIQUE NOT NULL,
  usado BOOLEAN DEFAULT FALSE,
  arrendatario_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

-- Contracts (link tenant to property)
CREATE TABLE IF NOT EXISTS public.contratos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  propiedad_id UUID REFERENCES public.propiedades(id) ON DELETE CASCADE NOT NULL,
  arrendatario_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  valor_uf NUMERIC(10, 2) NOT NULL,
  dia_pago INTEGER DEFAULT 5 CHECK (dia_pago BETWEEN 1 AND 28),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(propiedad_id, arrendatario_id, activo)
);

-- Payments
CREATE TABLE IF NOT EXISTS public.pagos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contrato_id UUID REFERENCES public.contratos(id) ON DELETE CASCADE NOT NULL,
  periodo TEXT NOT NULL, -- e.g. "2024-01"
  valor_uf NUMERIC(10, 2) NOT NULL,
  valor_clp NUMERIC(12, 0),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado', 'atrasado')),
  fecha_pago TIMESTAMPTZ,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Schema permissions (required for service_role and authenticated users)
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

-- RLS Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.propiedades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codigos_invitacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own
CREATE POLICY "profiles_self" ON public.profiles FOR ALL USING (auth.uid() = id);

-- Properties: arrendador manages their own, arrendatario sees linked ones
CREATE POLICY "propiedades_arrendador" ON public.propiedades
  FOR ALL USING (arrendador_id = auth.uid());

CREATE POLICY "propiedades_arrendatario_view" ON public.propiedades
  FOR SELECT USING (
    id IN (
      SELECT propiedad_id FROM public.contratos
      WHERE arrendatario_id = auth.uid() AND activo = TRUE
    )
  );

-- Invitation codes: arrendador manages, anyone can read by code
CREATE POLICY "codigos_arrendador" ON public.codigos_invitacion
  FOR ALL USING (
    propiedad_id IN (
      SELECT id FROM public.propiedades WHERE arrendador_id = auth.uid()
    )
  );

CREATE POLICY "codigos_read_public" ON public.codigos_invitacion
  FOR SELECT USING (TRUE);

-- Contracts: arrendador manages, arrendatario views own
CREATE POLICY "contratos_arrendador" ON public.contratos
  FOR ALL USING (
    propiedad_id IN (
      SELECT id FROM public.propiedades WHERE arrendador_id = auth.uid()
    )
  );

CREATE POLICY "contratos_arrendatario" ON public.contratos
  FOR SELECT USING (arrendatario_id = auth.uid());

-- Payments: arrendador manages, arrendatario views own
CREATE POLICY "pagos_arrendador" ON public.pagos
  FOR ALL USING (
    contrato_id IN (
      SELECT c.id FROM public.contratos c
      JOIN public.propiedades p ON c.propiedad_id = p.id
      WHERE p.arrendador_id = auth.uid()
    )
  );

CREATE POLICY "pagos_arrendatario" ON public.pagos
  FOR SELECT USING (
    contrato_id IN (
      SELECT id FROM public.contratos WHERE arrendatario_id = auth.uid()
    )
  );
