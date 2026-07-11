-- =============================================================================
-- "Good time to call" — per-person availability.
-- Paste into the Supabase SQL editor and run. Additive & safe to re-run; does
-- NOT require auth (keyed by identity today, like the rest of the app; folds
-- into the member-only policies at the auth cutover via migration 0014).
-- =============================================================================

create table if not exists public.availability (
  id              uuid primary key default gen_random_uuid(),
  room_id         text not null,
  identity        text not null check (identity in ('me','her')),
  timezone        text not null,          -- IANA id, e.g. 'Europe/Copenhagen'
  awake_start     time not null,          -- local time
  awake_end       time not null,          -- local time
  preferred_start time,                   -- local time, optional
  preferred_end   time,                   -- local time, optional
  updated_at      timestamptz not null default now(),
  unique (room_id, identity)
);

alter table public.availability enable row level security;

drop policy if exists availability_rw on public.availability;
create policy availability_rw on public.availability
  for all to anon, authenticated
  using (room_id <> '') with check (room_id <> '');

-- Live updates so the widget refreshes when either person edits their hours.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'availability'
  ) then
    alter publication supabase_realtime add table public.availability;
  end if;
end $$;
