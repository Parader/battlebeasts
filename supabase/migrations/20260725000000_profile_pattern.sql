-- Creature hide pattern on profiles (full-body cosmetic).
alter table public.profiles
  add column if not exists pattern text not null default 'plain';
