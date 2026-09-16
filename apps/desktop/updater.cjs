const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const DEFAULT_FEED =
  "https://github.com/Parader/battlebeasts/releases/latest/download/latest.json";
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
 * }} opts
 */
async function runUpdater(opts) {
  const userData = opts.userData;
  const feedUrl = opts.feedUrl || DEFAULT_FEED;
  const onStatus = typeof opts.onStatus === "function" ? opts.onStatus : () => {};
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
  const onNotes = typeof opts.onNotes === "function" ? opts.onNotes : () => {};

  const installed = contentDir(userData);
  const localVersion = readLocalVersion(installed);
  const playable = hasGameIndex(installed);

  let feed;
  try {
    onStatus({ phase: "checking", message: "Checking for updates…" });
    feed = await fetchJson(feedUrl);
  } catch (err) {
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
  onNotes({
    title,
    date: typeof feed.date === "string" ? feed.date : "",
    version: feed.contentVersion != null ? String(feed.contentVersion) : "",
    notes,
  });

  const gameServerUrl =
    typeof feed.gameServerUrl === "string" && feed.gameServerUrl.trim()
      ? feed.gameServerUrl.trim()
      : DEFAULT_GAME_SERVER_URL;

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
  DEFAULT_GAME_SERVER_URL,
};
