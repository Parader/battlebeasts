# Mage Trials game-server

## Prod on this PC (current)

Docker Desktop, port **2567**. Friends / the packaged launcher use `ws://74.59.153.60:2567`.

Local development uses port **2568** so you can keep coding while prod stays up. See [apps/desktop/README.md](../desktop/README.md).

```powershell
pnpm prod:up
pnpm prod:down
pnpm release   # rebuild Docker prod, then publish the client pack to GitHub
```

`pnpm release` recreates the container and **drops anyone in a match**.

Needs `apps/game-server/.env` (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`). Do not commit it. Compose is started with `--env-file compose.env` so `$` in those keys is not interpolated.

## Fly.io (later)

Gameplay traffic only — Electron/web clients keep GLBs local. Not required while prod runs on this PC.

### One-time setup

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
```

Ranked LP/tier writes require **SUPABASE_SECRET_KEY** (service role). If only the
anon/publishable key is set, RLS blocks `player_ratings` upserts and everyone
stays Bronze · 0 LP in the Ranked menu.

5. Deploy:

```powershell
fly deploy --config fly.toml --dockerfile Dockerfile.game-server
```

6. WebSocket URL:

```text
wss://battlebeasts-game.fly.dev
```

Then put that URL in the next GitHub `latest.json` `gameServerUrl` (and `apps/desktop/config.example.json`) so launchers pick it up without a new EXE.

### Smoke test

```powershell
curl https://battlebeasts-game.fly.dev/health
```

Should return `{"ok":true}`.
