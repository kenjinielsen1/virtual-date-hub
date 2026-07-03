-- =============================================================================
-- Virtual Date Hub — core schema (Phases 1–7)
-- Paste this whole file into the Supabase SQL editor and run it.
-- =============================================================================
--
-- SECURITY MODEL (read this):
-- There is no login. Everyone connects with the public anon key, so RLS cannot
-- tell one person from another. What we CAN do — and what the spec asks for —
-- is enable RLS on every table and only ever touch rows through it, while the
-- app scopes every query by room_id. Privacy therefore rests on the room code
-- being hard to guess (treat it like a shared password), not on the anon key
-- being secret. That is the intended, "don't over-engineer it" trade-off for a
-- two-person app.
--
-- The policies below allow the anon role to read/write, but ONLY for rows that
-- carry a non-empty room_id. The client is responsible for filtering by the
-- specific room_id it is in.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- messages — watch party / general chat
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     text not null,
  sender      text not null,               -- 'me' | 'her'
  sender_name text,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists messages_room_created_idx
  on public.messages (room_id, created_at);

-- ---------------------------------------------------------------------------
-- prompts — seeded trivia / would-you-rather / daily questions
-- Not room-scoped: prompts are shared content everyone draws from. RLS is still
-- enabled but reads are open and writes are closed (seed via this migration).
-- ---------------------------------------------------------------------------
create table if not exists public.prompts (
  id         uuid primary key default gen_random_uuid(),
  category   text not null,                -- 'would_you_rather' | 'how_well' | 'daily'
  text       text not null,
  option_a   text,                         -- for would-you-rather
  option_b   text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- answers — per-person answers to a prompt, hidden until both submit
-- ---------------------------------------------------------------------------
create table if not exists public.answers (
  id         uuid primary key default gen_random_uuid(),
  room_id    text not null,
  prompt_id  uuid references public.prompts(id) on delete cascade,
  -- day_key lets the "daily question jar" key an answer to a calendar day.
  day_key    text,                         -- e.g. '2026-07-01', null for trivia
  sender     text not null,                -- 'me' | 'her'
  body       text not null,
  revealed   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists answers_room_prompt_idx
  on public.answers (room_id, prompt_id);
-- One answer per person per prompt per day.
create unique index if not exists answers_unique_per_person
  on public.answers (room_id, prompt_id, coalesce(day_key, ''), sender);

-- ---------------------------------------------------------------------------
-- notes — love notes, with a read flag
-- ---------------------------------------------------------------------------
create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  room_id    text not null,
  sender     text not null,                -- who wrote it
  body       text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notes_room_created_idx
  on public.notes (room_id, created_at);

-- ---------------------------------------------------------------------------
-- milestones — relationship timeline entries
-- ---------------------------------------------------------------------------
create table if not exists public.milestones (
  id          uuid primary key default gen_random_uuid(),
  room_id     text not null,
  event_date  date not null,
  title       text not null,
  description text,
  photo_url   text,
  created_by  text,                         -- 'me' | 'her'
  created_at  timestamptz not null default now()
);
create index if not exists milestones_room_date_idx
  on public.milestones (room_id, event_date);

-- ---------------------------------------------------------------------------
-- room_state — one row per room: video, playback, trivia scores, etc.
-- ---------------------------------------------------------------------------
create table if not exists public.room_state (
  room_id        text primary key,
  video_url      text,
  playback_state jsonb,                     -- { playing, time, updatedAt }
  scores         jsonb not null default '{"me":0,"her":0}'::jsonb,
  updated_at     timestamptz not null default now()
);

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.messages   enable row level security;
alter table public.prompts    enable row level security;
alter table public.answers    enable row level security;
alter table public.notes      enable row level security;
alter table public.milestones enable row level security;
alter table public.room_state enable row level security;

-- Helper note: policies are split by command so we can keep prompt writes
-- closed. `to anon, authenticated` covers the public key.

-- messages: full CRUD for rows with a room_id
drop policy if exists messages_rw on public.messages;
create policy messages_rw on public.messages
  for all to anon, authenticated
  using (room_id <> '') with check (room_id <> '');

-- answers
drop policy if exists answers_rw on public.answers;
create policy answers_rw on public.answers
  for all to anon, authenticated
  using (room_id <> '') with check (room_id <> '');

-- notes
drop policy if exists notes_rw on public.notes;
create policy notes_rw on public.notes
  for all to anon, authenticated
  using (room_id <> '') with check (room_id <> '');

-- milestones
drop policy if exists milestones_rw on public.milestones;
create policy milestones_rw on public.milestones
  for all to anon, authenticated
  using (room_id <> '') with check (room_id <> '');

-- room_state
drop policy if exists room_state_rw on public.room_state;
create policy room_state_rw on public.room_state
  for all to anon, authenticated
  using (room_id <> '') with check (room_id <> '');

-- prompts: read-only for clients (seeded by migration below)
drop policy if exists prompts_read on public.prompts;
create policy prompts_read on public.prompts
  for select to anon, authenticated
  using (true);

-- =============================================================================
-- Realtime: add room-scoped tables to the supabase_realtime publication so
-- live INSERT/UPDATE streams work (broadcast + presence don't need this, but
-- later phases that subscribe to table changes do). Guarded so re-runs are safe.
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['messages','answers','notes','milestones','room_state']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =============================================================================
-- Seed prompts (idempotent-ish: only inserts if the table is empty)
-- =============================================================================
insert into public.prompts (category, text, option_a, option_b)
select * from (values
  -- ~15 would-you-rather ------------------------------------------------------
  ('would_you_rather', 'Would you rather...', 'Always travel together but never stay home', 'Build the perfect home but rarely travel'),
  ('would_you_rather', 'Would you rather...', 'Have a lazy morning in bed together', 'Have an adventurous day out together'),
  ('would_you_rather', 'Would you rather...', 'Relive our first date', 'Fast-forward to our next reunion'),
  ('would_you_rather', 'Would you rather...', 'Cook dinner together every night', 'Get taken out to dinner every night'),
  ('would_you_rather', 'Would you rather...', 'Live by the beach', 'Live in the mountains'),
  ('would_you_rather', 'Would you rather...', 'Have a movie night in', 'Go dancing out'),
  ('would_you_rather', 'Would you rather...', 'Read the same book together', 'Watch the same show together'),
  ('would_you_rather', 'Would you rather...', 'Take a spontaneous road trip', 'Plan a dream vacation for months'),
  ('would_you_rather', 'Would you rather...', 'Have breakfast in bed', 'Have a midnight snack date'),
  ('would_you_rather', 'Would you rather...', 'Slow dance in the kitchen', 'Sing karaoke together'),
  ('would_you_rather', 'Would you rather...', 'Get matching tattoos', 'Get matching hoodies'),
  ('would_you_rather', 'Would you rather...', 'Have a picnic in a park', 'Have a fancy rooftop dinner'),
  ('would_you_rather', 'Would you rather...', 'Always know what the other is thinking', 'Always be surprised by each other'),
  ('would_you_rather', 'Would you rather...', 'Adopt a puppy together', 'Adopt a kitten together'),
  ('would_you_rather', 'Would you rather...', 'Watch the sunrise together', 'Watch the sunset together'),

  -- ~15 how-well-do-you-know-each-other --------------------------------------
  ('how_well', 'What is my go-to comfort food?', null, null),
  ('how_well', 'What song always reminds me of you?', null, null),
  ('how_well', 'What is my biggest pet peeve?', null, null),
  ('how_well', 'Where would I most want to travel next?', null, null),
  ('how_well', 'What is my favorite way to spend a weekend?', null, null),
  ('how_well', 'What is my coffee or tea order?', null, null),
  ('how_well', 'What movie can I watch over and over?', null, null),
  ('how_well', 'What is my dream job if money did not matter?', null, null),
  ('how_well', 'What little thing always makes me smile?', null, null),
  ('how_well', 'What am I most afraid of?', null, null),
  ('how_well', 'What is my favorite memory of us so far?', null, null),
  ('how_well', 'How do I like to be comforted when I am sad?', null, null),
  ('how_well', 'What is my most-used emoji?', null, null),
  ('how_well', 'What would be my perfect birthday?', null, null),
  ('how_well', 'What is one thing on my bucket list?', null, null),

  -- ~30 daily-question-jar prompts -------------------------------------------
  ('daily', 'What made you smile today?', null, null),
  ('daily', 'What is one thing you are grateful for right now?', null, null),
  ('daily', 'What is a small win you had today?', null, null),
  ('daily', 'What are you most looking forward to this week?', null, null),
  ('daily', 'What is something new you learned recently?', null, null),
  ('daily', 'What is a moment you wish I could have been there for today?', null, null),
  ('daily', 'What is your favorite thing about us?', null, null),
  ('daily', 'If we were together right now, what would you want to do?', null, null),
  ('daily', 'What is a dream you have not told me yet?', null, null),
  ('daily', 'What is your favorite memory of us?', null, null),
  ('daily', 'What made today hard, and how can I support you?', null, null),
  ('daily', 'What is a place you would love to visit with me?', null, null),
  ('daily', 'What song is stuck in your head today?', null, null),
  ('daily', 'What is something you are proud of yourself for?', null, null),
  ('daily', 'What does your ideal lazy day with me look like?', null, null),
  ('daily', 'What is one thing you want to do together this year?', null, null),
  ('daily', 'What made you think of me today?', null, null),
  ('daily', 'What is a tiny habit of mine that you love?', null, null),
  ('daily', 'What is something you want to get better at?', null, null),
  ('daily', 'What is your comfort show or movie lately?', null, null),
  ('daily', 'What would our perfect Sunday look like?', null, null),
  ('daily', 'What is something kind someone did for you recently?', null, null),
  ('daily', 'What is a food you want us to try together?', null, null),
  ('daily', 'What is your favorite thing about this season?', null, null),
  ('daily', 'What is one goal for next month?', null, null),
  ('daily', 'What is a fear you would like to face this year?', null, null),
  ('daily', 'What is something you find beautiful about our relationship?', null, null),
  ('daily', 'If you could relive one day with me, which would it be?', null, null),
  ('daily', 'What is a little thing I do that makes you feel loved?', null, null),
  ('daily', 'What are you excited about for our future?', null, null)
) as seed(category, text, option_a, option_b)
where not exists (select 1 from public.prompts);
