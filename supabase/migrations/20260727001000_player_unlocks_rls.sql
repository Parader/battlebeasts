-- RLS for shop unlock tables (match inventory/loadouts pattern)
-- Applied remotely as player_unlocks_rls; kept here for fresh local applies
-- when 20260727000000 already included these statements.

alter table public.player_unlocks enable row level security;
alter table public.loadout_presets enable row level security;

drop policy if exists "player_unlocks_select_own" on public.player_unlocks;
create policy "player_unlocks_select_own"
  on public.player_unlocks for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "player_unlocks_update_own" on public.player_unlocks;
create policy "player_unlocks_update_own"
  on public.player_unlocks for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "player_unlocks_insert_own" on public.player_unlocks;
create policy "player_unlocks_insert_own"
  on public.player_unlocks for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "loadout_presets_select_own" on public.loadout_presets;
create policy "loadout_presets_select_own"
  on public.loadout_presets for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "loadout_presets_update_own" on public.loadout_presets;
create policy "loadout_presets_update_own"
  on public.loadout_presets for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "loadout_presets_insert_own" on public.loadout_presets;
create policy "loadout_presets_insert_own"
  on public.loadout_presets for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.player_unlocks to authenticated;
grant select, insert, update on public.loadout_presets to authenticated;
grant all on public.player_unlocks to service_role;
grant all on public.loadout_presets to service_role;
