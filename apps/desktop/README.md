# Mage Trials desktop (Electron)

Local client that packages the web build + GLB assets so friends load them from disk instead of through a tunnel.

## Dev (you host game-server locally)

```bash
# terminal 1
pnpm --filter @battlebeasts/game-server dev

# terminal 2
pnpm --filter @battlebeasts/desktop dev
```

Optional:

```bash
BB_GAME_SERVER_URL=ws://192.168.1.42:2567 pnpm --filter @battlebeasts/desktop dev
BB_OPEN_DEVTOOLS=1 pnpm --filter @battlebeasts/desktop dev
```

## Package a Windows portable build

```bash
pnpm --filter @battlebeasts/desktop dist
```

Output: `apps/desktop/release-v5/` (portable / unpacked). That folder is **gitignored** — do not commit packaged builds.

Next to the exe (or extract folder), edit `config.json`:

```json
{
  "gameServerUrl": "ws://YOUR_LAN_IP:2567"
}
```

Your friend runs the portable app; you run `pnpm --filter @battlebeasts/game-server dev` (firewall allow port 2567). Assets stay local — only gameplay traffic hits the network.

## Google sign-in (desktop)

Desktop Google OAuth opens the **system browser**. After Google finishes, the browser hits
`http://127.0.0.1:3847/auth/callback`, then focuses Mage Trials. The packaged UI is served from
`http://127.0.0.1:3850` (not `file://`) so Supabase PKCE session storage works.

1. In Supabase → Authentication → URL Configuration, add redirect URL (required):
   `http://127.0.0.1:3847/auth/callback`
2. Ensure the Google OAuth provider is enabled for the same Supabase project used by `apps/web/.env`.
3. After Google sign-in, allow opening Mage Trials — the waiting state should clear automatically.
