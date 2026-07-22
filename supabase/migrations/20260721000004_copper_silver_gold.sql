-- Copper / silver / gold metal currencies + essence (magical)
-- Migrates legacy scrap → copper

insert into public.inventory (user_id, resource_id, quantity)
select user_id, 'copper', quantity
from public.inventory
where resource_id = 'scrap'
on conflict (user_id, resource_id) do update
set quantity = public.inventory.quantity + excluded.quantity;

delete from public.inventory where resource_id = 'scrap';

insert into public.inventory (user_id, resource_id, quantity)
select p.id, r.resource_id, 0
from public.profiles p
cross join (values ('copper'), ('silver'), ('gold'), ('essence')) as r(resource_id)
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
