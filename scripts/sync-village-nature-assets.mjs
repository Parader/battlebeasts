/**
 * Copy every nature asset referenced by the village map into
 * apps/web/public/assets/nature from fantasykingdom/nature_gltf.
 *
 * Usage:
 *   node scripts/sync-village-nature-assets.mjs
 *   node scripts/sync-village-nature-assets.mjs --all   # entire nature_gltf library
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = path.join(root, "packages/shared/src/maps/main_village.map.json");
const propsPath = path.join(root, "packages/shared/src/maps/main_village.props.json");
const destDir = path.join(root, "apps/web/public/assets/nature");
const libRoot =
  process.env.NATURE_GLTF_ROOT ??
  "c:/Users/deric/Downloads/fantasykingdom/nature_gltf";

const copyAll = process.argv.includes("--all");

function baseId(id) {
  return String(id).replace(/\.\d{3}$/, "");
}

function walk(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else if (/\.(glb|gltf)$/i.test(ent.name)) acc.push(full);
  }
  return acc;
}

function indexLib(libDir) {
  const byBase = new Map();
  if (!existsSync(libDir)) {
    console.error("nature library not found:", libDir);
    process.exit(1);
  }
  for (const full of walk(libDir)) {
    const base = path.basename(full).replace(/\.(glb|gltf)$/i, "");
    if (!byBase.has(base)) byBase.set(base, full);
  }
  return byBase;
}

function neededBases() {
  const names = new Set();
  if (existsSync(propsPath)) {
    const props = JSON.parse(readFileSync(propsPath, "utf8"));
    for (const p of props.props ?? []) {
      if (typeof p.file === "string" && p.file.startsWith("nature/")) {
        names.add(path.basename(p.file).replace(/\.(glb|gltf)$/i, ""));
      }
    }
  }
  if (existsSync(mapPath)) {
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    for (const o of map.objects ?? []) {
      const id = String(o.id);
      if (id.startsWith("Empty")) continue;
      if (id.startsWith("Barracks_") || id.startsWith("Houses_") || id.startsWith("Temple_")) continue;
      if (id.startsWith("TownCenter_") || id.startsWith("WatchTower_") || id.startsWith("modified_")) continue;
      if (id.startsWith("PP_") || id.startsWith("SM_") || id.startsWith("FK_")) {
        names.add(baseId(id));
      }
    }
  }
  return names;
}

function copySidecars(srcAbs, destBaseAbs) {
  // For .gltf: copy matching .bin next to it if present
  if (/\.gltf$/i.test(srcAbs)) {
    const binSrc = srcAbs.replace(/\.gltf$/i, ".bin");
    if (existsSync(binSrc)) {
      const binDest = destBaseAbs.replace(/\.gltf$/i, ".bin");
      copyFileSync(binSrc, binDest);
      return 1;
    }
  }
  return 0;
}

mkdirSync(destDir, { recursive: true });
const index = indexLib(libRoot);
console.log("nature library:", index.size, "assets at", libRoot);

const targets = copyAll ? new Set(index.keys()) : neededBases();
console.log(copyAll ? "copying entire library" : "copying map-referenced", targets.size);

let copied = 0;
let skipped = 0;
let missing = [];
let bytes = 0;
let sidecars = 0;

for (const base of [...targets].sort()) {
  const src = index.get(base);
  if (!src) {
    missing.push(base);
    continue;
  }
  const ext = path.extname(src);
  const dest = path.join(destDir, `${base}${ext}`);
  const srcStat = statSync(src);
  const needsCopy =
    !existsSync(dest) || statSync(dest).size !== srcStat.size || statSync(dest).mtimeMs < srcStat.mtimeMs;
  if (needsCopy) {
    copyFileSync(src, dest);
    copied++;
    bytes += srcStat.size;
  } else {
    skipped++;
  }
  sidecars += copySidecars(src, dest);
}

console.log(
  JSON.stringify(
    {
      dest: destDir,
      copied,
      unchanged: skipped,
      sidecars,
      missing: missing.length,
      bytesMB: Number((bytes / 1e6).toFixed(2)),
      totalInDest: readdirSync(destDir).filter((n) => /\.(glb|gltf)$/i.test(n)).length,
    },
    null,
    2,
  ),
);
if (missing.length) console.log("missing from library:", missing.slice(0, 40));
