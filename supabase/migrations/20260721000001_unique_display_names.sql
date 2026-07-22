-- Unique display names + first-login claim flow

alter table public.profiles
  add column if not exists name_confirmed boolean not null default false;

-- Case-insensitive uniqueness
create unique index if not exists profiles_display_name_unique_ci
  on public.profiles (lower(display_name));

create or replace function public.random_hunter_name()
returns text
language plpgsql
as $$
declare
  candidate text;
  attempts int := 0;
begin
  loop
    attempts := attempts + 1;
    candidate := 'Hunter_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    exit when not exists (
      select 1 from public.profiles p where lower(p.display_name) = lower(candidate)
    );
    if attempts > 20 then
      candidate := 'Hunter_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
      exit;
    end if;
  end loop;
  return candidate;
end;
$$;

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

-- Claim / set unique display name (first login or rename later)
create or replace function public.claim_display_name(desired_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cleaned text;
  updated_row public.profiles;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  cleaned := trim(desired_name);

  if cleaned is null or length(cleaned) < 3 or length(cleaned) > 20 then
    raise exception 'Name must be 3–20 characters';
  end if;

  if cleaned !~ '^[A-Za-z0-9_]+$' then
    raise exception 'Name may only contain letters, numbers, and underscores';
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(p.display_name) = lower(cleaned)
      and p.id <> uid
  ) then
    raise exception 'Name is already taken';
  end if;

  update public.profiles
  set
    display_name = cleaned,
    name_confirmed = true,
    updated_at = now()
  where id = uid
  returning * into updated_row;

  if updated_row.id is null then
    raise exception 'Profile not found';
  end if;

  return updated_row;
end;
$$;

revoke all on function public.claim_display_name(text) from public;
grant execute on function public.claim_display_name(text) to authenticated;

-- Existing rows: keep current names unique if possible; leave name_confirmed false so they pick
-- If duplicates already exist, append suffix so unique index can be created safely was handled above
-- after backfill. For fresh installs this is a no-op.

do $$
declare
  r record;
  new_name text;
begin
  for r in
    select id, display_name
    from public.profiles
    where id in (
      select id from (
        select id, row_number() over (partition by lower(display_name) order by created_at) as rn
        from public.profiles
      ) d
      where rn > 1
    )
  loop
    new_name := public.random_hunter_name();
    update public.profiles set display_name = new_name where id = r.id;
  end loop;
end $$;
