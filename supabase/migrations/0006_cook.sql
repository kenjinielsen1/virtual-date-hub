-- =============================================================================
-- Phase 11 — Cook the same meal
-- Adds a jsonb column to room_state to sync the chosen recipe, current step,
-- and step timer. Recipes themselves are hardcoded in the app.
-- Paste into the Supabase SQL editor and run. Safe to re-run.
-- =============================================================================

alter table public.room_state
  add column if not exists cook jsonb;
