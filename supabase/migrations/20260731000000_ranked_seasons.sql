-- Ranked seasons, ratings, match history, season reward claims

create table if not exists public.ranked_seasons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'active'
    check (status in ('upcoming', 'active', 'ended')),
  soft_reset_factor numeric not null default 0.5,
  reward_catalog jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists ranked_seasons_one_active_uidx
  on public.ranked_seasons (status)
  where status = 'active';

create table if not exists public.player_ratings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  season_id uuid not null references public.ranked_seasons (id) on delete cascade,
  mmr integer not null default 1000,
  lp integer not null default 0,
  tier text not null default 'bronze'
    check (tier in ('bronze', 'silver', 'gold', 'diamond', 'champion', 'master', 'grandmaster')),
  division integer not null default 3 check (division >= 0 and division <= 3),
  wins integer not null default 0,
  losses integer not null default 0,
  placement_remaining integer not null default 5,
  peak_tier text not null default 'bronze'
    check (peak_tier in ('bronze', 'silver', 'gold', 'diamond', 'champion', 'master', 'grandmaster')),
  career_peak_tier text not null default 'bronze'
    check (career_peak_tier in ('bronze', 'silver', 'gold', 'diamond', 'champion', 'master', 'grandmaster')),
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id)
);

create index if not exists player_ratings_season_mmr_idx
  on public.player_ratings (season_id, mmr desc);

create index if not exists player_ratings_season_ladder_idx
  on public.player_ratings (season_id, tier, division, lp desc);

create table if not exists public.ranked_matches (
  match_id text primary key,
  season_id uuid references public.ranked_seasons (id) on delete set null,
  mode text not null,
  kind text not null check (kind in ('ranked', 'custom')),
  winner text not null check (winner in ('a', 'b', 'draw')),
  ended_at timestamptz not null default now()
);

create table if not exists public.ranked_match_players (
  match_id text not null references public.ranked_matches (match_id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  team text not null check (team in ('a', 'b', '')),
  won boolean,
  mmr_before integer,
  mmr_after integer,
  mmr_delta integer,
  lp_before integer,
  lp_after integer,
  lp_delta integer,
  tier_before text,
  tier_after text,
  division_before integer,
  division_after integer,
  primary key (match_id, user_id)
);

create table if not exists public.season_reward_claims (
  user_id uuid not null references public.profiles (id) on delete cascade,
  season_id uuid not null references public.ranked_seasons (id) on delete cascade,
  reward_key text not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, season_id, reward_key)
);

alter table public.ranked_seasons enable row level security;
alter table public.player_ratings enable row level security;
alter table public.ranked_matches enable row level security;
alter table public.ranked_match_players enable row level security;
alter table public.season_reward_claims enable row level security;

drop policy if exists "ranked_seasons_select_all" on public.ranked_seasons;
create policy "ranked_seasons_select_all"
  on public.ranked_seasons for select
  to authenticated
  using (true);

drop policy if exists "player_ratings_select_all" on public.player_ratings;
create policy "player_ratings_select_all"
  on public.player_ratings for select
  to authenticated
  using (true);

drop policy if exists "ranked_matches_select_all" on public.ranked_matches;
create policy "ranked_matches_select_all"
  on public.ranked_matches for select
  to authenticated
  using (true);

drop policy if exists "ranked_match_players_select_all" on public.ranked_match_players;
create policy "ranked_match_players_select_all"
  on public.ranked_match_players for select
  to authenticated
  using (true);

drop policy if exists "season_reward_claims_select_own" on public.season_reward_claims;
create policy "season_reward_claims_select_own"
  on public.season_reward_claims for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Seed first season if none exists
insert into public.ranked_seasons (slug, starts_at, status)
select 'season-1', now(), 'active'
where not exists (select 1 from public.ranked_seasons where status = 'active');
