# Hosted Mage Trials game-server (Fly.io)

Gameplay traffic only — Electron/web clients keep GLBs local.

## One-time setup

1. Install Fly CLI: https://fly.io/docs/hands-on/install-flyctl/
2. `fly auth login`
3. From repo root:

```powershell
fly launch --config fly.toml --dockerfile Dockerfile.game-server --copy-config --no-deploy
```

If the app name `battlebeasts-game` is taken, edit `app = "..."` in `fly.toml`.

4. Set secrets (use your real values from `apps/game-server/.env` — never commit them):

```powershell
fly secrets set ALLOW_GUESTS=true SUPABASE_URL="..." SUPABASE_SECRET_KEY="..."

Ranked LP/tier writes require **SUPABASE_SECRET_KEY** (service role). If only the
anon/publishable key is set, RLS blocks `player_ratings` upserts and everyone
stays Bronze · 0 LP in the Ranked menu.
```

5. Deploy:

```powershell
fly deploy --config fly.toml --dockerfile Dockerfile.game-server
```

6. Your WebSocket URL is:

```text
wss://battlebeasts-game.fly.dev
```

(replace with your app name)

## Point Electron / web at it

`apps/desktop/config.json`:

```json
{ "gameServerUrl": "wss://battlebeasts-game.fly.dev" }
```

Or for local Vite:

```env
VITE_GAME_SERVER_URL=wss://battlebeasts-game.fly.dev
```

## Smoke test

```powershell
curl https://battlebeasts-game.fly.dev/health
```

Should return `{"ok":true}`.
