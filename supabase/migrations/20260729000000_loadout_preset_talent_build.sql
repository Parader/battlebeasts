-- Each loadout preset is a spells + talents combination.
alter table public.loadout_presets
  add column if not exists talent_build jsonb not null default '{}'::jsonb;

comment on column public.loadout_presets.talent_build is
  'Catalog talent ranks for this loadout preset (TalentBuild jsonb).';

-- Seed existing presets from the account-level talent build so switching slots
-- does not wipe invested trees for players who already have a build.
update public.loadout_presets lp
set talent_build = coalesce(t.talent_build, '{}'::jsonb)
from public.talents t
where t.user_id = lp.user_id
  and (lp.talent_build is null or lp.talent_build = '{}'::jsonb)
  and t.talent_build is not null
  and t.talent_build <> '{}'::jsonb;
