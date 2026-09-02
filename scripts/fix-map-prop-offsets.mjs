import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Repairs prop colliders in maps authored before colliders could be offset.
 *
 * Those placements were saved with a collider pinned to the prop's origin. For
 * the ~70% of kit models that are not built around their own pivot that origin
 * is not where the mesh is, so the collider sits beside the building rather
 * than under it.
 *
 * The stored position is deliberately left alone. It is the group transform,
 * and the mesh already renders at `position + centre` -- so the layout you
 * arranged on screen is exactly what you keep. Only the collider moves, onto
 * the geometry it was always meant to be on.
 *
 * Run with --write to apply; the default is a dry run.
 */

const WRITE = process.argv.includes("--write");

const manifest = JSON.parse(
  await fsp.readFile(path.join(ROOT, "data", "props.manifest.json"), "utf8"),
);
const byKey = new Map(manifest.props.map((p) => [p.key, p]));

async function findMaps(dir, out = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await findMaps(full, out);
    else if (e.name.endsWith(".map.json")) out.push(full);
  }
  return out;
}

/** Collider offset the current manifest would fit to this prop. */
function fittedOffset(entry) {
  const c = entry.defaultCollider;
  if (c.mode === "none") return null;
  return { offsetX: c.offsetX ?? 0, offsetZ: c.offsetZ ?? 0 };
}

let totalChanged = 0;
for (const file of await findMaps(ROOT)) {
  const raw = await fsp.readFile(file, "utf8");
  const doc = JSON.parse(raw);
  if (!Array.isArray(doc.props)) continue;

  const changed = [];
  for (const p of doc.props) {
    if (!p.collider || p.collider.mode === "none") continue;
    const entry = byKey.get(p.prop);
    if (!entry) {
      changed.push(`  ? ${p.id} ${p.prop} -- not in manifest, left alone`);
      continue;
    }
    const fitted = fittedOffset(entry);
    if (!fitted) continue;

    const have = { offsetX: p.collider.offsetX ?? 0, offsetZ: p.collider.offsetZ ?? 0 };
    // Only touch placements still pinned to the origin. A nonzero offset means
    // it was either placed after the fix or hand-tuned in the Inspector, and
    // either way it is not ours to overwrite.
    if (have.offsetX !== 0 || have.offsetZ !== 0) continue;
    if (fitted.offsetX === 0 && fitted.offsetZ === 0) continue;

    if (fitted.offsetX !== 0) p.collider.offsetX = fitted.offsetX;
    if (fitted.offsetZ !== 0) p.collider.offsetZ = fitted.offsetZ;

    const dist = Math.hypot(fitted.offsetX, fitted.offsetZ);
    changed.push(`  + ${p.id} ${p.prop} -- collider moved ${dist.toFixed(2)} m onto the mesh`);
  }

  if (!changed.length) continue;
  totalChanged += changed.length;
  console.log(`${path.relative(ROOT, file)}  (${changed.length})`);
  for (const line of changed) console.log(line);
  if (WRITE) await fsp.writeFile(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

if (!totalChanged) console.log("nothing to repair");
else if (WRITE) console.log(`\nrepaired ${totalChanged} placement(s)`);
else console.log(`\n${totalChanged} placement(s) would change -- re-run with --write`);
