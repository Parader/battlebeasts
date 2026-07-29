-- Economy wipe + durable reward ledger (PvP loot, admin grants, chests later).

-- One-shot: reset soft currency for all accounts. Unlocks/talents unchanged.
update public.inventory
set quantity = 0
where resource_id in ('copper', 'silver', 'gold', 'essence');

create table if not exists public.reward_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source text not null,
  source_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'claimed')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  unique (user_id, source, source_key)
);

create index if not exists reward_grants_pending_user_idx
  on public.reward_grants (user_id)
  where status = 'pending';

alter table public.reward_grants enable row level security;

-- Players can read their own grants; writes go through the game server (service role).
drop policy if exists "reward_grants_select_own" on public.reward_grants;
create policy "reward_grants_select_own"
  on public.reward_grants for select
  to authenticated
  using ((select auth.uid()) = user_id);
