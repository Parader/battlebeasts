-- Monthly display-name rename cooldown

alter table public.profiles
  add column if not exists name_changed_at timestamptz;

-- Confirmed names start their cooldown from last profile update (or now).
update public.profiles
set name_changed_at = coalesce(updated_at, now())
where name_confirmed = true
  and name_changed_at is null;

create or replace function public.claim_display_name(desired_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cleaned text;
  current_row public.profiles;
  updated_row public.profiles;
  cooldown_until timestamptz;
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

  select * into current_row
  from public.profiles
  where id = uid;

  if current_row.id is null then
    raise exception 'Profile not found';
  end if;

  -- Same name (case-insensitive): confirm if needed, otherwise no-op.
  if lower(current_row.display_name) = lower(cleaned) then
    if current_row.name_confirmed then
      return current_row;
    end if;

    update public.profiles
    set
      name_confirmed = true,
      name_changed_at = coalesce(name_changed_at, now()),
      updated_at = now()
    where id = uid
    returning * into updated_row;

    return updated_row;
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(p.display_name) = lower(cleaned)
      and p.id <> uid
  ) then
    raise exception 'Name is already taken';
  end if;

  -- Renames after first claim are limited to once per 30 days.
  if current_row.name_confirmed then
    if current_row.name_changed_at is not null
       and current_row.name_changed_at > now() - interval '30 days' then
      cooldown_until := current_row.name_changed_at + interval '30 days';
      raise exception 'You can rename again on %', to_char(cooldown_until at time zone 'utc', 'YYYY-MM-DD');
    end if;
  end if;

  update public.profiles
  set
    display_name = cleaned,
    name_confirmed = true,
    name_changed_at = now(),
    updated_at = now()
  where id = uid
  returning * into updated_row;

  if updated_row.id is null then
    raise exception 'Profile not found';
  end if;

  return updated_row;
end;
$$;

revoke all on function public.claim_display_name(text) from public, anon;
grant execute on function public.claim_display_name(text) to authenticated;
