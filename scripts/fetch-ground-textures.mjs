/**
 * Fetch ground textures into apps/web/public/ground_textures.
 *
 * Colour and normal only, at 1k. The painted-ground shader samples nothing
 * else -- four layers of four maps overruns the guaranteed WebGL texture-unit
 * budget -- and the camera is far enough out that 2k buys only download size.
 *
 * Sources:
 *   - Poly Haven (CC0): direct JPG URLs via their files API
 *   - ambientCG (CC0): 1K-JPG zip, then Color + NormalGL extracted
 *
 * FreePBR is skipped on purpose: free downloads there are personal-use only.
 *
 * Re-runnable: files already on disk are skipped, so adding a slug / asset id
 * below and running again downloads just the new ones.
 */
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const OUT = "apps/web/public/ground_textures";
const RES = "1k";

/** Poly Haven texture slugs. Labels and tiling live in the shared catalog. */
const POLY_HAVEN = [
  "aerial_grass_rock",
  "aerial_mud_1",
  "aerial_rocks_02",
  "aerial_rocks_04",
  "aerial_sand",
  "asphalt_02",
  "brick_pavement",
  "brown_mud_03",
  "brown_mud_dry",
  "brown_mud_leaves_01",
  "brown_mud_rocks_01",
  "burned_ground_01",
  "clean_pebbles",
  "coast_sand_01",
  "coast_sand_02",
  "coast_sand_03",
  "coast_sand_04",
  "cobblestone_floor_08",
  "cobblestone_large_01",
  "concrete_pavement",
  "coral_gravel",
  "cracked_red_ground",
  "damp_beach_sand",
  "dense_sand",
  "dirt",
  "dirt_floor",
  "dry_decay_leaves",
  "dry_ground_01",
  "dry_ground_rocks",
  "dry_mud_field_001",
  "dry_riverbed_rock",
  "farm_soil",
  "forest_floor",
  "forest_ground_04",
  "forest_ground_05",
  "forest_leaves_02",
  "forrest_ground_01",
  "forrest_ground_03",
  "grass_ground",
  "grass_path_3",
  "gravel_floor",
  "gravel_ground_01",
  "gravelly_sand",
  "gray_rocks",
  "grey_stone_path",
  "hexagonal_concrete_paving",
  "leafy_grass",
  "leaves_forest_ground",
  "mossy_cobblestone",
  "mossy_rock",
  "mud_cracked_dry_03",
  "muddy_tracks",
  "park_dirt",
  "pebble_ground_01",
  "playground_sand",
  "raked_dirt",
  "red_dirt_mud_01",
  "red_laterite_soil_stones",
  "red_mud_stones",
  "red_sand",
  "rock_ground",
  "rock_pitted_mossy",
  "rocks_ground_02",
  "rocks_ground_04",
  "rocky_gravel",
  "rocky_terrain_02",
  "rocky_terrain_03",
  "rocky_trail",
  "sand_01",
  "sand_02",
  "sandy_gravel_02",
  "snow_01",
  "snow_02",
  "snow_03",
  "snow_04",
  "snow_05",
  "snow_field_aerial",
  "snow_floor",
  "sparse_grass",
  "stone_tiles_03",
  "stony_dirt_path",
  "withered_grass",
  "wood_chips",
];

/**
 * ambientCG asset ids (CC0). Downloaded as 1K-JPG zips; Color + NormalGL are
 * copied out under acg_{id}_diff/nor_gl_1k.jpg.
 */
const AMBIENT_CG = [
  "Grass001",
  "Grass002",
  "Grass005",
  "Grass006",
  "Moss001",
  "Moss002",
  "Moss003",
  "Snow006",
  "Snow008A",
  "Snow010A",
  "Snow012",
  "Snow015",
  "Ground054",
  "Ground080",
  "Ground093A",
  "Ground093C",
  "Ground095A",
  "Ground097",
  "Ground098",
  "Ground102",
  "Ground106",
  "Ground109",
  "Ground110",
  "Gravel022",
  "Gravel023",
  "Gravel026",
  "Gravel040",
  "Rock029",
];

const POLY_MAPS = [
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
      const res = await fetch(url, {
        signal: AbortSignal.timeout(120_000),
        redirect: "follow",
        headers: { "user-agent": "battlebeasts-ground-fetch/1.0" },
      });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) console.warn(`  retry ${attempt} ${basename(dest)}: ${err.message}`);
    }
  }
  throw lastErr;
}

/** Extract a zip with the OS tar (Windows 10+, macOS, Linux all ship one). */
async function extractZip(zipPath, destDir) {
  await mkdir(destDir, { recursive: true });
  await execFileAsync("tar", ["-xf", zipPath, "-C", destDir]);
}

async function fetchPolyHaven(slug, counters) {
  let files;
  try {
    const res = await fetch(`https://api.polyhaven.com/files/${slug}`);
    if (!res.ok) throw new Error(String(res.status));
    files = await res.json();
  } catch (err) {
    console.warn(`! polyhaven ${slug}: cannot read file list (${err.message})`);
    return;
  }

  for (const { key, suffix } of POLY_MAPS) {
    const entry = files[key]?.[RES]?.jpg;
    if (!entry?.url) {
      console.warn(`! polyhaven ${slug}: no ${RES} jpg for ${key}`);
      continue;
    }
    const dest = join(OUT, `${slug}_${suffix}_${RES}.jpg`);
    if (await exists(dest)) {
      counters.skipped++;
      continue;
    }
    try {
      await download(entry.url, dest);
      counters.fetched++;
      console.log(`  ph ${slug}_${suffix}_${RES}.jpg`);
    } catch (err) {
      console.warn(`! polyhaven ${slug} ${suffix}: ${err.message}`);
    }
  }
}

async function fetchAmbientCg(assetId, counters) {
  const slug = assetId.toLowerCase();
  const diffDest = join(OUT, `acg_${slug}_diff_${RES}.jpg`);
  const norDest = join(OUT, `acg_${slug}_nor_gl_${RES}.jpg`);
  if ((await exists(diffDest)) && (await exists(norDest))) {
    counters.skipped += 2;
    return;
  }

  const zipUrl = `https://ambientcg.com/get?file=${assetId}_1K-JPG.zip`;
  const work = await mkdtemp(join(tmpdir(), "acg-"));
  const zipPath = join(work, `${assetId}.zip`);
  try {
    await download(zipUrl, zipPath);
    const unpacked = join(work, "out");
    await extractZip(zipPath, unpacked);

    const colorName = `${assetId}_1K-JPG_Color.jpg`;
    const norName = `${assetId}_1K-JPG_NormalGL.jpg`;
    const colorSrc = join(unpacked, colorName);
    const norSrc = join(unpacked, norName);

    if (!(await exists(colorSrc)) || !(await exists(norSrc))) {
      // Some packs nest files; search one level deep.
      const { stdout } = await execFileAsync(
        process.platform === "win32" ? "cmd" : "sh",
        process.platform === "win32"
          ? ["/c", `dir /s /b "${unpacked}"`]
          : ["-c", `find "${unpacked}" -type f`],
      );
      console.warn(`! ambientcg ${assetId}: expected ${colorName} / ${norName}`);
      console.warn(`  found:\n${stdout}`);
      return;
    }

    if (!(await exists(diffDest))) {
      await rename(colorSrc, diffDest);
      counters.fetched++;
      console.log(`  acg acg_${slug}_diff_${RES}.jpg`);
    } else {
      counters.skipped++;
    }
    if (!(await exists(norDest))) {
      // Color may already have been moved; re-read nor from unpacked if needed.
      const norStill = (await exists(norSrc)) ? norSrc : join(unpacked, norName);
      await rename(norStill, norDest);
      counters.fetched++;
      console.log(`  acg acg_${slug}_nor_gl_${RES}.jpg`);
    } else {
      counters.skipped++;
    }
  } catch (err) {
    console.warn(`! ambientcg ${assetId}: ${err.message}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await mkdir(OUT, { recursive: true });

const counters = { fetched: 0, skipped: 0 };

console.log(`Poly Haven (${POLY_HAVEN.length})…`);
for (const slug of POLY_HAVEN) {
  await fetchPolyHaven(slug, counters);
}

console.log(`\nambientCG (${AMBIENT_CG.length})…`);
for (const id of AMBIENT_CG) {
  await fetchAmbientCg(id, counters);
}

console.log(`\ndownloaded ${counters.fetched}, already present ${counters.skipped}`);
