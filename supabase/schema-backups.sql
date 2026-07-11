-- Backups diarios del doc de cada usuario (los toma /api/backup via Vercel Cron).
-- RLS habilitado SIN policies: solo el service role (que las bypasea) puede leer
-- o escribir — ningun usuario ve backups, ni los suyos.
-- Correr una vez en el SQL editor de Supabase.
create table if not exists app_state_backups (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  doc jsonb not null,
  taken_at timestamptz not null default now()
);
alter table app_state_backups enable row level security;
create index if not exists app_state_backups_user_taken
  on app_state_backups (user_id, taken_at desc);
