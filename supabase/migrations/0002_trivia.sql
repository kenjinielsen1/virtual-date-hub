-- =============================================================================
-- Phase 4 — couples trivia
-- Adds the current shared question to room_state so both players see the same
-- prompt and it survives a refresh. Safe to run more than once.
-- Paste into the Supabase SQL editor and run.
-- =============================================================================

alter table public.room_state
  add column if not exists trivia_prompt_id uuid references public.prompts(id);
