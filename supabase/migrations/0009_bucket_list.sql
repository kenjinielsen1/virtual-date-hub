-- =============================================================================
-- Phase 14 — Bucket list
-- A room-scoped list of things to do together, checkable off live.
-- Paste into the Supabase SQL editor and run. Safe to re-run.
-- (Photos reuse the "timeline" storage bucket from migration 0003.)
-- =============================================================================

create table if not exists public.bucket_list (
  id         uuid primary key default gen_random_uuid(),
  room_id    text not null,
  item       text not null,
  category   text not null default 'someday', -- 'places' | 'dates' | 'someday'
  done       boolean not null default false,
  photo_url  text,
  added_by   text,                            -- 'me' | 'her'
  created_at timestamptz not null default now()
);
create index if not exists bucket_list_room_created_idx
  on public.bucket_list (room_id, created_at);

alter table public.bucket_list enable row level security;

drop policy if exists bucket_list_rw on public.bucket_list;
create policy bucket_list_rw on public.bucket_list
  for all to anon, authenticated
  using (room_id <> '') with check (room_id <> '');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bucket_list'
  ) then
    alter publication supabase_realtime add table public.bucket_list;
  end if;
end $$;
