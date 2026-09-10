-- Playable Mixamo vessel on profiles (`female` = hero, `male` = Y Bot).
alter table public.profiles
  add column if not exists vessel text not null default 'female';
