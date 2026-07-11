-- =============================================================================
-- Per-weekday preferred hours for "Good time to call".
-- Paste into the Supabase SQL editor and run. Additive & safe to re-run.
--
-- preferred_by_day: JSON keyed by weekday "0".."6" (0=Sunday). Each present key
-- is [start,end] local times, e.g. {"1":["18:00","22:00"],"6":["14:00","20:00"]}.
-- A missing weekday = no preferred window that day. When this column is null the
-- app falls back to the single preferred_start/preferred_end ("same every day").
-- =============================================================================

alter table public.availability
  add column if not exists preferred_by_day jsonb;
