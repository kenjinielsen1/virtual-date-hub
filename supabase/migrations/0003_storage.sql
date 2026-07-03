-- =============================================================================
-- Phase 6 — relationship timeline photo storage
-- Creates a public "timeline" storage bucket and lets the anon key upload to it.
-- Paste into the Supabase SQL editor and run. Safe to run more than once.
-- =============================================================================

-- Public bucket: uploaded photos are readable via their public URL (which we
-- store in milestones.photo_url). Writes are still gated by the policy below.
insert into storage.buckets (id, name, public)
values ('timeline', 'timeline', true)
on conflict (id) do nothing;

-- No login here, so allow the anon (public) key full access to THIS bucket only.
-- Same trade-off as the rest of the app: privacy rests on the room code.
drop policy if exists timeline_objects_rw on storage.objects;
create policy timeline_objects_rw on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'timeline')
  with check (bucket_id = 'timeline');
