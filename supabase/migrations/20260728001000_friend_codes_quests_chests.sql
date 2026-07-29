-- Friend codes, referrals, quest progress, chests

alter table public.profiles
  add column if not exists friend_code text;

create unique index if not exists profiles_friend_code_uidx
  on public.profiles (friend_code)
  where friend_code is not null;

create table if not exists public.friend_referrals (
  invitee_id uuid primary key references public.profiles (id) on delete cascade,
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (invitee_id <> inviter_id)
);

create index if not exists friend_referrals_inviter_idx
  on public.friend_referrals (inviter_id);

create table if not exists public.quest_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  quest_id text not null,
  period_key text not null,
  progress integer not null default 0 check (progress >= 0),
  completed_at timestamptz,
  primary key (user_id, quest_id, period_key)
);

create table if not exists public.chests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  quality text not null check (quality in ('green', 'blue', 'purple', 'legendary')),
  source text not null,
  status text not null default 'closed' check (status in ('closed', 'opened')),
  result jsonb,
  created_at timestamptz not null default now(),
  opened_at timestamptz
);

create index if not exists chests_user_closed_idx
  on public.chests (user_id)
  where status = 'closed';

alter table public.friend_referrals enable row level security;
alter table public.quest_progress enable row level security;
alter table public.chests enable row level security;

drop policy if exists "friend_referrals_select_own" on public.friend_referrals;
create policy "friend_referrals_select_own"
  on public.friend_referrals for select
  to authenticated
  using ((select auth.uid()) = invitee_id or (select auth.uid()) = inviter_id);

drop policy if exists "quest_progress_select_own" on public.quest_progress;
create policy "quest_progress_select_own"
  on public.quest_progress for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "chests_select_own" on public.chests;
create policy "chests_select_own"
  on public.chests for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Generate / ensure friend code for current user
create or replace function public.ensure_friend_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing text;
  candidate text;
  attempts int := 0;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select friend_code into existing from public.profiles where id = uid;
  if existing is not null and length(existing) > 0 then
    return existing;
  end if;

  loop
    attempts := attempts + 1;
    candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      update public.profiles set friend_code = candidate where id = uid and friend_code is null;
      if found then
        return candidate;
      end if;
      select friend_code into existing from public.profiles where id = uid;
      if existing is not null then
        return existing;
      end if;
    exception when unique_violation then
      null;
    end;
    if attempts > 20 then
      raise exception 'Could not allocate friend code';
    end if;
  end loop;
end;
$$;

-- Redeem a friend code once (creates friendship + referral)
create or replace function public.redeem_friend_code(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cleaned text;
  inviter uuid;
  inviter_name text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  cleaned := upper(trim(code));
  if cleaned is null or length(cleaned) < 4 then
    raise exception 'Invalid friend code';
  end if;

  select id, display_name into inviter, inviter_name
  from public.profiles
  where friend_code = cleaned
  limit 1;

  if inviter is null then
    raise exception 'Friend code not found';
  end if;

  if inviter = uid then
    raise exception 'Cannot redeem your own code';
  end if;

  if exists (select 1 from public.friend_referrals where invitee_id = uid) then
    raise exception 'You already redeemed a friend code';
  end if;

  insert into public.friend_referrals (invitee_id, inviter_id)
  values (uid, inviter);

  insert into public.friendships (user_id, friend_id) values (uid, inviter)
  on conflict do nothing;
  insert into public.friendships (user_id, friend_id) values (inviter, uid)
  on conflict do nothing;

  return jsonb_build_object(
    'ok', true,
    'inviter_id', inviter,
    'inviter_name', inviter_name
  );
end;
$$;

-- Backfill codes for existing profiles
do $$
declare
  r record;
  candidate text;
  attempts int;
begin
  for r in select id from public.profiles where friend_code is null loop
    attempts := 0;
    loop
      attempts := attempts + 1;
      candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      begin
        update public.profiles set friend_code = candidate where id = r.id;
        exit;
      exception when unique_violation then
        null;
      end;
      if attempts > 20 then
        exit;
      end if;
    end loop;
  end loop;
end $$;

-- Also assign on signup (preserve latest bootstrap + friend_code)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_name text;
  candidate text;
  attempts int := 0;
begin
  generated_name := public.random_hunter_name();

  loop
    attempts := attempts + 1;
    candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.profiles (id, display_name, avatar_url, name_confirmed, friend_code)
      values (
        new.id,
        generated_name,
        new.raw_user_meta_data ->> 'avatar_url',
        false,
        candidate
      )
      on conflict (id) do nothing;
      exit;
    exception when unique_violation then
      null;
    end;
    if attempts > 20 then
      insert into public.profiles (id, display_name, avatar_url, name_confirmed)
      values (
        new.id,
        generated_name,
        new.raw_user_meta_data ->> 'avatar_url',
        false
      )
      on conflict (id) do nothing;
      exit;
    end if;
  end loop;

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

revoke all on function public.ensure_friend_code() from public, anon;
revoke all on function public.redeem_friend_code(text) from public, anon;
grant execute on function public.ensure_friend_code() to authenticated;
grant execute on function public.redeem_friend_code(text) to authenticated;
