-- =============================================================================
-- Memories / look-back — Step 1: schema + storage bucket
-- One table for all memory kinds; files live in Storage, only URLs in rows.
-- Paste into the Supabase SQL editor and run. Safe to re-run.
--
-- RLS NOTE: this replicates the project's existing pattern (no auth; the anon
-- key may touch only rows with a non-empty room_id; room isolation is enforced
-- by the app scoping every query with .eq('room_id', ...); privacy rests on
-- the room code). The spec's current_setting() example doesn't apply here
-- because there is no per-session auth to hang it on.
-- =============================================================================

create table if not exists public.memories (
  id         uuid primary key default gen_random_uuid(),
  room_id    text not null,
  kind       text not null,            -- 'drawing' | 'game' | 'answer' | 'note'
  title      text,
  image_url  text,                     -- for drawings
  data       jsonb,                    -- scores, answer text, metadata, ...
  created_by text,                     -- 'me' | 'her'
  created_at timestamptz not null default now()
);
create index if not exists memories_room_created_idx
  on public.memories (room_id, created_at desc);
create index if not exists memories_room_kind_idx
  on public.memories (room_id, kind);

alter table public.memories enable row level security;

drop policy if exists memories_rw on public.memories;
create policy memories_rw on public.memories
  for all to anon, authenticated
  using (room_id <> '') with check (room_id <> '');

-- Live inserts stream to the partner.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'memories'
  ) then
    alter publication supabase_realtime add table public.memories;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Storage bucket for drawing PNGs. Matches the existing "timeline" bucket
-- pattern: public bucket + unguessable UUID paths (no auth exists to scope
-- storage by room). Writes are gated to this bucket only.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('memories', 'memories', true)
on conflict (id) do nothing;

drop policy if exists memories_objects_rw on storage.objects;
create policy memories_objects_rw on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'memories')
  with check (bucket_id = 'memories');
