-- =============================================================================
-- Push notifications — stores each device's Web Push subscription.
-- Paste into the Supabase SQL editor and run. Safe to re-run.
-- =============================================================================

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  room_id      text not null,
  identity     text not null,          -- 'me' | 'her'
  endpoint     text not null unique,   -- unique per device/browser
  subscription jsonb not null,         -- full PushSubscription JSON
  created_at   timestamptz not null default now()
);
create index if not exists push_subscriptions_room_idx
  on public.push_subscriptions (room_id, identity);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_rw on public.push_subscriptions;
create policy push_subscriptions_rw on public.push_subscriptions
  for all to anon, authenticated
  using (room_id <> '') with check (room_id <> '');
