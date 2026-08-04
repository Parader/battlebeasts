-- Starter talent points: 1 (was 10 in prior handle_new_user).
-- Idempotent quest chests: unique (user_id, source).
-- Dedupe raced quest chest grants before unique index (keep oldest row).

delete from public.chests c
using (
  select id
  from (
    select id,
      row_number() over (
        partition by user_id, source
        order by created_at asc nulls last, id asc
      ) as rn
    from public.chests
    where source is not null
  ) ranked
  where ranked.rn > 1
) d
where c.id = d.id;

create unique index if not exists chests_user_id_source_uidx
  on public.chests (user_id, source)
  where source is not null;

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
    (new.id, 'talent_points', 1)
  on conflict do nothing;

  return new;
end;
$$;
