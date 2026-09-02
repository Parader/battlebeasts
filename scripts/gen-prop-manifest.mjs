#!/usr/bin/env node
/**
 * Generate packages/shared/src/maps/props.manifest.json from the prop library.
 *
 * Bounds are world-space: the kit's meshes are Z-up centimetres and only the
 * root node transform (a +90deg X rotation plus 0.01 scale) makes them Y-up
 * metres. Reading accessor min/max directly would report PP_Fir_Tree_01 as
 * 3.03 m tall with a 3.23 x 5.64 m footprint instead of 5.64 m tall with a
 * 3.23 x 3.03 m footprint -- wrong axis, wrong collider, everywhere.
 *
 * Colliders are fitted to a BASE SLICE, not the bounding box. A fir tree's
 * bbox is its canopy: fitting that gives a 1.56 m radius and players stop
 * 1.5 m short of the trunk. Measuring only vertices within the lowest slice
 * of the model gives the trunk footprint (~0.2 m) instead. This means
 * decoding POSITION data rather than reading accessor min/max, which is why
 * the run takes tens of seconds rather than five.
 *
 * Usage: node scripts/gen-prop-manifest.mjs [--force]
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROPS_DIR = path.join(ROOT, "apps", "web", "public", "assets", "props");
/**
 * Authoring-time artifact, deliberately NOT inside packages/shared: that
 * package's index.ts is an `export *` barrel the web client imports, so a
 * 1.2 MB manifest there would ship to every player. Only the editor and the
 * build-prune step read this. Map documents bake their resolved colliders at
 * save time, so nothing at runtime needs the manifest.
 */
const OUT_FILE = path.join(ROOT, "data", "props.manifest.json");
const CACHE_FILE = path.join(ROOT, "node_modules", ".cache", "bb-props", "manifest-cache.json");
const FORCE = process.argv.includes("--force");

/**
 * Manifest schema version. Bump to invalidate every cache entry.
 *
 * 3: model centre (`centreX`/`centreZ`) that the editor plants at, plus a
 *    collider `offsetX`/`offsetZ` measured from it, so models authored away
 *    from their own pivot land under the cursor with the collider on them.
 * 4: collider offsets re-based from the model ORIGIN to the model CENTRE, to
 *    match placements now storing the centre as their position.
 */
const MANIFEST_VERSION = 4;

/**
 * Families hidden from the palette: flat ground tiles, superseded by the
 * editor's painted ground. Exact family matches only -- `Forest_Ground_Stones`
 * and `Desert_Ground_Stones` are scatter detail and stay visible.
 */
const HIDDEN_FAMILIES = new Set([
  "Lava_Ground",
  "Forest_Ground",
  "Arctic_Ground",
  "Ice_Ground",
  "Lake_Ground",
  "Sandstone_Ground",
]);

/** Families that should never collide by default (scatter detail underfoot). */
const NON_COLLIDING = /(^|_)(Grass|Dandelion|Flower|Clover|Pebbles?|Leaf|Leaves|Moss|Path|Puddle|Decal|Ground_Stones|Snowdrift)(_|$)/i;

// --- glTF math (column-major mat4, matching the glTF node convention) -------

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function compose(t, r, s) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  return compose(
    node.translation ?? [0, 0, 0],
    node.rotation ?? [0, 0, 0, 1],
    node.scale ?? [1, 1, 1],
  );
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// --- GLB reading ------------------------------------------------------------

/** Read a .glb into its JSON chunk plus a view over the BIN chunk. */
async function readGlb(file) {
  const buf = await fsp.readFile(file);
  if (buf.length < 20) throw new Error("truncated GLB");
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB (bad magic)");
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error("first chunk is not JSON");
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));

  let bin = null;
  let off = 20 + jsonLen;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x004e4942) {
      bin = buf.subarray(off + 8, off + 8 + len);
      break;
    }
    off += 8 + len;
  }
  return { gltf, bin };
}

/** Decode a FLOAT VEC3 accessor into a flat [x,y,z,...] array. */
function readVec3Accessor(gltf, bin, index) {
  const acc = gltf.accessors?.[index];
  if (!acc || acc.type !== "VEC3" || acc.componentType !== 5126) return null;
  if (acc.sparse) return null; // vanishingly rare in this kit; bbox fallback covers it
  const view = gltf.bufferViews?.[acc.bufferView];
  if (!view || !bin) return null;

  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;
  const out = new Float64Array(acc.count * 3);
  for (let i = 0; i < acc.count; i++) {
    const p = base + i * stride;
    if (p + 12 > bin.length) return null;
    out[i * 3] = bin.readFloatLE(p);
    out[i * 3 + 1] = bin.readFloatLE(p + 4);
    out[i * 3 + 2] = bin.readFloatLE(p + 8);
  }
  return out;
}

/**
 * Walk the node hierarchy and gather every mesh vertex in world space, so we
 * can measure both the full AABB and the base-slice footprint.
 *
 * Falls back to corner-transforming each primitive's accessor AABB when
 * positions cannot be decoded. Corner transforms are exact for the
 * axis-aligned 90deg rotations this kit uses and conservative otherwise.
 */
function collectWorldVerts(gltf, bin) {
  const verts = [];
  const nodes = gltf.nodes ?? [];
  const meshes = gltf.meshes ?? [];
  const accessors = gltf.accessors ?? [];
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  const stack = new Set();
  let approximated = false;

  const visit = (index, parent) => {
    if (stack.has(index)) return; // cycle guard on malformed files
    stack.add(index);
    const node = nodes[index];
    if (!node) return;
    const world = multiply(parent, nodeMatrix(node));

    if (node.mesh != null) {
      for (const prim of meshes[node.mesh]?.primitives ?? []) {
        const accIndex = prim.attributes?.POSITION;
        const acc = accessors[accIndex];
        if (acc == null) continue;

        const pos = readVec3Accessor(gltf, bin, accIndex);
        if (pos) {
          for (let i = 0; i < pos.length; i += 3) {
            verts.push(transformPoint(world, pos[i], pos[i + 1], pos[i + 2]));
          }
        } else if (acc.min && acc.max) {
          approximated = true;
          for (let corner = 0; corner < 8; corner++) {
            verts.push(
              transformPoint(
                world,
                corner & 1 ? acc.max[0] : acc.min[0],
                corner & 2 ? acc.max[1] : acc.min[1],
                corner & 4 ? acc.max[2] : acc.min[2],
              ),
            );
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
    stack.delete(index);
  };

  for (const root of roots) visit(root, identity());
  return { verts, approximated };
}

/**
 * Fraction of total height treated as "the base" when fitting a collider.
 * Small enough to isolate a tree trunk, large enough that a squat rock still
 * measures its true width.
 */
const BASE_SLICE_FRACTION = 0.15;
const BASE_SLICE_MIN_M = 0.2;

/** World AABB plus the XZ footprint of the model's lowest slice. */
function measure(verts) {
  if (!verts.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of verts) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }

  const height = max[1] - min[1];
  const cut = min[1] + Math.max(BASE_SLICE_MIN_M, height * BASE_SLICE_FRACTION);

  let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
  let count = 0;
  for (const p of verts) {
    if (p[1] > cut) continue;
    count++;
    if (p[0] < bMinX) bMinX = p[0];
    if (p[0] > bMaxX) bMaxX = p[0];
    if (p[2] < bMinZ) bMinZ = p[2];
    if (p[2] > bMaxZ) bMaxZ = p[2];
  }
  // Degenerate slice (e.g. a floating prop): fall back to the full footprint.
  if (count < 3) {
    bMinX = min[0]; bMaxX = max[0]; bMinZ = min[2]; bMaxZ = max[2];
  }

  return {
    min,
    max,
    base: { minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ },
  };
}

// --- Derivation -------------------------------------------------------------

const round = (v, p = 3) => Number(v.toFixed(p));

/** Midpoint of a span, snapped to zero below a centimetre. */
const centre = (lo, hi) => {
  const c = round((lo + hi) / 2);
  return Math.abs(c) < 0.01 ? 0 : c;
};

/** `PP_Fir_Tree_17` -> { family: "Fir_Tree", variant: 17 } */
function parseName(baseName) {
  const stripped = baseName.replace(/^PP_/, "");
  const m = /^(.*?)_(\d+)$/.exec(stripped);
  if (m) return { family: m[1], variant: Number(m[2]) };
  return { family: stripped, variant: 1 };
}

/** Palette label. Custom kit folders prefix the biome so they are easy to find. */
function formatPropLabel(biome, family) {
  const name = family.replace(/_/g, " ");
  return biome === "meshy" ? `meshy - ${name}` : name;
}

/**
 * Anything larger than this is scenery (mountains, flying islands) rather than
 * an obstacle. Auto-fitting a collider to a 62 m flying island would wall off
 * a whole map, so these default to none and get blocked with walls instead.
 */
const SCENERY_HALF_EXTENT_M = 8;
const SCENERY_HEIGHT_M = 15;

/**
 * Fit a default collider to the BASE footprint, not the bounding box, so a
 * tree collides at its trunk rather than its canopy. Roughly-square bases get
 * a circle (cheapest to test), elongated ones a box, and anything flat, tiny,
 * scenery-scale, or in a scatter-detail family gets none.
 */
function inferCollider(family, base, full, height) {
  if (NON_COLLIDING.test(family)) return { mode: "none" };
  if (height < 0.2) return { mode: "none" };
  if (Math.max(full.hx, full.hz) > SCENERY_HALF_EXTENT_M) return { mode: "none" };
  if (height > SCENERY_HEIGHT_M) return { mode: "none" };
  if (base.hx < 0.1 && base.hz < 0.1) return { mode: "none" };

  // Where the base slice sits relative to the model's CENTRE, because that is
  // what a placement's position now refers to: the renderer subtracts the
  // pivot, so `x`/`z` is the centre of the visible model and a collider offset
  // measured from the origin would miss by however far the origin is from it.
  //
  // Usually small -- a tree's trunk is near the middle of its canopy -- and
  // large for asymmetric pieces like an L-shaped house, which is exactly the
  // case that used to need hand-nudging.
  const ox = round(base.cx - full.cx);
  const oz = round(base.cz - full.cz);
  const offset = {
    ...(ox !== 0 ? { offsetX: ox } : {}),
    ...(oz !== 0 ? { offsetZ: oz } : {}),
  };

  const aspect = Math.max(base.hx, base.hz) / Math.max(1e-4, Math.min(base.hx, base.hz));
  if (aspect <= 1.35) {
    return { mode: "circle", radius: round((base.hx + base.hz) / 2), ...offset };
  }
  return { mode: "box", halfX: round(base.hx), halfZ: round(base.hz), yaw: 0, ...offset };
}

async function walk(dir) {
  const out = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".glb")) out.push(full);
  }
  return out;
}

async function loadCache() {
  if (FORCE) return {};
  try {
    const raw = JSON.parse(await fsp.readFile(CACHE_FILE, "utf8"));
    return raw.manifestVersion === MANIFEST_VERSION ? raw.entries ?? {} : {};
  } catch {
    return {};
  }
}

async function main() {
  if (!fs.existsSync(PROPS_DIR)) {
    console.error(`No prop directory at ${PROPS_DIR}`);
    process.exit(1);
  }

  const files = (await walk(PROPS_DIR)).sort();
  const cache = await loadCache();
  const nextCache = {};
  const props = [];
  const failures = [];
  let reused = 0;

  for (const file of files) {
    const rel = path.relative(PROPS_DIR, file).split(path.sep).join("/");
    const stat = await fsp.stat(file);
    const stamp = `${stat.size}:${Math.floor(stat.mtimeMs)}`;

    const cached = cache[rel];
    if (cached && cached.stamp === stamp) {
      const biome = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "misc";
      const entry = { ...cached.entry, label: formatPropLabel(biome, cached.entry.family) };
      nextCache[rel] = { stamp, entry };
      props.push(entry);
      reused++;
      continue;
    }

    let m;
    let approximated = false;
    try {
      const { gltf, bin } = await readGlb(file);
      const collected = collectWorldVerts(gltf, bin);
      approximated = collected.approximated;
      m = measure(collected.verts);
    } catch (err) {
      failures.push({ rel, reason: err.message });
      continue;
    }
    if (!m) {
      failures.push({ rel, reason: "no decodable geometry" });
      continue;
    }

    const biome = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "misc";
    const baseName = path.basename(file, ".glb");
    const { family, variant } = parseName(baseName);

    const full = {
      hx: (m.max[0] - m.min[0]) / 2,
      hz: (m.max[2] - m.min[2]) / 2,
      // Centre of the whole model. This is the anchor the editor plants at, so
      // whatever you are placing appears under the cursor. Deliberately not
      // the base slice: for a roof section or wall segment the lowest slice is
      // a thin edge metres from the mass, and anchoring there would drop the
      // piece well away from where you clicked.
      cx: centre(m.min[0], m.max[0]),
      cz: centre(m.min[2], m.max[2]),
    };
    const base = {
      hx: (m.base.maxX - m.base.minX) / 2,
      hz: (m.base.maxZ - m.base.minZ) / 2,
      // Centre of the base slice relative to the prop origin. Nonzero whenever
      // the model is not built around its own pivot. Quantised once, here, so
      // the placement shift and the collider offset are literally the same
      // number downstream; sub-centimetre centres are modelling noise and
      // become an exact zero rather than a value the two could disagree on.
      cx: centre(m.base.minX, m.base.maxX),
      cz: centre(m.base.minZ, m.base.maxZ),
    };

    const height = m.max[1] - m.min[1];

    const entry = {
      key: `${biome}/${baseName}`,
      url: `/assets/props/${rel}`,
      biome,
      family,
      label: formatPropLabel(biome, family),
      variant,
      bounds: {
        // Full extents: used for palette size display and scenery detection.
        hx: round(full.hx),
        hz: round(full.hz),
        height: round(height),
        // Distance from the prop origin to its lowest point. ~0 means the
        // origin already sits at the base; the editor offsets by -baseY when
        // planting so props with a centred origin still land on the ground.
        baseY: round(m.min[1]),
        // Footprint of the lowest slice -- what colliders are fitted to.
        baseHx: round(base.hx),
        baseHz: round(base.hz),
        // Offset from the prop's origin to the centre of the whole model. The
        // editor subtracts this when placing, so a model that was authored
        // away from its own pivot still lands under the cursor.
        centreX: full.cx,
        centreZ: full.cz,
        // Centre of the base slice, from the same origin. This is what the
        // collider offset is set to; kept here so the two can be checked
        // against each other.
        baseCx: base.cx,
        baseCz: base.cz,
      },
      defaultCollider: inferCollider(family, base, full, height),
      hidden: HIDDEN_FAMILIES.has(family),
      ...(approximated ? { approxBounds: true } : {}),
    };

    props.push(entry);
    nextCache[rel] = { stamp, entry };
  }

  props.sort((a, b) => a.key.localeCompare(b.key));

  const manifest = {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    // Lets the editor detect a stale manifest without re-reading every GLB.
    sourceHash: createHash("sha1").update(props.map((p) => p.key).join("\n")).digest("hex").slice(0, 12),
    props,
  };

  await fsp.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fsp.writeFile(OUT_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fsp.writeFile(
    CACHE_FILE,
    JSON.stringify({ manifestVersion: MANIFEST_VERSION, entries: nextCache }),
    "utf8",
  );

  const families = new Set(props.map((p) => p.family));
  const collide = props.filter((p) => p.defaultCollider.mode !== "none").length;
  const hidden = props.filter((p) => p.hidden).length;

  console.log(`props        ${props.length} (${reused} cached, ${props.length - reused} parsed)`);
  console.log(`families     ${families.size}`);
  console.log(`colliding    ${collide}  (${props.length - collide} non-colliding by default)`);
  console.log(`hidden       ${hidden}`);
  console.log(`written      ${path.relative(ROOT, OUT_FILE)}`);
  if (failures.length) {
    console.warn(`\n${failures.length} file(s) failed:`);
    for (const f of failures.slice(0, 20)) console.warn(`  ${f.rel}: ${f.reason}`);
    if (failures.length > 20) console.warn(`  ... and ${failures.length - 20} more`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
