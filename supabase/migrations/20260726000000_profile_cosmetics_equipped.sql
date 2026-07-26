-- Equipped wearable cosmetics (hat / shoulders / chest / gloves / belt / legs / shoes → catalog ids).
alter table public.profiles
  add column if not exists cosmetics_equipped jsonb not null default '{}'::jsonb;
