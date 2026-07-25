-- Pattern ink color on profiles.
alter table public.profiles
  add column if not exists pattern_color text not null default '#1f2937';
