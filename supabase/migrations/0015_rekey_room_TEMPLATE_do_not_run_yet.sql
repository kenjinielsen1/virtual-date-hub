-- =============================================================================
-- ⚠️  TEMPLATE — DO NOT RUN AS-IS. Optional (Step 2 decision #3).  ⚠️
-- Re-keys your room's existing rows from the old, already-shipped room code to a
-- fresh random room_id, so the new join secret was never exposed. Preserves all
-- data. Run this AT CUTOVER, after 0014, before you both join — then join with
-- the NEW room_id below.
--
-- Fill in :old_code with your current room code, then this generates a new id.
-- Reactions/answers keep their own room_id column, so they re-key too.
-- =============================================================================

-- 1. Pick the fresh secret (copy the printed value; you'll join with it):
--    select 'room_' || replace(gen_random_uuid()::text, '-', '');

-- 2. With OLD = your current code and NEW = the value from step 1, run:
/*
do $$
declare
  old_code text := 'PUT-YOUR-CURRENT-ROOM-CODE-HERE';
  new_code text := 'PUT-THE-GENERATED-room_xxx-VALUE-HERE';
begin
  update public.messages           set room_id = new_code where room_id = old_code;
  update public.notes              set room_id = new_code where room_id = old_code;
  update public.answers            set room_id = new_code where room_id = old_code;
  update public.milestones         set room_id = new_code where room_id = old_code;
  update public.room_state         set room_id = new_code where room_id = old_code;
  update public.playlist           set room_id = new_code where room_id = old_code;
  update public.bucket_list        set room_id = new_code where room_id = old_code;
  update public.voice_notes        set room_id = new_code where room_id = old_code;
  update public.reactions          set room_id = new_code where room_id = old_code;
  update public.memories           set room_id = new_code where room_id = old_code;
  update public.push_subscriptions set room_id = new_code where room_id = old_code;
  -- Storage object paths ("<room_id>/...") must be moved too — do that from the
  -- app/API with the service role, or re-upload; storage paths can't be renamed
  -- in bulk via SQL. (For a couple's small library, easiest to just re-save.)
end $$;
*/
