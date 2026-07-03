-- =============================================================================
-- Phase 10 — Never Have I Ever
-- Adds a new category of prompts to the existing prompts table. No new infra.
-- Paste into the Supabase SQL editor and run. Safe to re-run.
-- =============================================================================

insert into public.prompts (category, text)
select 'never_have_i_ever', t
from (values
  ('fallen asleep on a call with you'),
  ('reread our old messages'),
  ('cried happy tears because of you'),
  ('fallen asleep thinking about you'),
  ('taken a screenshot of our chat'),
  ('practiced what to say to you'),
  ('gotten a little jealous'),
  ('kept a gift you gave me'),
  ('daydreamed about our future'),
  ('gotten butterflies from your text'),
  ('shown your photo to a friend'),
  ('stayed up way too late talking to you'),
  ('planned a trip to see you in my head'),
  ('put a song on repeat because it reminded me of you'),
  ('smiled at my phone because of you in public'),
  ('imagined our wedding'),
  ('gotten nervous before a call with you'),
  ('memorized your schedule'),
  ('counted down the days to see you'),
  ('saved a photo of you as my wallpaper')
) as s(t)
where not exists (
  select 1 from public.prompts where category = 'never_have_i_ever'
);
