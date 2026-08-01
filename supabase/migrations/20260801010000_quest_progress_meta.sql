-- Optional JSON metadata for quest progress (e.g. distinct PvP modes played).
alter table public.quest_progress
  add column if not exists meta jsonb not null default '{}'::jsonb;
