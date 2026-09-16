/**
 * Fetch ground textures from Poly Haven (CC0) into apps/web/public/ground_textures.
 *
 * Colour and normal only, at 1k. The painted-ground shader samples nothing
 * else -- four layers of four maps overruns the guaranteed WebGL texture-unit
 * budget -- and the camera is far enough out that 2k buys only download size.
 *
 * Re-runnable: files already on disk are skipped, so adding a slug to the list
 * below and running again downloads just the new one.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT = "apps/web/public/ground_textures";
const RES = "1k";

/** Slugs to keep locally. Labels and tiling live in the shared catalog. */
const SLUGS = [
  "aerial_grass_rock",
  "aerial_rocks_02",
  "asphalt_02",
  "brick_pavement",
  "brown_mud_03",
  "brown_mud_leaves_01",
  "brown_mud_rocks_01",
  "burned_ground_01",
  "coast_sand_01",
  "coast_sand_04",
  "cobblestone_floor_08",
  "cobblestone_large_01",
  "concrete_pavement",
  "cracked_red_ground",
  "dirt_floor",
  "dry_decay_leaves",
  "dry_ground_01",
  "forest_ground_04",
  "forest_leaves_02",
  "forrest_ground_01",
  "forrest_ground_03",
  "grass_path_3",
  "gravel_ground_01",
  "gravelly_sand",
  "grey_stone_path",
  "hexagonal_concrete_paving",
  "leafy_grass",
  "mossy_cobblestone",
  "mossy_rock",
  "mud_cracked_dry_03",
  "pebble_ground_01",
  "red_mud_stones",
  "red_sand",
  "rocky_terrain_02",
  "rocky_trail",
  "sandy_gravel_02",
  "snow_01",
  "snow_02",
  "snow_03",
  "stone_tiles_03",
  "stony_dirt_path",
  "wood_chips",
];

/** The two maps we use, and the Poly Haven keys they live under. */
const MAPS = [
  { key: "Diffuse", suffix: "diff" },
  { key: "nor_gl", suffix: "nor_gl" },
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) console.warn(`  retry ${attempt} ${dest}: ${err.message}`);
    }
  }
  throw lastErr;
}

await mkdir(OUT, { recursive: true });

let fetched = 0;
let skipped = 0;

for (const slug of SLUGS) {
  let files;
  try {
    const res = await fetch(`https://api.polyhaven.com/files/${slug}`);
    if (!res.ok) throw new Error(String(res.status));
    files = await res.json();
  } catch (err) {
    console.warn(`! ${slug}: cannot read file list (${err.message})`);
    continue;
  }

  for (const { key, suffix } of MAPS) {
    const entry = files[key]?.[RES]?.jpg;
    if (!entry?.url) {
      console.warn(`! ${slug}: no ${RES} jpg for ${key}`);
      continue;
    }
    const dest = join(OUT, `${slug}_${suffix}_${RES}.jpg`);
    if (await exists(dest)) {
      skipped++;
      continue;
    }
    try {
      await download(entry.url, dest);
      fetched++;
      console.log(`  ${slug}_${suffix}_${RES}.jpg`);
    } catch (err) {
      console.warn(`! ${slug} ${suffix}: ${err.message}`);
    }
  }
}

console.log(`\ndownloaded ${fetched}, already present ${skipped}`);
