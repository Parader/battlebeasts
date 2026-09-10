-- Existing hunters must pick Female / Male once. New claims set this true.
alter table public.profiles
  add column if not exists vessel_confirmed boolean not null default false;
