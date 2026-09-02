-- Flex slots: a second category of spell, cast with 1/2/3 and paid for in Energy.
--
-- Picks live on the preset rather than the account: a preset is a whole build,
-- and swapping to one that kept its old flex picks would be a build that only
-- half-changed.
alter table public.loadout_presets
  add column if not exists flex_ability_ids text[] not null default '{}';

comment on column public.loadout_presets.flex_ability_ids is
  'Positional flex picks (keys 1-3). Empty string marks an unused slot, so index survives gaps.';

-- Slot 1 is free; 2 and 3 are bought with essence.
alter table public.player_unlocks
  add column if not exists flex_slot_count integer not null default 1;

alter table public.player_unlocks
  add constraint player_unlocks_flex_slot_count_range
  check (flex_slot_count between 1 and 3);
