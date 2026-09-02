#!/usr/bin/env node
/**
 * Import a Synty POLYGON kit (FBX->glTF converted) into the prop library.
 *
 * Two things make this more than a copy:
 *
 * 1. The kit ships `.gltf` + sidecar `.bin`, but the library and the manifest
 *    generator both speak `.glb`. We repack each pair into a single GLB.
 *
 * 2. Synty kits are atlas-based: every model shares a handful of large PNGs.
 *    Embedding textures per-GLB would duplicate a ~4 MB atlas hundreds of
 *    times. Instead the image URIs stay external and relative, so all props in
 *    a biome reference one copy on disk -- and the browser downloads and
 *    uploads that atlas to the GPU exactly once.
 *
 * Selection is deliberate: this pulls outdoor, map-decorating geometry and
 * skips the interior clutter, weapons, characters and FX the kit also carries.
 *
 * Usage:
 *   node scripts/import-synty-kit.mjs --src <dir> --biome kingdom [--dry]
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- selection rules --------------------------------------------------------

/** Whole categories that never belong in an outdoor map. */
const SKIP_PREFIX = [
  "SM_Item_", // hand props: cutlery, food, tankards, tools
  "SM_Wep_", // weapons
  "SM_Chr_", // characters
  "FX_", // effect meshes
  "FantasyKingdom_", // character attachment sets
  "SM_Particle",
  "SunShafts",
  "SM_Arrow_",
  "SM_Prop_Arrow_", // loose projectiles
  "SM_Dead", // corpses
  "SM_Prop_Dead_",
  "SM_Prop_Animal_Head", // mounted trophies -- interior wall decor
  "SM_Prop_Bar_", // tavern counter, taps and mats
  "SM_Generic_Cloud", // skybox pieces
  "SM_Generic_CloudRing",
];

/**
 * Ground tiles are skipped across the board: the editor paints its own ground,
 * and these would only ever fight with it (see HIDDEN_FAMILIES in
 * gen-prop-manifest.mjs, which hides the equivalents from the existing kit).
 */
const SKIP_MATCH = [/^SM_Env_Ground_/i, /^SM_Generic_Ground_/i];

/** Buildings and environment come in wholesale; both are map-scale geometry. */
const KEEP_PREFIX = ["SM_Bld_", "SM_Env_", "SM_Veh_", "SM_Generic_Grass_"];

/**
 * `SM_Prop_` is the kit's junk drawer -- 794 models spanning market stalls and
 * teaspoons -- so it is opt-in by category token rather than wholesale.
 */
const KEEP_PROP_TOKENS = new Set(
  [
    // structures and settlement dressing
    "Fence", "Wall", "Archway", "Gazebo", "Stage", "Stand", "Street", "Divider",
    "Gallows", "Guillotine", "Cage", "Well", "Windmill", "Church", "Door",
    "Statue", "Cross", "Bell", "Weathervane", "Ladder", "Spike", "Beam",
    // market and camp
    "Market", "Awning", "Sign", "Direction", "Quest", "Poster",
    "Flag", "Banner", "Bunting", "Camp", "Forge", "Anvil", "Workbench",
    "Table", "Bench", "Stool", "Chest", "Barrel", "Crate", "Sack", "Basket",
    "Bucket", "Pot", "Cauldron", "Cooking", "FirePit", "Torch", "Grinding",
    // rural and materials
    "Hay", "Wheat", "Cabbage", "Plow", "Log", "Wood", "Plank", "Ore", "Chain",
    "Tether", "WashingLine", "Clothes", "Pumpkin", "PlanterBox", "Ground",
    // battle and ruin dressing
    "Battle", "Destroyed", "Target", "Dummy", "Path", "Fireworks",
  ].map((t) => t.toLowerCase()),
);

function shouldImport(name) {
  if (SKIP_PREFIX.some((p) => name.startsWith(p))) return false;
  if (SKIP_MATCH.some((re) => re.test(name))) return false;
  if (KEEP_PREFIX.some((p) => name.startsWith(p))) return true;
  if (name.startsWith("SM_Prop_")) {
    const token = name.split("_")[2] ?? "";
    return KEEP_PROP_TOKENS.has(token.toLowerCase());
  }
  return false;
}

// --- naming -----------------------------------------------------------------

/**
 * `SM_Bld_Castle_Battlements_01` -> `PP_Castle_Battlements_01`.
 *
 * The category token is dropped so families read as `Castle_Battlements`
 * rather than `SM_Bld_Castle_Battlements`, matching the existing library's
 * `PP_Fir_Tree_17` convention that gen-prop-manifest.mjs parses.
 */
function targetName(name) {
  let n = name
    .replace(/^SM_(Bld|Env|Prop|Veh|Generic)_/, "")
    // Preset buildings are all suffixed; the distinction is meaningless here.
    .replace(/_Optimized$/, "");
  return `PP_${n}`;
}

// --- GLB packing ------------------------------------------------------------

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

/** Repack a glTF document and its buffer into a single self-contained GLB. */
function packGlb(gltf, bin) {
  const json = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonPad = pad4(json.length);
  const binPad = pad4(bin.length);

  const jsonLen = json.length + jsonPad;
  const binLen = bin.length + binPad;
  const total = 12 + 8 + jsonLen + (bin.length ? 8 + binLen : 0);

  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(GLB_MAGIC, o); o += 4;
  out.writeUInt32LE(2, o); o += 4;
  out.writeUInt32LE(total, o); o += 4;

  out.writeUInt32LE(jsonLen, o); o += 4;
  out.writeUInt32LE(CHUNK_JSON, o); o += 4;
  json.copy(out, o); o += json.length;
  // JSON chunk pads with spaces, binary with zeroes -- per the GLB spec.
  out.fill(0x20, o, o + jsonPad); o += jsonPad;

  if (bin.length) {
    out.writeUInt32LE(binLen, o); o += 4;
    out.writeUInt32LE(CHUNK_BIN, o); o += 4;
    bin.copy(out, o); o += bin.length;
    out.fill(0x00, o, o + binPad);
  }
  return out;
}

// --- main -------------------------------------------------------------------

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const src = arg("--src");
  const biome = arg("--biome", "kingdom");
  const dry = process.argv.includes("--dry");

  if (!src || !fs.existsSync(src)) {
    console.error(`--src must point at a directory of .gltf files (got ${src})`);
    process.exit(1);
  }

  const destDir = path.join(ROOT, "apps", "web", "public", "assets", "props", biome);
  const texDir = path.join(destDir, "textures");

  const all = (await fsp.readdir(src)).filter((f) => f.toLowerCase().endsWith(".gltf"));
  const picked = all.map((f) => path.basename(f, ".gltf")).filter(shouldImport).sort();

  // Stripping the category token can collide (SM_Bld_Wall_01 vs
  // SM_Prop_Wall_01). Keep the token on both sides when it does.
  const byTarget = new Map();
  for (const name of picked) {
    const t = targetName(name);
    (byTarget.get(t) ?? byTarget.set(t, []).get(t)).push(name);
  }
  const finalName = new Map();
  for (const [target, sources] of byTarget) {
    for (const s of sources) {
      finalName.set(
        s,
        sources.length === 1 ? target : `PP_${s.replace(/^SM_/, "").replace(/_Optimized$/, "")}`,
      );
    }
  }

  // Report by family so the selection is reviewable at a glance.
  const families = new Map();
  for (const name of picked) {
    const fam = (finalName.get(name) ?? "").replace(/^PP_/, "").replace(/_\d+[A-Za-z_]*$/, "");
    families.set(fam, (families.get(fam) ?? 0) + 1);
  }
  console.log(`Source models:  ${all.length}`);
  console.log(`Selected:       ${picked.length}`);
  console.log(`Families:       ${families.size}`);
  console.log(
    [...families.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([f, c]) => `  ${String(c).padStart(4)}  ${f}`)
      .join("\n"),
  );

  if (dry) {
    console.log("\n--dry: nothing written.");
    return;
  }

  await fsp.mkdir(destDir, { recursive: true });
  await fsp.mkdir(texDir, { recursive: true });

  let written = 0;
  let bytes = 0;
  const failures = [];
  /** Only atlases the selection actually reaches get copied. */
  const usedTextures = new Set();

  for (const name of picked) {
    try {
      const gltf = JSON.parse(await fsp.readFile(path.join(src, `${name}.gltf`), "utf8"));

      let bin = Buffer.alloc(0);
      const buf = gltf.buffers?.[0];
      if (buf?.uri) {
        if (buf.uri.startsWith("data:")) {
          bin = Buffer.from(buf.uri.slice(buf.uri.indexOf(",") + 1), "base64");
        } else {
          bin = await fsp.readFile(path.join(src, decodeURIComponent(buf.uri)));
        }
        // A GLB's buffer is the BIN chunk, identified by having no uri.
        delete buf.uri;
        buf.byteLength = bin.length;
      }

      // Image URIs stay relative and external so the atlas is shared. They
      // already read `textures/<file>.png`, which resolves correctly next to
      // the GLB in the biome directory.
      for (const img of gltf.images ?? []) {
        if (img.uri && !img.uri.startsWith("data:")) {
          const file = path.basename(decodeURIComponent(img.uri));
          img.uri = `textures/${file}`;
          usedTextures.add(file);
        }
      }

      const glb = packGlb(gltf, bin);
      const out = path.join(destDir, `${finalName.get(name)}.glb`);
      await fsp.writeFile(out, glb);
      written++;
      bytes += glb.length;
    } catch (err) {
      failures.push({ name, reason: err.message });
    }
  }

  // Copied after the fact: the kit ships atlases for categories we skip (a
  // 10 MB paintings sheet, dungeon walls), and nothing should carry those.
  const srcTex = path.join(src, "textures");
  let texBytes = 0;
  for (const file of usedTextures) {
    const from = path.join(srcTex, file);
    if (!fs.existsSync(from)) continue;
    await fsp.copyFile(from, path.join(texDir, file));
    texBytes += (await fsp.stat(from)).size;
  }

  console.log(`\nWrote ${written} GLBs (${(bytes / 1024 / 1024).toFixed(1)} MB) to assets/props/${biome}/`);
  console.log(
    `Copied ${usedTextures.size} referenced textures (${(texBytes / 1024 / 1024).toFixed(1)} MB) to assets/props/${biome}/textures/`,
  );
  if (failures.length) {
    console.log(`\n${failures.length} failed:`);
    for (const f of failures.slice(0, 20)) console.log(`  ${f.name}: ${f.reason}`);
  }
  console.log(`\nNext: pnpm gen:props`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
