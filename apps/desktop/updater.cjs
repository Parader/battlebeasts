const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const DEFAULT_FEED =
  "https://github.com/Parader/battlebeasts/releases/latest/download/latest.json";
const DEFAULT_LAUNCHER_FEED =
  "https://github.com/Parader/battlebeasts/releases/download/launcher/latest-launcher.json";
const DEFAULT_GAME_SERVER_URL = "ws://74.59.153.60:2567";
const MAX_ATTEMPTS = 3;

function contentDir(userData) {
  return path.join(userData, "content");
}

function downloadingDir(userData) {
  return path.join(userData, "content-downloading");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function readLocalVersion(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, ".version"), "utf8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

function hasGameIndex(dir) {
  try {
    return fs.existsSync(path.join(dir, "index.html"));
  } catch {
    return false;
  }
}

function normalizeNotes(raw) {
  const empty = { balance: [], fixes: [], content: [], highlights: [] };
  if (!raw || typeof raw !== "object") return empty;
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  return {
    balance: list(raw.balance),
    fixes: list(raw.fixes),
    content: list(raw.content),
    highlights: list(raw.highlights),
  };
}

function normalizeHistory(feed, fallback) {
  const raw = Array.isArray(feed && feed.history) ? feed.history : [];
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!title) continue;
    out.push({
      id: typeof entry.id === "string" ? entry.id : "",
      title,
      date: typeof entry.date === "string" ? entry.date : "",
      version: typeof entry.version === "string" ? entry.version : "",
      notes: normalizeNotes(entry.notes || entry),
    });
  }
  if (out.length > 0) return out;
  return fallback ? [fallback] : [];
}

async function fetchJson(url, timeoutMs = 20_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const bust = new URL(url);
    bust.searchParams.set("_", String(Date.now()));
    const res = await fetch(bust.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function downloadFile(url, dest, onProgress) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await downloadOnce(url, dest, onProgress);
      return;
    } catch (err) {
      lastErr = err;
      try {
        fs.rmSync(dest, { force: true });
      } catch {
        // ignore
      }
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function downloadOnce(url, dest, onProgress) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") || 0);
  if (!res.body) throw new Error("Empty download body");
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const file = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!file.write(Buffer.from(value))) {
        await new Promise((resolve) => file.once("drain", resolve));
      }
      if (typeof onProgress === "function") onProgress({ received, total });
    }
  } finally {
    await new Promise((resolve, reject) => {
      file.end((err) => (err ? reject(err) : resolve()));
    });
  }
}

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const tar = process.platform === "win32" ? "tar.exe" : "tar";
  const result = spawnSync(tar, ["-x", "-f", zipPath, "-C", destDir], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "extract failed").trim());
  }
}

function unwrapSingleRoot(dir) {
  const index = path.join(dir, "index.html");
  if (fs.existsSync(index)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== ".version");
  if (entries.length !== 1 || !entries[0].isDirectory()) return;
  const inner = path.join(dir, entries[0].name);
  if (!fs.existsSync(path.join(inner, "index.html"))) return;
  const staging = `${dir}__unwrap`;
  rmrf(staging);
  fs.renameSync(inner, staging);
  for (const leftover of fs.readdirSync(dir)) {
    rmrf(path.join(dir, leftover));
  }
  for (const name of fs.readdirSync(staging)) {
    fs.renameSync(path.join(staging, name), path.join(dir, name));
  }
  rmrf(staging);
}

function atomicReplace(fromDir, toDir) {
  const bak = `${toDir}.old`;
  rmrf(bak);
  if (fs.existsSync(toDir)) fs.renameSync(toDir, bak);
  fs.renameSync(fromDir, toDir);
  rmrf(bak);
}

function cmpVersion(a, b) {
  const pa = String(a || "")
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b || "")
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function launcherSpecFrom(raw) {
  if (!raw || typeof raw !== "object") return null;
  const version = raw.version != null ? String(raw.version).trim() : "";
  const name =
    typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "MageTrials-Launcher.exe";
  const url =
    typeof raw.url === "string" && raw.url.trim()
      ? raw.url.trim()
      : name
        ? `https://github.com/Parader/battlebeasts/releases/download/launcher/${name}`
        : "";
  if (!version || !url) return null;
  return {
    version,
    url,
    sha256: typeof raw.sha256 === "string" ? raw.sha256.trim() : "",
    name,
  };
}

function batQuote(value) {
  return `"${String(value).replaceAll("%", "%%").replaceAll('"', '""')}"`;
}

function scheduleLauncherSwap(currentExe, nextExe) {
  const bat = `${nextExe}.swap.cmd`;
  const pid = process.pid;
  const src = batQuote(nextExe);
  const dest = batQuote(currentExe);
  fs.writeFileSync(
    bat,
    [
      "@echo off",
      "setlocal",
      ":wait",
      "ping 127.0.0.1 -n 2 >nul",
      `tasklist /FI "PID eq ${pid}" 2>nul | findstr /I /C:"No tasks" >nul`,
      "if errorlevel 1 goto wait",
      "set tries=0",
      ":copy",
      `copy /Y ${src} ${dest} >nul`,
      "if not errorlevel 1 goto launch",
      "set /a tries+=1",
      "if %tries% GEQ 40 goto launch",
      "ping 127.0.0.1 -n 2 >nul",
      "goto copy",
      ":launch",
      `start "" ${dest}`,
      `del /F /Q ${src} >nul 2>&1`,
      `(goto) 2>nul & del /F /Q "%~f0"`,
    ].join("\r\n"),
    "utf8",
  );
  const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", bat], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function applyLauncherUpdate(spec, opts) {
  const execPath = opts.execPath;
  const onStatus = opts.onStatus;
  const onProgress = opts.onProgress;
  const dest = path.join(
    path.dirname(execPath),
    `.${path.basename(execPath, ".exe")}.${spec.version}.new.exe`,
  );
  onStatus({ phase: "updating", message: "Updating launcher…" });
  await downloadFile(spec.url, dest, onProgress);
  if (spec.sha256) {
    const hash = await sha256File(dest);
    if (hash.toLowerCase() !== spec.sha256.toLowerCase()) {
      try {
        fs.rmSync(dest, { force: true });
      } catch {
        // ignore
      }
      throw new Error("Launcher checksum mismatch");
    }
  }
  onStatus({ phase: "updating", message: "Restarting launcher…" });
  scheduleLauncherSwap(execPath, dest);
  return true;
}

async function resolveLauncherSpec(feed) {
  const fromFeed = launcherSpecFrom(feed && feed.launcher);
  if (fromFeed) return fromFeed;
  try {
    return launcherSpecFrom(await fetchJson(DEFAULT_LAUNCHER_FEED));
  } catch {
    return null;
  }
}

async function tryLauncherUpdate(opts, ctx) {
  if (!opts.packaged || !opts.execPath || process.platform !== "win32") return null;
  if (path.basename(opts.execPath).toLowerCase() === "electron.exe") return null;
  const spec = await resolveLauncherSpec(ctx.feed);
  if (!spec || cmpVersion(spec.version, String(opts.launcherVersion || "")) <= 0) return null;
  try {
    await applyLauncherUpdate(spec, {
      execPath: opts.execPath,
      onStatus: opts.onStatus,
      onProgress: opts.onProgress,
    });
    return {
      ok: true,
      canPlay: false,
      restartLauncher: true,
      contentDir: ctx.playable ? ctx.installed : undefined,
      gameServerUrl: ctx.gameServerUrl || DEFAULT_GAME_SERVER_URL,
      version: ctx.localVersion,
      notes: ctx.notes,
      title: ctx.title,
    };
  } catch (err) {
    console.warn("[updater] launcher self-update failed", err);
    return null;
  }
}

function assetUrl(feed, pack) {
  if (!pack || typeof pack !== "object") return null;
  if (typeof pack.url === "string" && pack.url.trim()) return pack.url.trim();
  if (typeof pack.name === "string" && pack.name.trim() && typeof feed.releaseTag === "string") {
    return `https://github.com/Parader/battlebeasts/releases/download/${feed.releaseTag}/${pack.name}`;
  }
  return null;
}

/**
 * @param {{
 *   userData: string,
 *   feedUrl?: string,
 *   onStatus?: (s: object) => void,
 *   onProgress?: (p: { received: number, total: number }) => void,
 *   onNotes?: (n: object) => void,
 *   packaged?: boolean,
 *   execPath?: string,
 *   launcherVersion?: string,
 * }} opts
 */
async function runUpdater(opts) {
  const userData = opts.userData;
  const feedUrl = opts.feedUrl || DEFAULT_FEED;
  const onStatus = typeof opts.onStatus === "function" ? opts.onStatus : () => {};
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
  const onNotes = typeof opts.onNotes === "function" ? opts.onNotes : () => {};
  const launcherOpts = { ...opts, onStatus, onProgress };

  const installed = contentDir(userData);
  const localVersion = readLocalVersion(installed);
  const playable = hasGameIndex(installed);

  let feed;
  try {
    onStatus({ phase: "checking", message: "Checking for updates…" });
    feed = await fetchJson(feedUrl);
  } catch (err) {
    const restarted = await tryLauncherUpdate(launcherOpts, {
      feed: null,
      playable,
      installed,
      localVersion,
      gameServerUrl: DEFAULT_GAME_SERVER_URL,
    });
    if (restarted) return restarted;
    if (playable) {
      onStatus({
        phase: "stale",
        message: "Couldn’t check for updates — playing last install.",
      });
      return {
        ok: true,
        stale: true,
        canPlay: true,
        contentDir: installed,
        gameServerUrl: DEFAULT_GAME_SERVER_URL,
        version: localVersion,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    onStatus({ phase: "error", message: "Couldn’t update — check internet." });
    return {
      ok: false,
      canPlay: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const notes = normalizeNotes(feed.notes);
  const title =
    typeof feed.title === "string" && feed.title.trim()
      ? feed.title.trim()
      : `Patch ${feed.contentVersion ?? ""}`.trim();
  const current = {
    id: "",
    title,
    date: typeof feed.date === "string" ? feed.date : "",
    version: feed.contentVersion != null ? String(feed.contentVersion) : "",
    notes,
  };
  onNotes({
    ...current,
    history: normalizeHistory(feed, current),
  });

  const gameServerUrl =
    typeof feed.gameServerUrl === "string" && feed.gameServerUrl.trim()
      ? feed.gameServerUrl.trim()
      : DEFAULT_GAME_SERVER_URL;

  const restarted = await tryLauncherUpdate(launcherOpts, {
    feed,
    playable,
    installed,
    localVersion,
    gameServerUrl,
    notes,
    title,
  });
  if (restarted) return restarted;

  const remoteVersion = feed.contentVersion != null ? String(feed.contentVersion) : "";
  if (playable && remoteVersion && localVersion === remoteVersion) {
    onStatus({ phase: "ready", message: "Up to date" });
    return {
      ok: true,
      canPlay: true,
      contentDir: installed,
      gameServerUrl,
      version: localVersion,
      notes,
      title,
    };
  }

  const full = feed.full && typeof feed.full === "object" ? feed.full : null;
  const patch = feed.patch && typeof feed.patch === "object" ? feed.patch : null;
  const usePatch =
    playable &&
    localVersion &&
    patch &&
    patch.from === localVersion &&
    (patch.url || patch.name);
  const pack = usePatch ? patch : full;
  const url = assetUrl(feed, pack);
  if (!url) {
    onStatus({ phase: "error", message: "Update feed is missing a download." });
    return {
      ok: false,
      canPlay: playable,
      stale: playable,
      contentDir: playable ? installed : undefined,
      gameServerUrl,
      version: localVersion,
      notes,
      title,
      error: "Missing content url",
    };
  }

  const tmpRoot = downloadingDir(userData);
  rmrf(tmpRoot);
  fs.mkdirSync(tmpRoot, { recursive: true });
  const zipPath = path.join(tmpRoot, typeof pack.name === "string" ? pack.name : "content.zip");
  const staging = path.join(tmpRoot, "staging");

  try {
    onStatus({
      phase: "updating",
      message: usePatch ? "Updating…" : "Downloading game…",
    });
    await downloadFile(url, zipPath, onProgress);
    if (typeof pack.sha256 === "string" && pack.sha256.trim()) {
      const hash = await sha256File(zipPath);
      if (hash.toLowerCase() !== pack.sha256.trim().toLowerCase()) {
        throw new Error("Checksum mismatch");
      }
    }
    if (usePatch) {
      fs.cpSync(installed, staging, { recursive: true });
    } else {
      fs.mkdirSync(staging, { recursive: true });
    }
    extractZip(zipPath, staging);
    unwrapSingleRoot(staging);
    if (!hasGameIndex(staging)) {
      throw new Error("Downloaded pack is missing index.html");
    }
    if (remoteVersion) {
      fs.writeFileSync(path.join(staging, ".version"), remoteVersion);
    }
    atomicReplace(staging, installed);
    rmrf(tmpRoot);
    onStatus({ phase: "ready", message: "Ready" });
    return {
      ok: true,
      canPlay: true,
      contentDir: installed,
      gameServerUrl,
      version: remoteVersion || localVersion,
      notes,
      title,
    };
  } catch (err) {
    rmrf(tmpRoot);
    const message = err instanceof Error ? err.message : String(err);
    onStatus({ phase: "error", message: "Couldn’t update — check internet." });
    return {
      ok: false,
      canPlay: playable,
      stale: playable,
      contentDir: playable ? installed : undefined,
      gameServerUrl,
      version: localVersion,
      notes,
      title,
      error: message,
    };
  }
}

module.exports = {
  runUpdater,
  contentDir,
  DEFAULT_FEED,
  DEFAULT_LAUNCHER_FEED,
  DEFAULT_GAME_SERVER_URL,
};
