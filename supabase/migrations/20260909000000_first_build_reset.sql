-- First-build onboarding: empty loadout, buy-only talent points, wipe all
-- character progression so every hunter chooses their first kit.

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

  insert into public.loadouts (user_id, ability_ids)
  values (new.id, '{}')
  on conflict (user_id) do nothing;

  insert into public.talents (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.player_unlocks (user_id, abilities)
  values (new.id, '{}')
  on conflict (user_id) do nothing;

  insert into public.loadout_presets (user_id, slot_index, name, ability_ids, talent_build, flex_ability_ids)
  values (new.id, 0, 'Loadout 1', '{}', '{}'::jsonb, '{}')
  on conflict do nothing;

  insert into public.inventory (user_id, resource_id, quantity)
  values
    (new.id, 'copper', 0),
    (new.id, 'silver', 1),
    (new.id, 'gold', 0),
    (new.id, 'essence', 0),
    (new.id, 'rubies', 0),
    (new.id, 'talent_points', 0)
  on conflict do nothing;

  return new;
end;
$$;

-- Wipe live accounts to the same first-build slate.
delete from public.ranked_match_players;
delete from public.ranked_matches;
delete from public.season_reward_claims;
delete from public.player_ratings;
delete from public.reward_grants;
delete from public.quest_progress;
delete from public.chests;

update public.inventory
set quantity = case
  when resource_id = 'silver' then 1
  else 0
end
where resource_id in ('copper', 'silver', 'gold', 'essence', 'rubies', 'talent_points', 'beach_ball');

update public.player_unlocks
set
  abilities = '{}',
  cosmetics = '{}',
  colors = '{}',
  patterns = '{}',
  pattern_colors = '{}',
  emotes = '{}',
  loadout_slot_count = 1,
  flex_slot_count = 1,
  emote_slots = '[]'::jsonb,
  updated_at = now();

update public.loadouts
set ability_ids = '{}';

update public.loadout_presets
set
  ability_ids = '{}',
  talent_build = '{}'::jsonb,
  flex_ability_ids = '{}',
  name = case when slot_index = 0 then 'Loadout 1' else name end,
  updated_at = now();

update public.talents
set
  talent_ids = '{}',
  talent_build = '{}'::jsonb;

update public.profiles
set
  intro_completed = false,
  active_loadout_slot = 0,
  color = '#94a3b8',
  pattern = 'plain',
  pattern_color = '#1f2937',
  cosmetics_equipped = '{}'::jsonb,
  updated_at = now();
