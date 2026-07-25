-- Talent progression: owned points (inventory) + ranked build map.
alter table public.talents
  add column if not exists talent_build jsonb not null default '{}'::jsonb;

comment on column public.talents.talent_build is
  'Catalog talent id → rank invested. Live combat stubs still use talent_ids.';

-- Seed talent_points for existing hunters (starter allocation).
insert into public.inventory (user_id, resource_id, quantity)
select distinct user_id, 'talent_points', 10
from public.inventory
on conflict (user_id, resource_id) do nothing;
