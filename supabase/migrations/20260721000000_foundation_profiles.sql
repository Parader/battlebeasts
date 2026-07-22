-- BattleBeasts foundation schema
-- Apply in Supabase SQL editor or via CLI: supabase db push

create extension if not exists "pgcrypto";

-- Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Hunter',
  avatar_url text,
  color text not null default '#4ade80',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Inventory resources
create table if not exists public.inventory (
  user_id uuid not null references public.profiles (id) on delete cascade,
  resource_id text not null,
  quantity integer not null default 0 check (quantity >= 0),
  primary key (user_id, resource_id)
);

-- Active ability loadout
create table if not exists public.loadouts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  ability_ids text[] not null default array['bolt', 'smash', 'dash']::text[],
  updated_at timestamptz not null default now()
);

-- Selected talents (shallow v0)
create table if not exists public.talents (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  talent_ids text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- Bootstrap profile + defaults on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  preferred_name text;
begin
  preferred_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(new.email, '@', 1),
    'Hunter'
  );

  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    preferred_name,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.loadouts (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.talents (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.inventory (user_id, resource_id, quantity)
  values
    (new.id, 'copper', 0),
    (new.id, 'silver', 0),
    (new.id, 'gold', 0),
    (new.id, 'essence', 0)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.inventory enable row level security;
alter table public.loadouts enable row level security;
alter table public.talents enable row level security;

-- Profiles policies
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_select_friends_later" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Inventory
drop policy if exists "inventory_select_own" on public.inventory;
create policy "inventory_select_own"
  on public.inventory for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "inventory_update_own" on public.inventory;
create policy "inventory_update_own"
  on public.inventory for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "inventory_insert_own" on public.inventory;
create policy "inventory_insert_own"
  on public.inventory for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- Loadouts
drop policy if exists "loadouts_select_own" on public.loadouts;
create policy "loadouts_select_own"
  on public.loadouts for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "loadouts_update_own" on public.loadouts;
create policy "loadouts_update_own"
  on public.loadouts for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "loadouts_insert_own" on public.loadouts;
create policy "loadouts_insert_own"
  on public.loadouts for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- Talents
drop policy if exists "talents_select_own" on public.talents;
create policy "talents_select_own"
  on public.talents for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "talents_update_own" on public.talents;
create policy "talents_update_own"
  on public.talents for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "talents_insert_own" on public.talents;
create policy "talents_insert_own"
  on public.talents for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

grant usage on schema public to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.inventory to authenticated;
grant select, insert, update on public.loadouts to authenticated;
grant select, insert, update on public.talents to authenticated;
