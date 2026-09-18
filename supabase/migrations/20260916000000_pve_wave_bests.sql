-- Personal-best Wave Assault runs for the hub PVE leaderboard.

create table if not exists public.pve_wave_bests (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  best_wave integer not null default 0 check (best_wave >= 0),
  best_kills integer not null default 0 check (best_kills >= 0),
  damage_dealt integer not null default 0 check (damage_dealt >= 0),
  party_size integer not null default 1 check (party_size >= 1 and party_size <= 4),
  updated_at timestamptz not null default now()
);

create index if not exists pve_wave_bests_ladder_idx
  on public.pve_wave_bests (best_wave desc, best_kills desc, damage_dealt desc, updated_at asc);

alter table public.pve_wave_bests enable row level security;

drop policy if exists "pve_wave_bests_select_all" on public.pve_wave_bests;
create policy "pve_wave_bests_select_all"
  on public.pve_wave_bests for select
  to authenticated
  using (true);
