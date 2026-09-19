import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAG = "launcher";
const REPO = "Parader/battlebeasts";
const STABLE_NAME = "MageTrials-Launcher.exe";
const outDir = path.join(desktop, "dist-launcher");

function quoteWinCmd(command, args) {
  const q = (s) => `"${String(s).replaceAll('"', '\\"')}"`;
  return [q(command), ...args.map(q)].join(" ");
}

function run(command, args, opts = {}) {
  const spawnOpts = {
    cwd: opts.cwd,
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  };
  const result =
    process.platform === "win32"
      ? spawnSync(quoteWinCmd(command, args), { ...spawnOpts, shell: true })
      : spawnSync(command, args, spawnOpts);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
}

function runCapture(command, args) {
  const spawnOpts = {
    encoding: "utf8",
    windowsHide: true,
    env: process.env,
  };
  return process.platform === "win32"
    ? spawnSync(quoteWinCmd(command, args), { ...spawnOpts, shell: true })
    : spawnSync(command, args, spawnOpts);
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

function findBuiltExe(version) {
  const named = path.join(desktop, "release-v5", `MageTrials-Launcher-${version}.exe`);
  if (fs.existsSync(named)) return named;
  const releaseDir = path.join(desktop, "release-v5");
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`Missing ${named} — run pnpm dist:desktop first`);
  }
  const matches = fs
    .readdirSync(releaseDir)
    .filter((name) => name.startsWith("MageTrials-Launcher-") && name.endsWith(".exe"))
    .map((name) => path.join(releaseDir, name));
  if (matches.length === 1) return matches[0];
  throw new Error(`Missing ${named} — run pnpm dist:desktop first`);
}

function stampLauncherOnLatestJson(latestPath, launcherFeed) {
  const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  latest.launcher = {
    version: launcherFeed.version,
    name: launcherFeed.name,
    sha256: launcherFeed.sha256,
    size: launcherFeed.size,
    url: launcherFeed.url,
  };
  latest.minLauncher = launcherFeed.version;
  fs.writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
  return latest.releaseTag || null;
}

function updateLatestGameFeed(launcherFeed) {
  const tmp = path.join(outDir, "latest.json");
  const view = runCapture("gh", [
    "release",
    "view",
    "--repo",
    REPO,
    "--json",
    "tagName",
  ]);
  if (view.status !== 0) {
    console.warn("No latest game release — skip stamping launcher onto latest.json");
    return;
  }
  const tag = JSON.parse(view.stdout || "{}").tagName;
  if (!tag) return;
  const dl = runCapture("gh", [
    "release",
    "download",
    tag,
    "--repo",
    REPO,
    "--pattern",
    "latest.json",
    "--dir",
    outDir,
    "--clobber",
  ]);
  if (dl.status !== 0 || !fs.existsSync(tmp)) {
    console.warn(`Could not download ${tag} latest.json — launcher EXE is up, game feed still stale`);
    return;
  }
  stampLauncherOnLatestJson(tmp, launcherFeed);
  run("gh", ["release", "upload", tag, tmp, "--repo", REPO, "--clobber"]);
  console.log(`Stamped launcher ${launcherFeed.version} onto ${tag}/latest.json`);
}

const pkg = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8"));
const version = String(pkg.version);
const built = findBuiltExe(version);

fs.mkdirSync(outDir, { recursive: true });
const stableExe = path.join(outDir, STABLE_NAME);
fs.copyFileSync(built, stableExe);
const sha256 = sha256File(stableExe);
const size = fs.statSync(stableExe).size;
const feed = {
  version,
  name: STABLE_NAME,
  sha256,
  size,
  url: `https://github.com/${REPO}/releases/download/${TAG}/${STABLE_NAME}`,
};
const feedPath = path.join(outDir, "latest-launcher.json");
fs.writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`);

const notesPath = path.join(outDir, "RELEASE_NOTES.md");
fs.writeFileSync(
  notesPath,
  `# Mage Trials Launcher ${version}\n\nSelf-updating portable launcher. Game content still comes from the latest game release.\n`,
);

const exists = runCapture("gh", ["release", "view", TAG, "--json", "tagName"]).status === 0;
if (exists) {
  console.log(`Updating GitHub release ${TAG} (${version})…`);
  run("gh", ["release", "upload", TAG, stableExe, feedPath, "--clobber"]);
  run("gh", ["release", "edit", TAG, "--title", `Launcher ${version}`, "--notes-file", notesPath]);
} else {
  console.log(`Creating GitHub release ${TAG} (${version})…`);
  run("gh", [
    "release",
    "create",
    TAG,
    stableExe,
    feedPath,
    "--title",
    `Launcher ${version}`,
    "--notes-file",
    notesPath,
    "--latest=false",
  ]);
}

updateLatestGameFeed(feed);
console.log(`Published launcher ${version} → ${feed.url}`);
