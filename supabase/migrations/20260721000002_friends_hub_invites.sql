-- Friends, hub invites, and presence

create table if not exists public.friendships (
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  to_user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_user_id <> to_user_id)
);

create unique index if not exists friend_requests_pending_unique
  on public.friend_requests (least(from_user_id, to_user_id), greatest(from_user_id, to_user_id))
  where status = 'pending';

create table if not exists public.hub_invites (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  to_user_id uuid not null references public.profiles (id) on delete cascade,
  hub_owner_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  check (from_user_id <> to_user_id)
);

create table if not exists public.presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  status text not null default 'offline' check (status in ('online', 'offline')),
  hub_owner_id uuid references public.profiles (id) on delete set null,
  last_seen timestamptz not null default now()
);

alter table public.friendships enable row level security;
alter table public.friend_requests enable row level security;
alter table public.hub_invites enable row level security;
alter table public.presence enable row level security;

-- Friendships: see rows where you are either side
drop policy if exists "friendships_select" on public.friendships;
create policy "friendships_select"
  on public.friendships for select to authenticated
  using ((select auth.uid()) = user_id or (select auth.uid()) = friend_id);

drop policy if exists "friendships_insert" on public.friendships;
create policy "friendships_insert"
  on public.friendships for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "friendships_delete" on public.friendships;
create policy "friendships_delete"
  on public.friendships for delete to authenticated
  using ((select auth.uid()) = user_id or (select auth.uid()) = friend_id);

-- Friend requests
drop policy if exists "friend_requests_select" on public.friend_requests;
create policy "friend_requests_select"
  on public.friend_requests for select to authenticated
  using ((select auth.uid()) = from_user_id or (select auth.uid()) = to_user_id);

drop policy if exists "friend_requests_insert" on public.friend_requests;
create policy "friend_requests_insert"
  on public.friend_requests for insert to authenticated
  with check ((select auth.uid()) = from_user_id);

drop policy if exists "friend_requests_update" on public.friend_requests;
create policy "friend_requests_update"
  on public.friend_requests for update to authenticated
  using ((select auth.uid()) = from_user_id or (select auth.uid()) = to_user_id)
  with check ((select auth.uid()) = from_user_id or (select auth.uid()) = to_user_id);

-- Hub invites
drop policy if exists "hub_invites_select" on public.hub_invites;
create policy "hub_invites_select"
  on public.hub_invites for select to authenticated
  using ((select auth.uid()) = from_user_id or (select auth.uid()) = to_user_id);

drop policy if exists "hub_invites_insert" on public.hub_invites;
create policy "hub_invites_insert"
  on public.hub_invites for insert to authenticated
  with check ((select auth.uid()) = from_user_id);

drop policy if exists "hub_invites_update" on public.hub_invites;
create policy "hub_invites_update"
  on public.hub_invites for update to authenticated
  using ((select auth.uid()) = from_user_id or (select auth.uid()) = to_user_id)
  with check ((select auth.uid()) = from_user_id or (select auth.uid()) = to_user_id);

-- Presence: everyone authenticated can read (for friends UI); write own
drop policy if exists "presence_select" on public.presence;
create policy "presence_select"
  on public.presence for select to authenticated
  using (true);

drop policy if exists "presence_upsert_own" on public.presence;
create policy "presence_insert_own"
  on public.presence for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "presence_update_own" on public.presence;
create policy "presence_update_own"
  on public.presence for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, delete on public.friendships to authenticated;
grant select, insert, update on public.friend_requests to authenticated;
grant select, insert, update on public.hub_invites to authenticated;
grant select, insert, update on public.presence to authenticated;

-- Send friend request by display name
create or replace function public.send_friend_request(target_name text)
returns public.friend_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target uuid;
  existing_friend boolean;
  req public.friend_requests;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select id into target
  from public.profiles
  where lower(display_name) = lower(trim(target_name))
  limit 1;

  if target is null then raise exception 'Player not found'; end if;
  if target = uid then raise exception 'You cannot friend yourself'; end if;

  select exists(
    select 1 from public.friendships f
    where (f.user_id = uid and f.friend_id = target)
       or (f.user_id = target and f.friend_id = uid)
  ) into existing_friend;

  if existing_friend then raise exception 'Already friends'; end if;

  if exists (
    select 1 from public.friend_requests r
    where r.status = 'pending'
      and (
        (r.from_user_id = uid and r.to_user_id = target)
        or (r.from_user_id = target and r.to_user_id = uid)
      )
  ) then
    raise exception 'Friend request already pending';
  end if;

  insert into public.friend_requests (from_user_id, to_user_id)
  values (uid, target)
  returning * into req;

  return req;
end;
$$;

create or replace function public.respond_friend_request(request_id uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  req public.friend_requests;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into req from public.friend_requests where id = request_id;
  if req.id is null then raise exception 'Request not found'; end if;
  if req.to_user_id <> uid then raise exception 'Not your request to answer'; end if;
  if req.status <> 'pending' then raise exception 'Request is not pending'; end if;

  if accept then
    update public.friend_requests
    set status = 'accepted', updated_at = now()
    where id = request_id;

    insert into public.friendships (user_id, friend_id) values (req.from_user_id, req.to_user_id)
    on conflict do nothing;
    insert into public.friendships (user_id, friend_id) values (req.to_user_id, req.from_user_id)
    on conflict do nothing;
  else
    update public.friend_requests
    set status = 'rejected', updated_at = now()
    where id = request_id;
  end if;
end;
$$;

create or replace function public.invite_to_hub(friend_user_id uuid)
returns public.hub_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  invite public.hub_invites;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.friendships f
    where f.user_id = uid and f.friend_id = friend_user_id
  ) then
    raise exception 'Not friends';
  end if;

  -- expire older pending invites between these users
  update public.hub_invites
  set status = 'expired'
  where from_user_id = uid
    and to_user_id = friend_user_id
    and status = 'pending';

  insert into public.hub_invites (from_user_id, to_user_id, hub_owner_id)
  values (uid, friend_user_id, uid)
  returning * into invite;

  return invite;
end;
$$;

create or replace function public.respond_hub_invite(invite_id uuid, accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  invite public.hub_invites;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into invite from public.hub_invites where id = invite_id;
  if invite.id is null then raise exception 'Invite not found'; end if;
  if invite.to_user_id <> uid then raise exception 'Not your invite'; end if;
  if invite.status <> 'pending' then raise exception 'Invite is not pending'; end if;
  if invite.expires_at < now() then
    update public.hub_invites set status = 'expired' where id = invite_id;
    raise exception 'Invite expired';
  end if;

  if accept then
    update public.hub_invites set status = 'accepted' where id = invite_id;
    return invite.hub_owner_id::text;
  else
    update public.hub_invites set status = 'declined' where id = invite_id;
    return null;
  end if;
end;
$$;

create or replace function public.heartbeat_presence(p_hub_owner_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  insert into public.presence (user_id, status, hub_owner_id, last_seen)
  values (uid, 'online', p_hub_owner_id, now())
  on conflict (user_id) do update
  set status = 'online',
      hub_owner_id = excluded.hub_owner_id,
      last_seen = now();
end;
$$;

create or replace function public.set_presence_offline()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  update public.presence
  set status = 'offline', last_seen = now(), hub_owner_id = null
  where user_id = uid;
end;
$$;

revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.invite_to_hub(uuid) from public, anon;
revoke all on function public.respond_hub_invite(uuid, boolean) from public, anon;
revoke all on function public.heartbeat_presence(uuid) from public, anon;
revoke all on function public.set_presence_offline() from public, anon;

grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.invite_to_hub(uuid) to authenticated;
grant execute on function public.respond_hub_invite(uuid, boolean) to authenticated;
grant execute on function public.heartbeat_presence(uuid) to authenticated;
grant execute on function public.set_presence_offline() to authenticated;
