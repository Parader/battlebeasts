-- Wave Assault ladder keyed by party (sorted member ids), not individuals.

create table if not exists public.pve_wave_team_bests (
  party_key text primary key,
  member_ids uuid[] not null,
  display_names text[] not null default '{}',
  best_wave integer not null default 0 check (best_wave >= 0),
  best_kills integer not null default 0 check (best_kills >= 0),
  damage_dealt integer not null default 0 check (damage_dealt >= 0),
  party_size integer not null default 1 check (party_size >= 1 and party_size <= 4),
  updated_at timestamptz not null default now()
);

create index if not exists pve_wave_team_bests_ladder_idx
  on public.pve_wave_team_bests (best_wave desc, best_kills desc, damage_dealt desc, updated_at asc);

create index if not exists pve_wave_team_bests_members_idx
  on public.pve_wave_team_bests using gin (member_ids);

alter table public.pve_wave_team_bests enable row level security;

drop policy if exists "pve_wave_team_bests_select_all" on public.pve_wave_team_bests;
create policy "pve_wave_team_bests_select_all"
  on public.pve_wave_team_bests for select
  to authenticated
  using (true);

-- Keep existing personal-best rows as solo/party entries on the team board.
insert into public.pve_wave_team_bests (
  party_key, member_ids, display_names, best_wave, best_kills, damage_dealt, party_size, updated_at
)
select
  b.user_id::text,
  array[b.user_id],
  array[coalesce(nullif(trim(p.display_name), ''), 'Hunter')],
  b.best_wave,
  b.best_kills,
  b.damage_dealt,
  b.party_size,
  b.updated_at
from public.pve_wave_bests b
left join public.profiles p on p.id = b.user_id
where b.best_wave > 0
on conflict (party_key) do nothing;
