-- =============================================================================
-- ⚠️  DO NOT RUN THIS YET.  ⚠️
-- Running this makes the app REQUIRE login. It drops every permissive policy and
-- replaces them with membership checks keyed off auth.uid(). Until the auth UI
-- is switched on (VITE_AUTH_ENABLED=true) AND both people have signed in and
-- joined the room, this will lock EVERYONE (including her) out of all data.
--
-- Run it ONLY during the planned cutover, with both people available. This file
-- is the Step 4 (policies) + Step 5 (storage) implementation, prepared in
-- advance per the approved Step 2 design.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Membership: who belongs to which room, as which identity.
-- ---------------------------------------------------------------------------
create table if not exists public.room_members (
  user_id  uuid not null references auth.users(id) on delete cascade,
  room_id  text not null,
  identity text not null check (identity in ('me','her')),
  created_at timestamptz not null default now(),
  primary key (user_id, room_id)
);
create unique index if not exists room_members_room_identity_uniq
  on public.room_members (room_id, identity);

alter table public.room_members enable row level security;

-- SECURITY DEFINER so content policies check membership WITHOUT recursing into
-- room_members' own RLS (the classic infinite-recursion trap). search_path is
-- pinned per security best practice.
create or replace function public.is_room_member(p_room_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

-- room_members policies (use the definer fn, so no recursion):
drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members
  for select to authenticated
  using (is_room_member(room_id)); -- a member can see the room's roster

-- Joining is done via join_room() only; no direct client insert/update/delete.

-- Join RPC: enforces the 2-person cap and identity uniqueness server-side.
-- Once a room has 2 members it is FULL — the code can never be used again.
create or replace function public.join_room(p_room_id text, p_identity text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_identity not in ('me','her') then
    raise exception 'identity must be me or her';
  end if;
  if coalesce(p_room_id,'') = '' then
    raise exception 'room code required';
  end if;
  -- already a member? make it idempotent.
  if exists (select 1 from room_members where room_id = p_room_id and user_id = auth.uid()) then
    return;
  end if;
  if (select count(*) from room_members where room_id = p_room_id) >= 2 then
    raise exception 'this room is full';
  end if;
  if exists (select 1 from room_members where room_id = p_room_id and identity = p_identity) then
    raise exception 'that spot (%) is already taken in this room', p_identity;
  end if;
  insert into room_members (user_id, room_id, identity)
  values (auth.uid(), p_room_id, p_identity);
end;
$$;

-- ---------------------------------------------------------------------------
-- Content tables: drop ALL existing (permissive) policies, then add member-
-- only per-verb policies. anon gets nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  t   text;
  pol text;
  room_tables text[] := array[
    'messages','notes','answers','milestones','room_state','playlist',
    'bucket_list','voice_notes','reactions','memories','push_subscriptions'
  ];
begin
  foreach t in array room_tables loop
    execute format('alter table public.%I enable row level security', t);
    -- nuke every existing policy on the table (names vary across migrations)
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', pol, t);
    end loop;
    -- member-only, per verb, keyed off auth.uid() via the definer function
    execute format($f$create policy %I on public.%I for select to authenticated using (is_room_member(room_id))$f$, t||'_sel', t);
    execute format($f$create policy %I on public.%I for insert to authenticated with check (is_room_member(room_id))$f$, t||'_ins', t);
    execute format($f$create policy %I on public.%I for update to authenticated using (is_room_member(room_id)) with check (is_room_member(room_id))$f$, t||'_upd', t);
    execute format($f$create policy %I on public.%I for delete to authenticated using (is_room_member(room_id))$f$, t||'_del', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Shared, non-private reference content (game questions). The ONE deliberate
-- read-all: these hold no private data and are only readable once logged in.
-- Client writes stay closed (seeded via migrations).
-- ---------------------------------------------------------------------------
do $$
declare t text; pol text;
begin
  foreach t in array array['prompts','pictionary_words'] loop
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', pol, t);
    end loop;
    execute format($f$create policy %I on public.%I for select to authenticated using (true)$f$, t||'_read', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- STORAGE (Step 5): lock the private buckets to room members. Objects live at
-- "<room_id>/...", so foldername[1] is the room_id.
-- NOTE: 'timeline' is intentionally NOT included here — it stores PUBLIC photo
-- URLs the Timeline component reads directly; privatizing it needs a component
-- change (signed URLs) and is tracked as a separate follow-up.
-- ---------------------------------------------------------------------------
update storage.buckets set public = false where id in ('memories','voice-notes');

do $$
declare b text; pol text;
begin
  foreach b in array array['memories','voice-notes'] loop
    -- drop existing object policies for this bucket
    for pol in
      select policyname from pg_policies
      where schemaname='storage' and tablename='objects'
        and qual like '%'||b||'%'
    loop
      execute format('drop policy %I on storage.objects', pol);
    end loop;
  end loop;
end $$;

create policy memories_read on storage.objects
  for select to authenticated
  using (bucket_id = 'memories' and is_room_member((storage.foldername(name))[1]));
create policy memories_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'memories' and is_room_member((storage.foldername(name))[1]));

create policy voicenotes_read on storage.objects
  for select to authenticated
  using (bucket_id = 'voice-notes' and is_room_member((storage.foldername(name))[1]));
create policy voicenotes_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'voice-notes' and is_room_member((storage.foldername(name))[1]));

-- =============================================================================
-- End. After running this, only signed-in members of a room can see or touch
-- that room's data; the public anon key can read/write nothing.
-- =============================================================================
