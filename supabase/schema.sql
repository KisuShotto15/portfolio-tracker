-- Portfolio tracker — esquema multi-usuario (camino B1)
-- Una fila por usuario; el estado completo (el objeto S del cliente) vive en `doc` jsonb.
-- Toda la logica de merge LWW/tombstones sigue en api/sync.js; Postgres solo guarda
-- el blob y FUERZA el aislamiento por usuario via Row-Level Security.
--
-- Ejecutar en Supabase: Dashboard > SQL Editor > pegar y correr.

create table if not exists public.app_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  doc        jsonb        not null default '{}'::jsonb,
  updated_at timestamptz  not null default now()
);

alter table public.app_state enable row level security;

-- Cada usuario solo puede ver/escribir SU fila. auth.uid() lo pone Postgres a
-- partir del JWT verificado — el cliente no puede falsear de quien es.
create policy "own row: select"
  on public.app_state for select
  using (auth.uid() = user_id);

create policy "own row: insert"
  on public.app_state for insert
  with check (auth.uid() = user_id);

create policy "own row: update"
  on public.app_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Mantener updated_at fresco en cada escritura.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists app_state_touch on public.app_state;
create trigger app_state_touch
  before update on public.app_state
  for each row execute function public.touch_updated_at();

-- ── Backups diarios (app_state_backups) ─────────────────────────────────────
-- La escribe /api/backup (cron diario de vercel.json) y la lee /api/restore.
-- Estaba en un archivo aparte (schema-backups.sql), que es facil correr a medias
-- o no correr nunca: si la tabla no existe en la base real, el cron devuelve
-- error TODOS los dias y nadie se entera — un cron que falla no le avisa a nadie,
-- y el respaldo diario es la unica marcha atras del proyecto (el doc vive en una
-- sola fila y el merge no tiene papelera). Ahora va en el mismo archivo que
-- app_state: correrlo entero es idempotente y no deja mitades.
--
-- La definicion es EXACTAMENTE la que estaba en schema-backups.sql (sin cambios,
-- para que siga coincidiendo con la tabla que ya pueda existir en la base).
-- Varias filas por usuario (una por dia); /api/backup poda a los 30 dias por
-- taken_at, y /api/restore busca por user_id + taken_at exactos.
create table if not exists app_state_backups (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  doc jsonb not null,
  taken_at timestamptz not null default now()
);

-- El listado de /api/restore ordena por taken_at desc y filtra por usuario.
create index if not exists app_state_backups_user_taken
  on app_state_backups (user_id, taken_at desc);

-- RLS activa y A PROPOSITO sin ninguna policy: la app nunca toca esta tabla. Los
-- unicos que entran son /api/backup y /api/restore con la service key, que
-- bypasea RLS del lado del servidor. Sin policies, ningun JWT de usuario puede
-- leer ni escribir los backups — ni los suyos ni los de nadie.
alter table app_state_backups enable row level security;
