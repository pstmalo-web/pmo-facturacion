-- Esquema base del repo de facturación.
--
-- Las tablas de FACTURACIÓN (facturas, factura_items, entidades_fiscales,
-- entidades_fiscales_alias, secuencias_fiscales) son copia fiel de producción
-- al 2026-10-21: columnas, checks, índices, triggers y RLS.
--
-- Las tablas del RESTO del PMO (perfiles, proyectos, cotizaciones,
-- cotizacion_items, proyecto_archivos) van RECORTADAS a las columnas que el
-- módulo lee o escribe. En producción tienen muchas más; no las supongas.
-- Si el módulo necesita una columna nueva de esas tablas, avísalo en el PR:
-- no se puede añadir aquí sin más.
--
-- Lo que NO se replica: la auditoría por fila (`auditar_fila`), que en el PMO
-- escribe en una tabla de bitácora general.

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create or replace function public.sin_acentos(t text)
returns text
language sql
immutable
strict
parallel safe
set search_path = extensions, pg_temp
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, t));
$$;

create or replace function public.normalizar_nombre(t text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(upper(btrim(regexp_replace(
           regexp_replace(public.sin_acentos(coalesce(t, '')), '[​-‍⁠﻿]', '', 'g'),
           '\s+', ' ', 'g'))), '')
$$;

create or replace function public.sellar_editor()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Resto del PMO (recortado)
-- ---------------------------------------------------------------------------
create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  nombre text not null default '',
  apellido text not null default '',
  rol text not null default 'cotizador'
    check (rol in ('admin', 'pm', 'cotizador', 'auditor', 'cofounder')),
  foto_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.es_equipo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from perfiles where id = auth.uid())
$$;

create or replace function public.es_gestor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select rol from perfiles where id = auth.uid()) in ('admin', 'pm'),
    false
  )
$$;

create or replace function public.es_auditor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select rol from perfiles where id = auth.uid()) in ('auditor', 'cofounder'),
    false
  )
$$;

create table public.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  numero text not null,
  cliente_nombre text not null default '',
  cliente_direccion text,
  cliente_contacto_email text,
  datos_pliego jsonb,
  entidad_id uuid,
  created_at timestamptz not null default now()
);

create table public.cotizacion_items (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references public.cotizaciones (id) on delete cascade,
  orden integer not null default 0,
  nombre text not null,
  descripcion text,
  precio_unitario numeric not null default 0,
  cantidad numeric not null default 1,
  itbms_exento boolean not null default false,
  renglon_numero integer
);

create table public.proyectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null default '',
  cliente text,
  numero_acto text,
  numero_oc text,
  cotizacion_id uuid references public.cotizaciones (id) on delete set null,
  entidad_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.proyecto_archivos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos (id) on delete cascade,
  nombre text not null default '',
  url text not null default '',
  tipo text not null default 'otro'
    check (tipo in ('cotizacion', 'orden_compra', 'factura', 'otro')),
  orden integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Facturación (copia fiel de producción)
-- ---------------------------------------------------------------------------
create table public.entidades_fiscales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  siglas text,
  tipo_ruc text not null default '2' check (tipo_ruc in ('1', '2')),
  ruc text not null unique,
  dv text not null,
  razon_social text not null,
  direccion text not null default '',
  codigo_ubicacion text,
  provincia text,
  distrito text,
  corregimiento text,
  correo text,
  telefono text,
  verificado_en timestamptz,
  afiliado_fe boolean,
  notas text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid
);

alter table public.cotizaciones
  add constraint cotizaciones_entidad_id_fkey
  foreign key (entidad_id) references public.entidades_fiscales (id) on delete set null;
alter table public.proyectos
  add constraint proyectos_entidad_id_fkey
  foreign key (entidad_id) references public.entidades_fiscales (id) on delete set null;

create table public.entidades_fiscales_alias (
  id uuid primary key default gen_random_uuid(),
  entidad_id uuid not null references public.entidades_fiscales (id) on delete cascade,
  alias text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_entidades_alias_entidad on public.entidades_fiscales_alias (entidad_id);

create table public.facturas (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid references public.proyectos (id) on delete set null,
  cotizacion_id uuid references public.cotizaciones (id) on delete set null,
  entidad_id uuid references public.entidades_fiscales (id) on delete set null,
  sucursal text not null default '0000',
  punto_facturacion text not null,
  tipo_documento text not null default '01',
  numero_documento bigint,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'emitiendo', 'autorizada', 'rechazada', 'anulada')),
  receptor jsonb not null default '{}'::jsonb,
  total_neto numeric not null default 0,
  total_itbms numeric not null default 0,
  total numeric not null default 0,
  retencion_aplicada boolean not null default false,
  retencion_monto numeric,
  forma_pago text not null default '01',
  tiempo_pago text not null default '2',
  correos text[] not null default '{}'::text[],
  fecha_emision timestamptz,
  cufe text,
  qr_url text,
  protocolo_autorizacion text,
  payload jsonb,
  respuesta jsonb,
  mensaje_error text,
  pdf_path text,
  xml_path text,
  motivo_anulacion text,
  anulada_en timestamptz,
  creada_por uuid references public.perfiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ambiente text not null default 'produccion' check (ambiente in ('demo', 'produccion')),
  updated_by uuid,
  constraint facturas_serie_ambiente_key
    unique (ambiente, sucursal, punto_facturacion, tipo_documento, numero_documento)
);
create index idx_facturas_cotizacion on public.facturas (cotizacion_id);
create index idx_facturas_creada_por on public.facturas (creada_por);
create index idx_facturas_entidad on public.facturas (entidad_id);
create index idx_facturas_proyecto on public.facturas (proyecto_id);

create table public.factura_items (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references public.facturas (id) on delete cascade,
  orden integer not null default 0,
  descripcion text not null,
  cantidad numeric not null default 1,
  precio_unitario numeric not null default 0,
  itbms_exento boolean not null default false,
  valor_itbms numeric not null default 0,
  cpbs_abrev text,
  cpbs text,
  unidad_medida text not null default 'und',
  unidad_medida_cpbs text,
  renglon_numero integer
);
create index idx_factura_items_factura on public.factura_items (factura_id, orden);

create table public.secuencias_fiscales (
  ambiente text not null check (ambiente in ('demo', 'produccion')),
  sucursal text not null,
  punto text not null,
  tipo_documento text not null,
  proximo_numero bigint not null default 1,
  primary key (ambiente, sucursal, punto, tipo_documento)
);

-- ---------------------------------------------------------------------------
-- Candados del documento fiscal
-- ---------------------------------------------------------------------------
create or replace function public.proteger_factura()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.ambiente = 'demo' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.estado in ('emitiendo', 'autorizada', 'anulada') then
      raise exception 'Una factura % no se borra.', old.estado;
    end if;
    return old;
  end if;

  if old.estado = 'anulada' then
    raise exception 'Una factura anulada es terminal: no se edita.';
  end if;

  if old.estado = 'autorizada' then
    if new.estado not in ('autorizada', 'anulada') then
      raise exception 'Una factura autorizada solo puede pasar a anulada.';
    end if;
    if new.numero_documento is distinct from old.numero_documento
      or new.sucursal is distinct from old.sucursal
      or new.punto_facturacion is distinct from old.punto_facturacion
      or new.tipo_documento is distinct from old.tipo_documento
      or new.ambiente is distinct from old.ambiente
      or new.cufe is distinct from old.cufe
      or new.fecha_emision is distinct from old.fecha_emision
      or new.receptor is distinct from old.receptor
      or new.payload is distinct from old.payload
      or new.total_neto is distinct from old.total_neto
      or new.total_itbms is distinct from old.total_itbms
      or new.total is distinct from old.total
      or new.retencion_aplicada is distinct from old.retencion_aplicada
      or new.retencion_monto is distinct from old.retencion_monto
      or new.proyecto_id is distinct from old.proyecto_id
      or new.cotizacion_id is distinct from old.cotizacion_id
    then
      raise exception 'Una factura autorizada es un documento fiscal: sus datos no se editan.';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_proteger_factura
  before update or delete on public.facturas
  for each row execute function public.proteger_factura();
create trigger trg_zz_sellar_editor
  before update on public.facturas
  for each row execute function public.sellar_editor();

create or replace function public.proteger_factura_items()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_estado text;
  v_ambiente text;
begin
  select estado, ambiente into v_estado, v_ambiente
    from facturas
   where id = coalesce(new.factura_id, old.factura_id);
  if v_ambiente = 'demo' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if v_estado is not null and v_estado not in ('borrador', 'rechazada') then
    raise exception 'Los renglones de una factura % no se editan.', v_estado;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_proteger_factura_items
  before insert or update or delete on public.factura_items
  for each row execute function public.proteger_factura_items();

create trigger trg_zz_sellar_editor
  before update on public.entidades_fiscales
  for each row execute function public.sellar_editor();

-- Un alias nuevo liga las cotizaciones y proyectos que aún no tienen entidad.
create or replace function public.alias_rellena_entidades()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.cotizaciones
     set entidad_id = new.entidad_id
   where entidad_id is null
     and public.normalizar_nombre(cliente_nombre) = public.normalizar_nombre(new.alias);
  update public.proyectos p
     set entidad_id = new.entidad_id
   where p.entidad_id is null
     and (public.normalizar_nombre(p.cliente) = public.normalizar_nombre(new.alias)
          or exists (select 1 from public.cotizaciones c
                      where c.id = p.cotizacion_id and c.entidad_id = new.entidad_id));
  return null;
end
$$;

create trigger trg_alias_rellena_entidades
  after insert on public.entidades_fiscales_alias
  for each row execute function public.alias_rellena_entidades();

-- ---------------------------------------------------------------------------
-- Numeración fiscal: el número sale de aquí, nunca del cliente
-- ---------------------------------------------------------------------------
create or replace function public.siguiente_numero_fiscal(
  p_ambiente text, p_sucursal text, p_punto text, p_tipo text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n bigint;
begin
  if not es_gestor() then
    raise exception 'Solo Admin o PM pueden consumir la numeración fiscal.';
  end if;

  if p_ambiente not in ('demo', 'produccion') then
    raise exception 'Ambiente fiscal desconocido: %.', p_ambiente;
  end if;

  insert into secuencias_fiscales (ambiente, sucursal, punto, tipo_documento)
  values (p_ambiente, p_sucursal, p_punto, p_tipo)
  on conflict (ambiente, sucursal, punto, tipo_documento) do nothing;

  update secuencias_fiscales
     set proximo_numero = proximo_numero + 1
   where ambiente = p_ambiente
     and sucursal = p_sucursal
     and punto = p_punto
     and tipo_documento = p_tipo
  returning proximo_numero - 1 into n;

  if n is null then
    raise exception 'No se pudo generar el número fiscal de la serie %/%-%-%.',
      p_ambiente, p_sucursal, p_punto, p_tipo;
  end if;

  return n;
end;
$$;

-- Todo RPC nace ejecutable por PUBLIC (y por tanto por anon): se cierra aquí.
revoke execute on function public.siguiente_numero_fiscal(text, text, text, text) from public, anon;
grant execute on function public.siguiente_numero_fiscal(text, text, text, text) to authenticated;
revoke execute on function public.alias_rellena_entidades() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Privilegios. Desde el 30-oct-2026 Supabase deja de dar GRANT automáticos a
-- las tablas nuevas: toda tabla nueva lleva los suyos explícitos, como estas.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  public.perfiles, public.cotizaciones, public.cotizacion_items, public.proyectos,
  public.proyecto_archivos, public.entidades_fiscales, public.entidades_fiscales_alias,
  public.facturas, public.factura_items
  to authenticated;
-- secuencias_fiscales solo se toca por el RPC (security definer).
revoke all on public.secuencias_fiscales from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS. Patrón del PMO en las tablas de facturación:
--   · 1 RESTRICTIVA «solo el equipo del PMO» (hay que tener perfil),
--   · 3 RESTRICTIVAS del auditor (no inserta, no edita, no borra),
--   · PERMISIVAS: el equipo lee; el gestor (admin|pm) escribe.
-- Toda tabla nueva del módulo debe llevar este mismo juego.
-- ---------------------------------------------------------------------------
alter table public.perfiles enable row level security;
alter table public.cotizaciones enable row level security;
alter table public.cotizacion_items enable row level security;
alter table public.proyectos enable row level security;
alter table public.proyecto_archivos enable row level security;
alter table public.secuencias_fiscales enable row level security;

create policy "cada quien lee los perfiles del equipo" on public.perfiles
  for select to authenticated using ((select es_equipo()));

-- Las tablas del resto del PMO: lectura para el equipo, escritura del gestor
-- (simplificación de las reglas reales, suficiente para este repo).
do $$
declare t text;
begin
  foreach t in array array['cotizaciones', 'cotizacion_items', 'proyectos', 'proyecto_archivos'] loop
    execute format('create policy "equipo lee" on public.%I for select to authenticated using ((select es_equipo()))', t);
    execute format('create policy "gestor escribe (alta)" on public.%I for insert to authenticated with check ((select es_gestor()))', t);
    execute format('create policy "gestor escribe (edición)" on public.%I for update to authenticated using ((select es_gestor())) with check ((select es_gestor()))', t);
    execute format('create policy "gestor escribe (baja)" on public.%I for delete to authenticated using ((select es_gestor()))', t);
  end loop;
end
$$;

do $$
declare
  t text;
  etiqueta text;
begin
  foreach t in array array['facturas', 'factura_items', 'entidades_fiscales', 'entidades_fiscales_alias'] loop
    etiqueta := case t
      when 'facturas' then 'facturas'
      when 'factura_items' then 'factura items'
      when 'entidades_fiscales' then 'entidades fiscales'
      else 'alias de entidades'
    end;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "solo el equipo del PMO" on public.%I as restrictive for all to authenticated using ((select es_equipo())) with check ((select es_equipo()))', t);
    execute format('create policy "auditor sin insertar" on public.%I as restrictive for insert to authenticated with check (not (select es_auditor()))', t);
    execute format('create policy "auditor sin editar" on public.%I as restrictive for update to authenticated using (not (select es_auditor())) with check (not (select es_auditor()))', t);
    execute format('create policy "auditor sin borrar" on public.%I as restrictive for delete to authenticated using (not (select es_auditor()))', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', 'equipo lee ' || etiqueta, t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select es_gestor()))', 'gestor escribe ' || etiqueta || ' (alta)', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select es_gestor())) with check ((select es_gestor()))', 'gestor escribe ' || etiqueta || ' (edición)', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select es_gestor()))', 'gestor escribe ' || etiqueta || ' (baja)', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Storage: copia fiscal (facturas) y copia de trabajo en el expediente
-- (proyecto-archivos). Ambos privados.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('facturas', 'facturas', false), ('proyecto-archivos', 'proyecto-archivos', false)
on conflict (id) do nothing;

create policy "facturas lee" on storage.objects
  for select to authenticated using (bucket_id = 'facturas');
create policy "facturas escribe" on storage.objects
  for insert to authenticated with check (bucket_id = 'facturas' and es_gestor());
create policy "facturas actualiza" on storage.objects
  for update to authenticated
  using (bucket_id = 'facturas' and es_gestor())
  with check (bucket_id = 'facturas' and es_gestor());
create policy "facturas borra" on storage.objects
  for delete to authenticated using (bucket_id = 'facturas' and es_gestor());

create policy "expediente lee" on storage.objects
  for select to authenticated using (bucket_id = 'proyecto-archivos' and es_equipo());
create policy "expediente escribe" on storage.objects
  for insert to authenticated with check (bucket_id = 'proyecto-archivos' and es_gestor());
