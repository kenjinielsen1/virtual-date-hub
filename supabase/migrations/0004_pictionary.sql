-- =============================================================================
-- Phase 9 — Pictionary
-- A words table (read-only for clients) + a jsonb game-state column on
-- room_state. Paste into the Supabase SQL editor and run. Safe to re-run.
-- =============================================================================

create table if not exists public.pictionary_words (
  id   uuid primary key default gen_random_uuid(),
  word text not null
);

alter table public.pictionary_words enable row level security;

drop policy if exists pictionary_words_read on public.pictionary_words;
create policy pictionary_words_read on public.pictionary_words
  for select to anon, authenticated using (true);

-- Live game state (drawer, secret word, timer start, scores, ...).
alter table public.room_state
  add column if not exists pictionary jsonb;

-- Seed drawable, couple-friendly words (only if empty).
insert into public.pictionary_words (word)
select * from (values
  ('cat'), ('dog'), ('house'), ('sun'), ('moon'), ('star'), ('tree'),
  ('flower'), ('heart'), ('pizza'), ('cake'), ('coffee'), ('car'), ('boat'),
  ('airplane'), ('rainbow'), ('beach'), ('mountain'), ('book'), ('guitar'),
  ('balloon'), ('ice cream'), ('snowman'), ('umbrella'), ('fish'),
  ('butterfly'), ('rocket'), ('robot'), ('ghost'), ('crown'), ('camera'),
  ('clock'), ('key'), ('gift'), ('cloud'), ('rain'), ('kite'), ('apple'),
  ('banana'), ('hat'), ('glasses'), ('ring'), ('dolphin'), ('penguin'),
  ('cactus'), ('candle'), ('bridge'), ('train'), ('sandwich'), ('donut')
) as w(word)
where not exists (select 1 from public.pictionary_words);
