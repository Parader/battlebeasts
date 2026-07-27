-- Rubies wallet + player unlocks + loadout presets (shop / lean starters)

-- Backfill rubies for existing accounts
insert into public.inventory (user_id, resource_id, quantity)
select p.id, 'rubies', 0
from public.profiles p
on conflict do nothing;

create table if not exists public.player_unlocks (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  cosmetics text[] not null default '{}',
  colors text[] not null default '{}',
  patterns text[] not null default '{}',
  pattern_colors text[] not null default '{}',
  emotes text[] not null default '{}',
  abilities text[] not null default '{}',
  loadout_slot_count integer not null default 1 check (loadout_slot_count >= 1 and loadout_slot_count <= 5),
  emote_slots jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.loadout_presets (
  user_id uuid not null references public.profiles (id) on delete cascade,
  slot_index integer not null check (slot_index >= 0 and slot_index < 5),
  name text not null default 'Loadout',
  ability_ids text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, slot_index)
);

alter table public.profiles
  add column if not exists active_loadout_slot integer not null default 0;

-- Seed unlock rows for existing profiles (starters applied in app layer on load)
insert into public.player_unlocks (user_id)
select p.id from public.profiles p
on conflict do nothing;

-- Seed preset 0 from existing loadouts when present
insert into public.loadout_presets (user_id, slot_index, name, ability_ids)
select l.user_id, 0, 'Loadout 1', coalesce(l.ability_ids, '{}')
from public.loadouts l
on conflict do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_name text;
begin
  generated_name := public.random_hunter_name();

  insert into public.profiles (id, display_name, avatar_url, name_confirmed)
  values (
    new.id,
    generated_name,
    new.raw_user_meta_data ->> 'avatar_url',
    false
  )
  on conflict (id) do nothing;

  insert into public.loadouts (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.talents (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.player_unlocks (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.loadout_presets (user_id, slot_index, name)
  values (new.id, 0, 'Loadout 1')
  on conflict do nothing;

  insert into public.inventory (user_id, resource_id, quantity)
  values
    (new.id, 'copper', 0),
    (new.id, 'silver', 0),
    (new.id, 'gold', 0),
    (new.id, 'essence', 0),
    (new.id, 'rubies', 0),
    (new.id, 'talent_points', 10)
  on conflict do nothing;

  return new;
end;
$$;

-- RLS (service role bypasses; authenticated own-row access)
alter table public.player_unlocks enable row level security;
alter table public.loadout_presets enable row level security;

drop policy if exists "player_unlocks_select_own" on public.player_unlocks;
create policy "player_unlocks_select_own"
  on public.player_unlocks for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "player_unlocks_update_own" on public.player_unlocks;
create policy "player_unlocks_update_own"
  on public.player_unlocks for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "player_unlocks_insert_own" on public.player_unlocks;
create policy "player_unlocks_insert_own"
  on public.player_unlocks for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "loadout_presets_select_own" on public.loadout_presets;
create policy "loadout_presets_select_own"
  on public.loadout_presets for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "loadout_presets_update_own" on public.loadout_presets;
create policy "loadout_presets_update_own"
  on public.loadout_presets for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "loadout_presets_insert_own" on public.loadout_presets;
create policy "loadout_presets_insert_own"
  on public.loadout_presets for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.player_unlocks to authenticated;
grant select, insert, update on public.loadout_presets to authenticated;
grant all on public.player_unlocks to service_role;
grant all on public.loadout_presets to service_role;
