# Auth & RLS Cutover Runbook

Turning off the public room-code join and locking every row and file to
**signed-in room members**, keyed off `auth.uid()`.

- **App:** muslovescutie.vercel.app
- **Migration:** `0014_auth_HOLD_do_not_run_yet.sql` (+ optional `0015_rekey_room_TEMPLATE_do_not_run_yet.sql`)
- **Flag:** `VITE_AUTH_ENABLED` (build-time; a new deploy is required to change it)
- **Expected downtime:** ~5–10 min

> ⚠️ **The lockout window.** The instant you run migration 0014, the public
> anon key can read/write **nothing** — the live app stops working for **both
> of you** until you're each signed in and re-joined. Do Phase A alone first (no
> downtime), then run Phase B with both of you online on a call.

Related files: `src/lib/auth.ts`, `src/components/AuthGate.tsx`, `api/notify.js`.

---

## Phase A — Pre-flight (do alone, any time, no downtime)

Nothing here affects the live app until the flag flips.

- [ ] **Put the 6-digit code into the sign-in email.** Supabase → Authentication
      → Email Templates → **Magic Link**. The default template only sends a
      clickable link, but the app asks people to *type a code* (`verifyOtp`).
      Add the token to the body, e.g. `Your code: {{ .Token }}`. Without this the
      email arrives with no code to type.
- [ ] **Set up real email delivery (custom SMTP).** The built-in Supabase email
      is throttled (a few/hour) and testing-grade — it may silently not deliver
      to Denmark. Add Resend / Postmark / SendGrid under Authentication → Emails
      → SMTP Settings, and **send yourself a test code**. This is the single most
      likely thing to fail on the day.
- [ ] **Set Site URL & redirect allow-list.** Authentication → URL Configuration
      → Site URL = `https://muslovescutie.vercel.app`, and add it to the redirect
      allow-list (covers a clicked magic link).
- [ ] **Copy the `service_role` key.** Project Settings → API → `service_role`
      secret. Needed so `api/notify.js` can keep reading `push_subscriptions`
      once RLS is members-only. **Server-side only — never prefix with `VITE_`.**

### Two decisions to make first

- **Re-key the room code? — recommended: yes.** The current code shipped in the
  public app before auth existed. Migration 0015 moves all your data to a fresh
  random `room_id` so the old join secret is dead. If you do it, you both join
  with the *new* code. (Skipping it is low-risk: `join_room()`'s 2-person cap
  fills once you both join, so a stranger with the old code can't get in.)
- **Restrict sign-ups? — optional.** Sign-up is open (`shouldCreateUser: true`),
  but `join_room()` enforces a hard 2-person cap and unique `me`/`her` spots, so
  no third person can enter your room. Locking sign-ups down is defense-in-depth,
  not required for launch.

---

## Phase B — Cutover (both online, on a call)

Work through B1–B5 back-to-back; the app is down for her between B2 and B5.

- [ ] **B1 · Add the server key to Vercel** *(no downtime yet)*. Settings →
      Environment Variables → `SUPABASE_SERVICE_ROLE_KEY` = value from A4
      (Production). Leave the flag alone for now.
- [ ] **B2 · Run migration 0014 — the lockdown.** SQL Editor → paste
      `0014_auth_HOLD_do_not_run_yet.sql` → Run. Drops every permissive policy,
      adds member-only policies, creates `room_members` + `join_room()`, and
      privatizes the `memories` / `voice-notes` buckets. **⛔ Lockout starts now.**
- [ ] **B3 · (optional) Re-key the room — 0015.** Only if you chose to. First
      generate the new code, then run the fill-in `do $$ … $$` block with your
      old and new codes:

      ```sql
      -- run this, copy the printed room_xxxxx value:
      select 'room_' || replace(gen_random_uuid()::text, '-', '');
      ```

      Storage object paths keep the old room prefix — easiest fix for a small
      library is to re-save those few memories / voice notes after cutover.
- [ ] **B4 · Flip the flag & redeploy.** Vercel → `VITE_AUTH_ENABLED=true`
      (Production) → trigger a redeploy. It's a **build-time** variable, so
      editing the value does nothing until a fresh deploy.
- [ ] **B5 · Both sign in and join — closes the lockout.** Once live, you both
      open the site → email → 6-digit code → sign in. Then each enters the room
      code (new one if re-keyed) and picks a side: **one joins as `me`, the other
      as `her`.** `join_room()` refuses a third person or a taken spot. The moment
      you're both joined, the app is fully back — now members-only.

---

## Phase C — Verify (both signed in)

Don't take the app "looking fine" as proof; check the boundary directly.

- [ ] **C1 · The anon key must see nothing.** After 0014 this should return an
      empty `[]` (RLS denies the rows) where before it returned your messages:

      ```bash
      # reads URL + anon key from .env; expects [] after lockdown
      source .env 2>/dev/null; \
      curl -s "$VITE_SUPABASE_URL/rest/v1/messages?select=id&limit=1" \
        -H "apikey: $VITE_SUPABASE_ANON_KEY" \
        -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
      ```

      Empty `[]` = locked correctly. A returned row means 0014 didn't fully
      apply — stop and check the policy list before trusting it.
- [ ] **C2 · Members still see everything.** In each live app: send a chat both
      ways, open a sealed love note, play a voice note, view a memory photo, and
      confirm the **Good Time** tab loads both availabilities.
- [ ] **C3 · Push + realtime survived.** Send a note that triggers a push and
      confirm it arrives (proves the `service_role` key from B1 is wired).
      Confirm the green "online" presence dot still lights up for each other.
- [ ] **C4 · Third-person & taken-spot rejection** *(optional)*. From a third
      email/incognito, try to join your room → `join_room()` should reject with
      "this room is full"; joining as a taken spot → "that spot is already taken".

---

## If it goes wrong — emergency rollback

Flipping the flag back is **not** enough — the tables have no permissive policies
anymore, so anon still reads nothing. To return to today's state you must restore
the open policies **and** redeploy with the flag off.

```sql
-- 1. Re-open every room table (mirrors the pre-0014 "room_id <> ''" rule)
do $$
declare t text; pol text;
  room_tables text[] := array[
    'messages','notes','answers','milestones','room_state','playlist',
    'bucket_list','voice_notes','reactions','memories','push_subscriptions','availability'];
begin
  foreach t in array room_tables loop
    for pol in select policyname from pg_policies
      where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', pol, t);
    end loop;
    execute format(
      $f$create policy %I on public.%I for all using (room_id <> '') with check (room_id <> '')$f$,
      t||'_open', t);
  end loop;
end $$;

-- 2. Re-open the two private buckets
update storage.buckets set public = true where id in ('memories','voice-notes');
drop policy if exists memories_read on storage.objects;
drop policy if exists memories_write on storage.objects;
drop policy if exists voicenotes_read on storage.objects;
drop policy if exists voicenotes_write on storage.objects;
```

Then set `VITE_AUTH_ENABLED=false` in Vercel and redeploy. You're back to the
room-code app. `room_members` and `join_room()` can stay — harmless while the
flag is off.

---

## Known residual & follow-ups

- **Timeline photos stay public — on purpose.** 0014 deliberately leaves the
  `timeline` bucket public because the Timeline component reads plain public
  URLs. Privatizing it needs a component change (signed URLs) and is a separate
  follow-up. Everything else — memories, voice notes, all tables — is
  members-only after cutover.
- **Realtime authorization (optional hardening).** Broadcast/presence work on the
  anon key today. Locking Realtime channels to authenticated members is a further
  optional step — not required for this cutover.
