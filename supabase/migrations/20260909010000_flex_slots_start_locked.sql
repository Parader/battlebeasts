-- Flex slots are all essence buys. Slot 1 is no longer free.
alter table public.player_unlocks
  drop constraint if exists player_unlocks_flex_slot_count_range;

alter table public.player_unlocks
  alter column flex_slot_count set default 0;

alter table public.player_unlocks
  add constraint player_unlocks_flex_slot_count_range
  check (flex_slot_count between 0 and 3);

-- The free starter slot was 1. Anyone who only had that grant goes back to 0.
-- Bought slot 2/3 (count >= 2) is left alone.
update public.player_unlocks
  set flex_slot_count = 0
  where flex_slot_count = 1;
