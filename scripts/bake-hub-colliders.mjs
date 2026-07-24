/**
 * Bake mesh-based XZ collision (occupancy grid + boundary segments)
 * from hub prop GLTFs into main_village.props.json.
 *
 * Uses the lower ~45% of mesh height so roofs/canopies don't block.
 * Collision is opt-in via Blender custom property `Collision`.
 *
 * Usage: node scripts/bake-hub-colliders.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

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

// GLTFLoader texture path expects a browser-like `self`
if (typeof globalThis.self === "undefined") {
  globalThis.self = globalThis;
}

import * as THREE from "../apps/web/node_modules/three/build/three.module.js";
import { GLTFLoader } from "../apps/web/node_modules/three/examples/jsm/loaders/GLTFLoader.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const propsPath = path.join(root, "packages/shared/src/maps/main_village.props.json");
const mapPath = path.join(root, "packages/shared/src/maps/main_village.map.json");
const assetsRoot = path.join(root, "apps/web/public/assets");

const FOOTPRINT_HEIGHT_FRAC = 0.45;
/** Local-space cell size for occupancy raster (meters at scale=1). */
const CELL = 0.06;
/** Dilate solid by this many cells so thin walls still register. */
const DILATE = 1;
/** Erode after dilate to tighten toward visible mesh (0 = keep dilate). */
const ERODE = 0;

const propsDoc = JSON.parse(readFileSync(propsPath, "utf8"));
const mapDoc = existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, "utf8")) : { objects: [] };

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_");
}

const collideById = new Map();
for (const o of mapDoc.objects ?? []) {
  const p = o.properties ?? {};
  let on = false;
  if ("Collision" in p) on = Boolean(p.Collision);
  else if ("collision" in p) on = Boolean(p.collision);
  collideById.set(sanitizeId(o.id), on);
  collideById.set(o.id, on);
}

const loader = new GLTFLoader();
const boundsCache = new Map();

function loadGltf(absFile) {
  const buf = readFileSync(absFile);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const base = pathToFileURL(path.dirname(absFile) + path.sep).href;
  return new Promise((resolve, reject) => {
    loader.parse(ab, base, resolve, reject);
  });
}

function packMask(cells) {
  const bytes = new Uint8Array(Math.ceil(cells.length / 8));
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) bytes[i >> 3] |= 1 << (i & 7);
  }
  return Buffer.from(bytes).toString("base64");
}

function morph(cells, cols, rows, solidNeighborMin) {
  const out = new Uint8Array(cells.length);
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      let n = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          if (cells[nz * cols + nx]) n++;
        }
      }
      const i = z * cols + x;
      if (solidNeighborMin > 0) {
        // dilate: empty → solid if enough solid neighbors
        out[i] = cells[i] || n >= solidNeighborMin ? 1 : 0;
      } else {
        // erode: solid → empty if too few solid neighbors
        out[i] = cells[i] && n >= 3 ? 1 : 0;
      }
    }
  }
  return out;
}

function extractSegments(cells, cols, rows, ox, oz, cell) {
  const segs = [];
  const key = (x0, z0, x1, z1) => `${x0},${z0},${x1},${z1}`;
  const seen = new Set();

  function addSeg(ax, az, bx, bz) {
    const k1 = key(ax, az, bx, bz);
    const k2 = key(bx, bz, ax, az);
    if (seen.has(k1) || seen.has(k2)) return;
    seen.add(k1);
    segs.push(ax, az, bx, bz);
  }

  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      if (!cells[z * cols + x]) continue;
      const x0 = ox + x * cell;
      const z0 = oz + z * cell;
      const x1 = x0 + cell;
      const z1 = z0 + cell;
      // edge if neighbor empty / OOB
      if (x === 0 || !cells[z * cols + (x - 1)]) addSeg(x0, z0, x0, z1);
      if (x === cols - 1 || !cells[z * cols + (x + 1)]) addSeg(x1, z0, x1, z1);
      if (z === 0 || !cells[(z - 1) * cols + x]) addSeg(x0, z0, x1, z0);
      if (z === rows - 1 || !cells[(z + 1) * cols + x]) addSeg(x0, z1, x1, z1);
    }
  }
  return segs.map((v) => Number(v.toFixed(4)));
}

function footprintFromScene(scene) {
  const rootObj = scene.clone(true);
  rootObj.updateMatrixWorld(true);

  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  rootObj.traverse((obj) => {
    const mesh = obj;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const pos = mesh.geometry.attributes.position;
    const m = mesh.matrixWorld;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
  });

  if (!Number.isFinite(minY) || !Number.isFinite(minX)) {
    return null;
  }

  const yCut = minY + Math.max(0.05, (maxY - minY) * FOOTPRINT_HEIGHT_FRAC);
  const pad = CELL * 2;
  const ox = minX - pad;
  const oz = minZ - pad;
  const cols = Math.max(4, Math.ceil((maxX - minX + pad * 2) / CELL));
  const rows = Math.max(4, Math.ceil((maxZ - minZ + pad * 2) / CELL));
  let cells = new Uint8Array(cols * rows);

  function stampTri(ax, az, bx, bz, cx, cz) {
    const triMinX = Math.min(ax, bx, cx);
    const triMaxX = Math.max(ax, bx, cx);
    const triMinZ = Math.min(az, bz, cz);
    const triMaxZ = Math.max(az, bz, cz);
    const x0 = Math.max(0, Math.floor((triMinX - ox) / CELL));
    const x1 = Math.min(cols - 1, Math.floor((triMaxX - ox) / CELL));
    const z0 = Math.max(0, Math.floor((triMinZ - oz) / CELL));
    const z1 = Math.min(rows - 1, Math.floor((triMaxZ - oz) / CELL));

    // barycentric coverage
    const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (Math.abs(area) < 1e-12) {
      // degenerate → stamp segment samples
      for (const [sx, sz] of [
        [ax, az],
        [bx, bz],
        [cx, cz],
      ]) {
        const ix = Math.floor((sx - ox) / CELL);
        const iz = Math.floor((sz - oz) / CELL);
        if (ix >= 0 && iz >= 0 && ix < cols && iz < rows) cells[iz * cols + ix] = 1;
      }
      return;
    }

    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const px = ox + (x + 0.5) * CELL;
        const pz = oz + (z + 0.5) * CELL;
        const w0 = ((bx - px) * (cz - pz) - (cx - px) * (bz - pz)) / area;
        const w1 = ((cx - px) * (az - pz) - (ax - px) * (cz - pz)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -0.05 && w1 >= -0.05 && w2 >= -0.05) {
          cells[z * cols + x] = 1;
        }
      }
    }
  }

  rootObj.traverse((obj) => {
    const mesh = obj;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    const m = mesh.matrixWorld;
    const index = geom.index;

    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      let i0;
      let i1;
      let i2;
      if (index) {
        i0 = index.getX(t * 3);
        i1 = index.getX(t * 3 + 1);
        i2 = index.getX(t * 3 + 2);
      } else {
        i0 = t * 3;
        i1 = t * 3 + 1;
        i2 = t * 3 + 2;
      }
      a.fromBufferAttribute(pos, i0).applyMatrix4(m);
      b.fromBufferAttribute(pos, i1).applyMatrix4(m);
      c.fromBufferAttribute(pos, i2).applyMatrix4(m);

      // Keep triangles that touch the footprint height band
      const triMinY = Math.min(a.y, b.y, c.y);
      const triMaxY = Math.max(a.y, b.y, c.y);
      if (triMaxY < minY - 0.01 || triMinY > yCut) continue;

      stampTri(a.x, a.z, b.x, b.z, c.x, c.z);
    }
  });

  for (let i = 0; i < DILATE; i++) cells = morph(cells, cols, rows, 1);
  for (let i = 0; i < ERODE; i++) cells = morph(cells, cols, rows, 0);

  let solid = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i]) solid++;
  if (solid === 0) return null;

  const segs = extractSegments(cells, cols, rows, ox, oz, CELL);
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const hx = Math.max(CELL, (maxX - minX) * 0.5 + pad);
  const hz = Math.max(CELL, (maxZ - minZ) * 0.5 + pad);

  return {
    ox: Number(ox.toFixed(4)),
    oz: Number(oz.toFixed(4)),
    cell: CELL,
    cols,
    rows,
    mask: packMask(cells),
    segs,
    // broadphase AABB (local)
    cx: Number(cx.toFixed(4)),
    cz: Number(cz.toFixed(4)),
    hx: Number(hx.toFixed(4)),
    hz: Number(hz.toFixed(4)),
  };
}

async function boundsForFile(relFile) {
  if (boundsCache.has(relFile)) return boundsCache.get(relFile);
  const abs = path.join(assetsRoot, relFile);
  if (!existsSync(abs)) {
    console.warn("missing asset", relFile);
    boundsCache.set(relFile, null);
    return null;
  }
  const gltf = await loadGltf(abs);
  const b = footprintFromScene(gltf.scene);
  boundsCache.set(relFile, b);
  const segN = b ? b.segs.length / 4 : 0;
  console.log(relFile, b ? `${b.cols}x${b.rows} segs=${segN} solid~grid` : "empty");
  return b;
}

const uniqueFiles = [...new Set(propsDoc.props.map((p) => p.file))];
for (const f of uniqueFiles) {
  await boundsForFile(f);
}

let solidProps = 0;
for (const p of propsDoc.props) {
  const fromMap = collideById.get(p.id);
  const wants =
    fromMap === true ||
    (fromMap !== false && ((p.collideRadius ?? 0) > 0 || Boolean(p.box) || Boolean(p.mesh)));
  delete p.collideRadius;
  delete p.box;
  if (wants) {
    const b = boundsCache.get(p.file);
    if (b) {
      p.mesh = b;
      solidProps++;
    } else {
      delete p.mesh;
    }
  } else {
    delete p.mesh;
  }
}

propsDoc.colliderSource = "mesh-occupancy";
propsDoc.footprintHeightFrac = FOOTPRINT_HEIGHT_FRAC;
propsDoc.cell = CELL;

writeFileSync(propsPath, JSON.stringify(propsDoc, null, 2) + "\n");
console.log("updated", propsPath, "solid props", solidProps, "assets", boundsCache.size);
