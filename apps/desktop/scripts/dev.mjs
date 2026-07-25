import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, opts = {}) {
  return spawn(command, args, {
    cwd: opts.cwd ?? root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...opts.env },
  });
}

const vite = run("pnpm", ["--filter", "@battlebeasts/web", "dev"]);

let electronProc = null;

async function waitForVite() {
  const url = process.env.BB_VITE_URL ?? "http://127.0.0.1:5173";
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok || res.status === 404) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

waitForVite()
  .then(() => {
    electronProc = run("pnpm", ["exec", "electron", "."], {
      cwd: desktop,
      env: {
        BB_VITE_URL: process.env.BB_VITE_URL ?? "http://127.0.0.1:5173",
        BB_GAME_SERVER_URL: process.env.BB_GAME_SERVER_URL ?? "ws://localhost:2567",
        BB_OPEN_DEVTOOLS: process.env.BB_OPEN_DEVTOOLS ?? "",
      },
    });
    electronProc.on("exit", (code) => {
      vite.kill();
      process.exit(code ?? 0);
    });
  })
  .catch((err) => {
    console.error(err);
    vite.kill();
    process.exit(1);
  });

function shutdown() {
  electronProc?.kill();
  vite.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
