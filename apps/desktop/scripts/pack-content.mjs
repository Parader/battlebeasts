import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "../..");
const renderer = path.join(desktop, "renderer");
const outDir = path.join(desktop, "dist-content");
const notesPath = path.join(desktop, "patch-notes.json");
const gameNotesPath = path.join(root, "apps/web/src/game/patchNotesData.json");
const FEED_URL = "https://github.com/Parader/battlebeasts/releases/latest/download/latest.json";
const LAUNCHER_FEED_URL =
  "https://github.com/Parader/battlebeasts/releases/download/launcher/latest-launcher.json";
const REPO = "Parader/battlebeasts";
const DEFAULT_GAME_SERVER_URL = "ws://74.59.153.60:2567";

function rmDirIfExists(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function run(command, args, cwd = root) {
  const opts = {
    cwd,
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  };
  const result =
    process.platform === "win32"
      ? spawnSync(quoteWinCmd(command, args), { ...opts, shell: true })
      : spawnSync(command, args, opts);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
}

function quoteWinCmd(command, args) {
  const q = (s) => `"${String(s).replaceAll('"', '\\"')}"`;
  return [q(command), ...args.map(q)].join(" ");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let bytes;
    while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(bytes === buf.length ? buf : buf.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function walkFiles(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".version") continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(abs, base, out);
    else {
      out.push({
        abs,
        rel: path.relative(base, abs).split(path.sep).join("/"),
      });
    }
  }
  return out;
}

function hashTree(dir) {
  const files = {};
  for (const { abs, rel } of walkFiles(dir)) {
    files[rel] = sha256File(abs);
  }
  return files;
}

function tarZip(sourceDir, zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
  const tar = process.platform === "win32" ? "tar.exe" : "tar";
  const result = spawnSync(tar, ["-a", "-c", "-f", zipPath, "-C", sourceDir, "."], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "zip failed").trim());
  }
}

function listStrings(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  if (!title) return null;
  return {
    id: typeof entry.id === "string" ? entry.id : "",
    title,
    date: typeof entry.date === "string" ? entry.date : "",
    notes: {
      balance: listStrings(entry.balance),
      fixes: listStrings(entry.fixes),
      content: listStrings(entry.content),
      highlights: listStrings(entry.highlights),
    },
  };
}

function loadGamePatchNotes() {
  const entries = JSON.parse(fs.readFileSync(gameNotesPath, "utf8"));
  if (!Array.isArray(entries)) return [];
  return entries.map(normalizeEntry).filter(Boolean);
}

function loadNotes() {
  const raw = fs.existsSync(notesPath) ? JSON.parse(fs.readFileSync(notesPath, "utf8")) : {};
  const history = loadGamePatchNotes();
  const game = history[0] ?? null;
  const now = new Date();
  const fallback = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}.1`;
  return {
    contentVersion: String(raw.contentVersion || fallback),
    title: String(game?.title || raw.title || `Patch ${raw.contentVersion || fallback}`),
    date: typeof game?.date === "string" ? game.date : "",
    notes: game?.notes ?? {
      balance: [],
      fixes: [],
      content: [],
      highlights: [],
    },
    history,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return null;
  return res.json();
}

function changedPaths(prevFiles, nextFiles) {
  const changed = [];
  for (const [rel, hash] of Object.entries(nextFiles)) {
    if (prevFiles[rel] !== hash) changed.push(rel);
  }
  return changed;
}

function copySubset(srcDir, destDir, rels) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const rel of rels) {
    const from = path.join(srcDir, rel);
    const to = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

console.log("Building electron renderer…");
run("pnpm", ["--filter", "@battlebeasts/web", "run", "build:electron"]);
run(process.execPath, [path.join(desktop, "scripts", "copy-renderer.mjs")], desktop);

if (!fs.existsSync(path.join(renderer, "index.html"))) {
  throw new Error(`Missing ${path.join(renderer, "index.html")}`);
}

rmDirIfExists(outDir);
fs.mkdirSync(outDir, { recursive: true });

const notes = loadNotes();
const files = hashTree(renderer);
const manifest = { contentVersion: notes.contentVersion, files };
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest));

const contentZip = path.join(outDir, "content.zip");
console.log("Zipping content.zip…");
tarZip(renderer, contentZip);
const fullStat = fs.statSync(contentZip);

const prevFeed = await fetchJson(FEED_URL);
let patch = null;
if (prevFeed && prevFeed.contentVersion && prevFeed.contentVersion !== notes.contentVersion) {
  const prevManifestUrl = `https://github.com/${REPO}/releases/download/game-${prevFeed.contentVersion}/manifest.json`;
  const prevManifest = await fetchJson(prevManifestUrl);
  const prevFiles = prevManifest?.files && typeof prevManifest.files === "object" ? prevManifest.files : null;
  if (prevFiles) {
    const changed = changedPaths(prevFiles, files);
    if (changed.length > 0 && changed.length < Object.keys(files).length) {
      const patchRoot = path.join(outDir, "patch-root");
      copySubset(renderer, patchRoot, changed);
      const patchZip = path.join(outDir, "patch.zip");
      console.log(`Zipping patch.zip (${changed.length} files)…`);
      tarZip(patchRoot, patchZip);
      fs.rmSync(patchRoot, { recursive: true, force: true });
      const patchStat = fs.statSync(patchZip);
      const tag = `game-${notes.contentVersion}`;
      patch = {
        from: String(prevFeed.contentVersion),
        name: "patch.zip",
        sha256: sha256File(patchZip),
        size: patchStat.size,
        url: `https://github.com/${REPO}/releases/download/${tag}/patch.zip`,
      };
    }
  }
}

const tag = `game-${notes.contentVersion}`;
const launcherFeed = await fetchJson(LAUNCHER_FEED_URL);
const launcherName =
  typeof launcherFeed?.name === "string" && launcherFeed.name.trim()
    ? launcherFeed.name.trim()
    : "MageTrials-Launcher.exe";
const prevLauncher =
  prevFeed && prevFeed.launcher && typeof prevFeed.launcher === "object" ? prevFeed.launcher : null;
const launcher =
  launcherFeed && launcherFeed.version
    ? {
        version: String(launcherFeed.version),
        name: launcherName,
        sha256: typeof launcherFeed.sha256 === "string" ? launcherFeed.sha256 : "",
        size: Number(launcherFeed.size) || undefined,
        url:
          typeof launcherFeed.url === "string" && launcherFeed.url.trim()
            ? launcherFeed.url.trim()
            : `https://github.com/${REPO}/releases/download/launcher/${launcherName}`,
      }
    : prevLauncher && prevLauncher.version
      ? prevLauncher
      : null;
if (!launcherFeed?.version) {
  console.warn(
    launcher
      ? "Launcher feed missing — reusing launcher metadata from previous game feed"
      : "Launcher feed missing — latest.json will not advertise a launcher update",
  );
}
const latest = {
  contentVersion: notes.contentVersion,
  minLauncher: launcher ? launcher.version : "",
  gameServerUrl: DEFAULT_GAME_SERVER_URL,
  title: notes.title,
  date: notes.date,
  notes: notes.notes,
  history: notes.history,
  releaseTag: tag,
  full: {
    name: "content.zip",
    sha256: sha256File(contentZip),
    size: fullStat.size,
    url: `https://github.com/${REPO}/releases/download/${tag}/content.zip`,
  },
};
if (launcher) latest.launcher = launcher;
if (patch) latest.patch = patch;

fs.writeFileSync(path.join(outDir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
console.log(`Packed ${notes.contentVersion} → ${outDir}`);
