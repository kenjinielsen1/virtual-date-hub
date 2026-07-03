-- =============================================================================
-- Phase 12 — Shared playlist builder
-- A room-scoped playlist table. Paste into the Supabase SQL editor and run.
-- Safe to re-run.
-- =============================================================================

create table if not exists public.playlist (
  id         uuid primary key default gen_random_uuid(),
  room_id    text not null,
  title      text not null,
  url        text not null,
  note       text,
  added_by   text,                         -- 'me' | 'her'
  created_at timestamptz not null default now()
);
create index if not exists playlist_room_created_idx
  on public.playlist (room_id, created_at);

alter table public.playlist enable row level security;

drop policy if exists playlist_rw on public.playlist;
create policy playlist_rw on public.playlist
  for all to anon, authenticated
  using (room_id <> '') with check (room_id <> '');

-- Stream live inserts/deletes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'playlist'
  ) then
    alter publication supabase_realtime add table public.playlist;
  end if;
end $$;
