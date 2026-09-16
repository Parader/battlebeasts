# Mage Trials desktop launcher

Players download this EXE **once**. Game files live in `%APPDATA%\Mage Trials\content\` and update themselves from GitHub. Play talks to the **prod** game-server on this PC (`ws://74.59.153.60:2567`).

## Two servers on this machine

| | Port | Who |
|---|---|---|
| **Prod (Docker)** | `2567` public | Friends / packaged launcher |
| **Dev (Node)** | `2568` localhost | You, `pnpm dev` |

`pnpm dev:server` never binds 2567, so you can keep coding while people play. Recreating Docker **drops anyone in a match**.

## You (local)

```bash
# terminal 1 — your work server (2568)
pnpm --filter @battlebeasts/game-server dev

# terminal 2 — Vite + Electron against 2568
pnpm --filter @battlebeasts/desktop dev
```

Optional:

```bash
BB_GAME_SERVER_URL=ws://127.0.0.1:2568 pnpm --filter @battlebeasts/desktop dev
BB_OPEN_DEVTOOLS=1 pnpm --filter @battlebeasts/desktop dev
```

## Prod on this PC (Docker Desktop)

Needs `apps/game-server/.env` (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`). Port 2567 must stay forwarded on the router like today. Docker Compose uses `compose.env` (empty) so `$` in those keys is not eaten.

```bash
pnpm prod:up      # start last built image
pnpm prod:down    # stop
```

If this PC is off or Docker is down, friends can still update the client but cannot play.

## Ship a stable patch

1. Add/update the newest entry in [apps/web/src/game/patchNotesData.json](../web/src/game/patchNotesData.json) (`balance` / `fixes` / `content`). That file is what players see in-game **and** on the launcher.
2. Bump `contentVersion` in [patch-notes.json](patch-notes.json) if you ship more than once the same day.
3. From repo root:

```bash
pnpm release
```

That rebuilds/restarts **Docker prod** (kicks live matches) and uploads `latest.json` + `content.zip` to GitHub. The launcher checks the feed when it opens, every minute while it is showing, and again when you press Play, so a new drop applies before the game window appears.

Client-only (cosmetics / UI, no server change):

```bash
pnpm publish:game
```

Requires [GitHub CLI](https://cli.github.com/) (`gh auth login`) and a **public** Releases download (private release assets will not work for players).

## Package the launcher EXE (rare)

Bump `version` in [package.json](package.json), then from repo root:

```bash
pnpm dist:launcher
```

That builds `apps/desktop/release-v5/MageTrials-Launcher-*.exe` and uploads a stable `MageTrials-Launcher.exe` to a rolling GitHub tag `launcher` (`--latest=false`, so it never steals the game content feed). Packaged launchers check that tag when the hub is open and when Play is clicked. Windows cannot overwrite a running EXE, so the hub downloads the new file, quits, swaps, and relaunches.

Friends on an older EXE (before self-update) still need **one** last copy of this launcher. After that, `pnpm dist:launcher` is enough — you do not hand out a new file each time.

Beside the exe you can drop a `config.json` to override `gameServerUrl` (see [config.example.json](config.example.json)). If that file is absent, the launcher uses `gameServerUrl` from the GitHub feed, then the baked home IP.

## Google sign-in (desktop)

Desktop Google OAuth opens the **system browser**. After Google finishes, the browser hits
`http://127.0.0.1:3847/auth/callback`, then focuses Mage Trials. The packaged UI is served from
`http://127.0.0.1:3850` (not `file://`) so Supabase PKCE session storage works.

1. In Supabase → Authentication → URL Configuration, add redirect URL (required):
   `http://127.0.0.1:3847/auth/callback`
2. Ensure the Google OAuth provider is enabled for the same Supabase project used by `apps/web/.env`.
3. After Google sign-in, allow opening Mage Trials — the waiting state should clear automatically.
