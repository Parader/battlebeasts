-- Arena 1v1v1 ranked: allow third side (team c / winner c).

alter table public.ranked_matches
  drop constraint if exists ranked_matches_winner_check;

alter table public.ranked_matches
  add constraint ranked_matches_winner_check
  check (winner in ('a', 'b', 'c', 'draw'));

alter table public.ranked_match_players
  drop constraint if exists ranked_match_players_team_check;

alter table public.ranked_match_players
  add constraint ranked_match_players_team_check
  check (team in ('a', 'b', 'c', ''));
