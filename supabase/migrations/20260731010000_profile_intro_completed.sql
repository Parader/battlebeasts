-- Hub intro cinematic completion flag (first-join story).
alter table public.profiles
  add column if not exists intro_completed boolean not null default false;
