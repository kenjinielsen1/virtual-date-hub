-- =============================================================================
-- Phase 13 — Visit countdown
-- Stores the next in-person visit date on room_state so you both see the same
-- countdown. Paste into the Supabase SQL editor and run. Safe to re-run.
-- =============================================================================

alter table public.room_state
  add column if not exists visit_date text; -- 'YYYY-MM-DD'
