-- Account-level creature appearance (hide pattern + ink color).
-- Applied remotely via Supabase; kept here for local/CLI parity.
alter table public.profiles
  add column if not exists pattern text not null default 'plain';

alter table public.profiles
  add column if not exists pattern_color text not null default '#1f2937';
