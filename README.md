# BattleBeasts

Web-based Battlerite-inspired top-down 3D PvP/PvE game.

## Stack

- `apps/web` — Vite + React + Untitled UI + React Three Fiber
- `apps/game-server` — Colyseus authoritative rooms
- `packages/shared` — protocol, abilities, sim helpers

## Develop

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:5173
- Game server: ws://localhost:2567

## Auth (Google via Supabase)

1. Create a Supabase project
2. Enable **Google** under Authentication → Providers
3. Add redirect URL: `http://localhost:5173/auth/callback`
4. Copy project URL into `apps/web/.env` as `VITE_SUPABASE_URL` and into `apps/game-server/.env` as `SUPABASE_URL`
5. Use publishable key in web (`VITE_SUPABASE_PUBLISHABLE_KEY`) and secret key only on the server (`SUPABASE_SECRET_KEY`)
7. Run SQL migrations in the SQL editor (in order):
   - [`supabase/migrations/20260721000000_foundation_profiles.sql`](supabase/migrations/20260721000000_foundation_profiles.sql)
   - [`supabase/migrations/20260721000001_unique_display_names.sql`](supabase/migrations/20260721000001_unique_display_names.sql)
   - [`supabase/migrations/20260721000002_friends_hub_invites.sql`](supabase/migrations/20260721000002_friends_hub_invites.sql)

On first login, players get a random `Hunter_xxxxxx` name and must confirm/change it (unique) before entering the city.

Friends: open **Friends** in-city → add by display name → invite online friends to your hub.

## Controls (base city)

- WASD — move
- Mouse — aim (character yaw; fixed camera)
- E — interact with stands / portals
