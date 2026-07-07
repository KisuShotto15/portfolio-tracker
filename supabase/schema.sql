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
