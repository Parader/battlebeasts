/**
 * Import Blender map.json → packages/shared/src/maps/<name>.{map,props}.json
 *
 * Usage:
 *   node scripts/import-village-map.mjs [path/to/map.json] [--name main_village]
 *
 * Resolves meshes from:
 *   - apps/web/public/assets/fantasy_rts
 *   - apps/web/public/assets/nature (copied from fantasykingdom/nature_gltf on demand)
 *
 * Scale: when map objects include `worldSize` (Blender evaluated AABB in Three
 * space), fit each prop so the shipped GLB matches that size. Matrix decompose
 * scale alone is wrong for nature kits (tiny empty scales × already-normalized GLBs).
 *
 * Then bake footprints:
 *   node scripts/bake-hub-colliders.mjs
 */
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "fs";
import path from "path";
import { pathToFileURL } from "url";

if (typeof globalThis.ProgressEvent === "undefined") {
  globalThis.ProgressEvent = class ProgressEvent extends Event {
    constructor(type, init = {}) {
      super(type);
      this.lengthComputable = Boolean(init.lengthComputable);
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
  };
}
if (typeof globalThis.self === "undefined") {
  globalThis.self = globalThis;
}

import * as THREE from "../apps/web/node_modules/three/build/three.module.js";
import { GLTFLoader } from "../apps/web/node_modules/three/examples/jsm/loaders/GLTFLoader.js";

const root = process.cwd();

function parseArgs(argv) {
  let mapPath = "c:/Users/deric/Downloads/fantasykingdom/maps/map.json";
  let name = "main_village";
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name" && argv[i + 1]) {
      name = argv[++i];
      continue;
    }
    if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node scripts/import-village-map.mjs [map.json] [--name main_village]",
      );
      process.exit(0);
    }
    if (!a.startsWith("-")) positional.push(a);
  }
  if (positional[0]) mapPath = positional[0];
  return { mapPath, name };
}

const { mapPath, name } = parseArgs(process.argv.slice(2));
const mapsDir = path.join(root, "packages/shared/src/maps");
const fantasyRts = path.join(root, "apps/web/public/assets/fantasy_rts");
const naturePublic = path.join(root, "apps/web/public/assets/nature");
const natureLib = "c:/Users/deric/Downloads/fantasykingdom/nature_gltf";

mkdirSync(mapsDir, { recursive: true });
mkdirSync(naturePublic, { recursive: true });

if (!existsSync(mapPath)) {
  console.error(`map.json not found: ${mapPath}`);
  process.exit(1);
}

const map = JSON.parse(readFileSync(mapPath, "utf8"));
const mapOut = path.join(mapsDir, `${name}.map.json`);
const propsOut = path.join(mapsDir, `${name}.props.json`);
copyFileSync(mapPath, mapOut);

/** Normalize Blender Interact / Label → runtime kind. */
const INTERACT_ALIASES = {
  build: "build",
  armoury: "build",
  armory: "build",
  talent: "talent",
  talents: "talent",
  chapel: "talent",
  customization: "customization",
  house: "customization",
  shop: "shop",
  portal_pve: "portal_pve",
  pve: "portal_pve",
  portal_pvp: "portal_pvp",
  pvp: "portal_pvp",
  spawn: "spawn",
  dummy: "dummy",
  practice_dummy: "dummy",
};

function normalizeInteract(raw) {
  if (!raw || typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return INTERACT_ALIASES[key] ?? null;
}

function interactOf(o) {
  const p = o.properties ?? {};
  return (
    normalizeInteract(p.Interact) ||
    normalizeInteract(p.interact) ||
    normalizeInteract(p.Label) ||
    normalizeInteract(p.label)
  );
}

function baseId(id) {
  return String(id).replace(/\.\d{3}$/, "");
}

/** Index nature_gltf once: basename → absolute path. */
function indexNatureLib() {
  const byBase = new Map();
  if (!existsSync(natureLib)) return byBase;

  function walk(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(glb|gltf)$/i.test(ent.name)) continue;
      const base = ent.name.replace(/\.(glb|gltf)$/i, "");
      if (!byBase.has(base)) byBase.set(base, full);
    }
  }
  walk(natureLib);
  return byBase;
}

const natureIndex = indexNatureLib();
console.log("nature library assets:", natureIndex.size);

function ensureNatureCopy(absSrc, base) {
  const ext = path.extname(absSrc).toLowerCase();
  const destName = `${base}${ext}`;
  const destAbs = path.join(naturePublic, destName);
  if (!existsSync(destAbs)) {
    copyFileSync(absSrc, destAbs);
    // Also copy sibling .bin if gltf
    if (ext === ".gltf") {
      const bin = absSrc.replace(/\.gltf$/i, ".bin");
      if (existsSync(bin)) {
        copyFileSync(bin, path.join(naturePublic, `${base}.bin`));
      }
    }
  }
  return `nature/${destName}`;
}

function resolveFile(id) {
  const base = baseId(id);
  if (base.startsWith("Portal")) return null;

  if (base.startsWith("modified_")) {
    const n = base.slice("modified_".length);
    for (const ext of [".glb", ".gltf"]) {
      const rel = `fantasy_rts/modified/${n}${ext}`;
      if (existsSync(path.join(root, "apps/web/public/assets", rel))) return rel;
    }
  }

  for (const ext of [".gltf", ".glb"]) {
    const rel = `fantasy_rts/${base}${ext}`;
    if (existsSync(path.join(root, "apps/web/public/assets", rel))) return rel;
  }

  for (const ext of [".glb", ".gltf"]) {
    const rel = `nature/${base}${ext}`;
    if (existsSync(path.join(root, "apps/web/public/assets", rel))) return rel;
  }

  const fromLib = natureIndex.get(base);
  if (fromLib) return ensureNatureCopy(fromLib, base);

  return null;
}

function yawFromQuat(q) {
  const { x, y, z, w } = q;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
}

function wantsCollision(o) {
  const p = o.properties ?? {};
  if ("Collision" in p) return Boolean(p.Collision);
  if ("collision" in p) return Boolean(p.collision);
  return false;
}

const loader = new GLTFLoader();
const nativeSizeCache = new Map();

function loadGltf(absFile) {
  const buf = readFileSync(absFile);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const base = pathToFileURL(path.dirname(absFile) + path.sep).href;
  return new Promise((resolve, reject) => {
    loader.parse(ab, base, resolve, reject);
  });
}

async function nativeSizeOf(relFile) {
  if (nativeSizeCache.has(relFile)) return nativeSizeCache.get(relFile);
  const abs = path.join(root, "apps/web/public/assets", relFile);
  const gltf = await loadGltf(abs);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const out = { x: size.x, y: size.y, z: size.z };
  nativeSizeCache.set(relFile, out);
  return out;
}

/** Fit shipped GLB to Blender evaluated world AABB (Three Y-up). */
function fitScaleFromWorldSize(worldSize, native) {
  const ratios = [];
  for (const axis of ["x", "y", "z"]) {
    const w = Number(worldSize[axis]);
    const n = Number(native[axis]);
    if (w > 1e-4 && n > 1e-4) ratios.push(w / n);
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)];
}

async function buildProps() {
  const props = [];
  const interacts = [];
  const skipped = [];
  let copiedNature = 0;
  let fitted = 0;
  let fallbackScale = 0;

  for (const o of map.objects ?? []) {
    const interact = interactOf(o);
    const yaw = yawFromQuat(o.transform.rotation);
    const matrixScale = o.transform.scale?.x ?? 1;
    const x = Number(o.transform.position.x.toFixed(4));
    const z = Number(o.transform.position.z.toFixed(4));
    const id = String(o.id).replace(/[^a-zA-Z0-9_]/g, "_");

    if (interact) {
      interacts.push({
        id,
        kind: interact,
        x,
        z,
        rotationY: Number(yaw.toFixed(5)),
        label: o.properties?.Label ?? o.properties?.label ?? undefined,
        sourceObjectId: o.id,
      });
    }

    // Orphan empties (no mesh / no instance bounds) often share asset names with
    // real mesh placements — skip them so we don't double-spawn with matrix scale.
    if (o.type === "empty" && !o.worldSize) {
      if (!interact) skipped.push(o.id);
      continue;
    }

    // Instance empties still resolve by asset name (linked PP_* props)
    const before = existsSync(path.join(naturePublic, `${baseId(o.id)}.glb`));
    const file = resolveFile(o.id);
    if (!file) {
      if (!interact) skipped.push(o.id);
      continue;
    }
    if (!before && file.startsWith("nature/")) copiedNature++;

    let scale = matrixScale;
    if (o.worldSize) {
      try {
        const native = await nativeSizeOf(file);
        const fittedScale = fitScaleFromWorldSize(o.worldSize, native);
        if (fittedScale != null && Number.isFinite(fittedScale) && fittedScale > 0) {
          scale = fittedScale;
          fitted++;
        } else {
          fallbackScale++;
        }
      } catch (err) {
        fallbackScale++;
        console.warn("native size failed for", file, err?.message ?? err);
      }
    } else {
      fallbackScale++;
    }

    const collide = wantsCollision(o) ? 1 : 0;
    props.push({
      id,
      file,
      x,
      z,
      scale: Number(Number(scale).toFixed(5)),
      rotationY: Number(yaw.toFixed(5)),
      collideRadius: collide,
      ...(interact ? { interact } : {}),
    });
  }

  /**
   * Blender village is authored at oversized RTS placement sizes (~25–40m
   * buildings next to a 1.7m hero). Shrink uniformly so positions + prop scales
   * stay consistent. Tune this knob if the hub still feels off.
   */
  const worldScale = 0.2;

  writeFileSync(
    propsOut,
    JSON.stringify(
      {
        version: 2,
        source: map.source ?? path.basename(mapPath),
        worldScale,
        props,
        interacts,
      },
      null,
      2,
    ),
  );

  console.log("map   →", mapOut);
  console.log("props →", propsOut);
  console.log("worldScale", worldScale);
  console.log(
    "props",
    props.length,
    "interacts",
    interacts.length,
    "skipped",
    skipped.length,
    "natureCopied",
    copiedNature,
    "fitted",
    fitted,
    "fallbackScale",
    fallbackScale,
  );
  if (interacts.length) {
    console.log(
      "interacts:",
      interacts.map((i) => `${i.kind}@(${i.x},${i.z})`).join(", "),
    );
  }
  if (skipped.length) console.log("skipped sample:", skipped.slice(0, 20));

  // Quick scale sanity by pack
  const buckets = { nature: [], fantasy_rts: [] };
  for (const p of props) {
    const pack = p.file.startsWith("nature/") ? "nature" : "fantasy_rts";
    buckets[pack].push(p.scale);
  }
  for (const [pack, scales] of Object.entries(buckets)) {
    if (!scales.length) continue;
    const sorted = [...scales].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    console.log(
      `${pack} scale min/med/max:`,
      sorted[0].toFixed(3),
      mid.toFixed(3),
      sorted[sorted.length - 1].toFixed(3),
    );
  }
  console.log("Next: node scripts/bake-hub-colliders.mjs");
}

await buildProps();
