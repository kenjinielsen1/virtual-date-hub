-- =============================================================================
-- Phase 9: voice notes + reactions (streaks need no schema — computed from
-- existing answers). Paste into the Supabase SQL editor and run. Re-run safe.
-- =============================================================================

-- ---- Voice notes ------------------------------------------------------------
create table if not exists public.voice_notes (
  id               uuid primary key default gen_random_uuid(),
  room_id          text not null,
  sender           text not null,            -- 'me' | 'her'
  audio_url        text not null,            -- storage PATH (signed on read)
  duration_seconds numeric,
  played           boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists voice_notes_room_created_idx
  on public.voice_notes (room_id, created_at desc);

alter table public.voice_notes enable row level security;
drop policy if exists voice_notes_rw on public.voice_notes;
create policy voice_notes_rw on public.voice_notes
  for all to anon, authenticated
  using (room_id <> '') with check (room_id <> '');

-- PRIVATE bucket: raw public URLs 404; audio is served via short-lived signed
-- URLs only (spec gotcha). The policy lets the anon key upload and sign reads.
insert into storage.buckets (id, name, public)
values ('voice-notes', 'voice-notes', false)
on conflict (id) do nothing;

drop policy if exists voice_notes_objects_rw on storage.objects;
create policy voice_notes_objects_rw on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'voice-notes')
  with check (bucket_id = 'voice-notes');

-- ---- Reactions (one table for every content type) ---------------------------
create table if not exists public.reactions (
  id          uuid primary key default gen_random_uuid(),
  room_id     text not null,
  target_type text not null,                 -- 'note' | 'answer' | 'drawing' | 'voice_note'
  target_id   uuid not null,
  emoji       text not null,
  reacted_by  text not null,                 -- 'me' | 'her'
  created_at  timestamptz not null default now()
);
create index if not exists reactions_room_target_idx
  on public.reactions (room_id, target_type, target_id);
-- One person can't stack the same emoji twice on one item (toggle handles UX;
-- this makes the guarantee hard).
create unique index if not exists reactions_unique_per_person
  on public.reactions (room_id, target_type, target_id, emoji, reacted_by);

alter table public.reactions enable row level security;
drop policy if exists reactions_rw on public.reactions;
create policy reactions_rw on public.reactions
  for all to anon, authenticated
  using (room_id <> '') with check (room_id <> '');
