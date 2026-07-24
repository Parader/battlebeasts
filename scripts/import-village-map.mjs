import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

const root = process.cwd();
const mapPath = "c:/Users/deric/Downloads/assets/map.json";
const mapsDir = path.join(root, "packages/shared/src/maps");
mkdirSync(mapsDir, { recursive: true });

const map = JSON.parse(readFileSync(mapPath, "utf8"));
copyFileSync(mapPath, path.join(mapsDir, "main_village.map.json"));

const ASSET_RADIUS = {
  // Legacy circle fallbacks — prefer `node scripts/bake-hub-colliders.mjs`
  // after import to replace radii with mesh XZ boxes.
  "Barracks_SecondAge_Level2.gltf": 0.72,
  "Houses_SecondAge_2_Level1.gltf": 0.45,
  "Houses_SecondAge_3_Level3.gltf": 0.65,
  "modified/stand3.glb": 0.85,
  "Temple_SecondAge_Level1.gltf": 0.85,
  "TownCenter_SecondAge_Level3.gltf": 0.8,
  "Resource_Tree1.gltf": 0.35,
  "Resource_Tree2.gltf": 0.32,
  "Resource_PineTree_Group.gltf": 0.7,
  "Rock_Group.gltf": 0.65,
  "WallTowers_SecondAge.gltf": 0.55,
  "Mountain_Group_1.gltf": 1.9,
  "Mountain_Group_2.gltf": 1.5,
  "Crate_Big_Stack2.gltf": 0.18,
  "WatchTower_SecondAge_Level2.gltf": 0.4,
  "Resource_PineTree_Group_Cut.gltf": 0.6,
  "Mine.gltf": 0.6,
  "Barrel.gltf": 0.12,
  "WallTowers_Door_SecondAge.gltf": 0.55,
  "Windmill_SecondAge.gltf": 0.6,
  "Farm_SecondAge_Level2_Wheat.gltf": 0.55,
  "Farm_SecondAge_Level3.gltf": 0.85,
};

function baseId(id) {
  return id.replace(/\.\d{3}$/, "");
}

function resolveFile(id) {
  if (id === "Portal PVP") return null;
  const base = baseId(id);
  const assets = path.join(root, "apps/web/public/assets/fantasy_rts");
  if (base.startsWith("modified_")) {
    const name = base.slice("modified_".length);
    for (const ext of [".glb", ".gltf"]) {
      const rel = `modified/${name}${ext}`;
      if (existsSync(path.join(assets, rel))) return rel;
    }
  }
  for (const ext of [".gltf", ".glb"]) {
    const rel = `${base}${ext}`;
    if (existsSync(path.join(assets, rel))) return rel;
  }
  return null;
}

function yawFromQuat(q) {
  const { x, y, z, w } = q;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
}

/** Blender custom property `Collision` is the opt-in. Ignore exporter `collision.enabled` (always true). */
function wantsCollision(o) {
  const p = o.properties ?? {};
  if ("Collision" in p) return Boolean(p.Collision);
  if ("collision" in p) return Boolean(p.collision);
  return false;
}

const props = [];
const skipped = [];
for (const o of map.objects) {
  const file = resolveFile(o.id);
  if (!file) {
    skipped.push(o.id);
    continue;
  }
  const yaw = yawFromQuat(o.transform.rotation);
  const s = o.transform.scale.x;
  const baseR = ASSET_RADIUS[file] ?? 0.5;
  const collide = wantsCollision(o) ? Number((baseR * s).toFixed(3)) : 0;
  props.push({
    id: o.id.replace(/[^a-zA-Z0-9_]/g, "_"),
    file,
    x: Number(o.transform.position.x.toFixed(4)),
    z: Number(o.transform.position.z.toFixed(4)),
    scale: Number(s.toFixed(5)),
    rotationY: Number(yaw.toFixed(5)),
    collideRadius: collide,
  });
}

writeFileSync(
  path.join(mapsDir, "main_village.props.json"),
  JSON.stringify({ version: 1, source: map.source ?? "main_village.blend", props }, null, 2),
);

console.log("props", props.length, "skipped", skipped);
console.log("Next: node scripts/bake-hub-colliders.mjs  (mesh OBB footprints)");
