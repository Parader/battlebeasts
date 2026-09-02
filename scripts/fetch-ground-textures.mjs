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
  "coast_sand_01",
  "snow_02",
  "forest_ground_04",
  "cobblestone_floor_08",
  "dry_ground_01",
  "aerial_rocks_02",
  "brown_mud_03",
  "dry_decay_leaves",
  "leafy_grass",
  "stony_dirt_path",
  "grey_stone_path",
  "burned_ground_01",
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
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
