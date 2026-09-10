import type { CircleCollider, StaticCollider, WallCollider } from "./collision";
import desertMarkers from "./maps/desert.markers.json";
import desertWalls from "./maps/desert.walls.json";

/** Desert arena visual (Blender export). Cache-bust on re-export. */
export const ARENA_SCENE_URL = `/assets/maps/desert.glb?v=${encodeURIComponent(
  (desertMarkers as { exportedAt?: string }).exportedAt ?? "1",
)}`;

/**
 * Same authoring scale family as the village hub.
 * Spawns authored ~±70 Blender units → ~±14 world after scale.
 */
export const ARENA_SCENE_SCALE = 0.2;

type MarkerDoc = {
  version?: number;
  exportedAt?: string;
  markers?: Array<{
    id: string;
    kind: string;
    x: number;
    z: number;
    rotationY?: number;
    label?: string | null;
  }>;
};

type WallsDoc = {
  version?: number;
  walls?: Array<{
    id: string;
    segs: number[];
  }>;
};

const markersDoc = desertMarkers as MarkerDoc;
const wallsDoc = desertWalls as WallsDoc;
const S = ARENA_SCENE_SCALE;

function sx(v: number) {
  return v * S;
}

export type ArenaSpawnPose = {
  index: number;
  team: "a" | "b" | "c";
  x: number;
  z: number;
  yaw: number;
};

function parseSpawnTeam(kind: string): { team: "a" | "b" | "c"; index: number } | null {
  const k = kind.trim().toLowerCase().replace(/-/g, "_");
  const named = /^(?:spawn_|team_|t)?([abc])$/.exec(k);
  if (named) return { team: named[1] as "a" | "b" | "c", index: named[1].charCodeAt(0) };
  const num = /^spawn_(\d+)$/.exec(k);
  if (!num) return null;
  const index = Number(num[1]);
  if (index >= 1 && index <= 3) return { team: "a", index };
  if (index >= 4 && index <= 6) return { team: "b", index };
  return { team: "c", index };
}

/** Team pools from Blender empties — `TA` / `spawn_a` / legacy `spawn_1`–`spawn_6`. */
export const ARENA_SPAWNS: ArenaSpawnPose[] = (() => {
  const out: ArenaSpawnPose[] = [];
  for (const m of markersDoc.markers ?? []) {
    const parsed = parseSpawnTeam(m.kind);
    if (!parsed) continue;
    out.push({
      index: parsed.index,
      team: parsed.team,
      x: sx(m.x),
      z: sx(m.z),
      yaw: parsed.team === "b" ? -Math.PI / 2 : Math.PI / 2,
    });
  }
  out.sort((a, b) => a.team.localeCompare(b.team) || a.index - b.index);
  return out;
})();

/**
 * Fallback 1v1v1 corners when the desert has no authored team-C pads yet:
 * a → spawn_3 (NW), b → spawn_4 (NE), c → spawn_6 (SE).
 */
export const ARENA_FFA_SPAWN_INDICES = {
  a: 3,
  b: 4,
  c: 6,
} as const;

export function arenaSpawnsForTeam(team: "a" | "b" | "c"): ArenaSpawnPose[] {
  return ARENA_SPAWNS.filter((s) => s.team === team);
}

/** nth fighter pad on a team (0-based). Prefer `arenaSpawnsForTeam` + random pick. */
export function arenaSpawnForSlot(
  team: "a" | "b" | "c",
  slot: number,
): ArenaSpawnPose | undefined {
  const list = arenaSpawnsForTeam(team);
  if (!list.length) return arenaFfaSpawnForTeam(team);
  return list[Math.max(0, Math.min(list.length - 1, slot))];
}

/** Solo FFA spawn for team a|b|c — faces arena origin. */
export function arenaFfaSpawnForTeam(team: "a" | "b" | "c"): ArenaSpawnPose | undefined {
  const authored = arenaSpawnsForTeam(team);
  if (authored.length === 1) {
    const pad = authored[0]!;
    return { ...pad, yaw: Math.atan2(-pad.x, -pad.z) };
  }
  const index = ARENA_FFA_SPAWN_INDICES[team];
  const pad = ARENA_SPAWNS.find((s) => s.index === index);
  if (!pad) return authored[0];
  const yaw = Math.atan2(-pad.x, -pad.z);
  return { ...pad, team, yaw };
}

/**
 * Rock circles from desert.glb (world units). Authored interior Beziers are
 * dropped — they overshot meshes and blocked teleports/magma in open sand.
 */
const ARENA_ROCK_CIRCLES: ReadonlyArray<Omit<CircleCollider, "shape">> = [
  // SW cluster
  { id: "desert_rock_01", x: -7.401, z: -6.834, radius: 0.55 },
  { id: "desert_rock_02", x: -7.463, z: -5.774, radius: 0.5 },
  { id: "desert_rock_03", x: -7.447, z: -4.977, radius: 0.52 },
  { id: "desert_rock_04", x: -6.901, z: -4.37, radius: 0.55 },
  { id: "desert_rock_05", x: -6.505, z: -3.633, radius: 0.58 },
  { id: "desert_rock_06", x: -5.868, z: -2.948, radius: 0.58 },
  // NE cluster
  { id: "desert_rock_01002", x: 8.328, z: 8.175, radius: 0.58 },
  { id: "desert_rock_02002", x: 8.291, z: 7.133, radius: 0.5 },
  { id: "desert_rock_03002", x: 8.202, z: 6.355, radius: 0.55 },
  { id: "desert_rock_04002", x: 7.611, z: 5.811, radius: 0.55 },
  { id: "desert_rock_05002", x: 7.156, z: 5.126, radius: 0.58 },
  { id: "desert_rock_06002", x: 6.469, z: 4.515, radius: 0.58 },
  // Large singles
  { id: "desert_rock_03003", x: 6.941, z: -6.413, radius: 1.45 },
  { id: "desert_rock_05003", x: -6.926, z: 10.518, radius: 1.4 },
];

function cross(o: [number, number], a: [number, number], b: [number, number]) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Monotone-chain convex hull (XZ). */
function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return points.slice();
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: Array<[number, number]> = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polylineToWall(id: string, pts: Array<[number, number]>, closed: boolean): WallCollider | null {
  if (pts.length < 2) return null;
  const segs: number[] = [];
  const n = pts.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-4) continue;
    segs.push(a[0], a[1], b[0], b[1]);
  }
  if (!segs.length) return null;
  return { id, shape: "walls", segs: Float32Array.from(segs) };
}

/**
 * Outer fence only — convex hull of the authored perimeter Bezier.
 * Raw curve has deep inward dents that stop teleports/magma in open sand.
 */
function arenaFenceWall(): WallCollider | null {
  const raw = (wallsDoc.walls ?? []).find((w) => w.id === "BézierCurve");
  if (!raw) return null;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < raw.segs.length; i += 4) {
    pts.push([sx(raw.segs[i]!), sx(raw.segs[i + 1]!)]);
    if (i + 4 >= raw.segs.length) {
      pts.push([sx(raw.segs[i + 2]!), sx(raw.segs[i + 3]!)]);
    }
  }
  return polylineToWall("arena_fence", convexHull(pts), true);
}

export function arenaWallColliders(): WallCollider[] {
  const fence = arenaFenceWall();
  return fence ? [fence] : [];
}

export function arenaRockColliders(): CircleCollider[] {
  return ARENA_ROCK_CIRCLES.map((c) => ({ ...c, shape: "circle" as const }));
}

export function arenaStaticColliders(): StaticCollider[] {
  return [...arenaWallColliders(), ...arenaRockColliders()];
}

export function arenaGroundSize(): number {
  let max = 20;
  for (const s of ARENA_SPAWNS) {
    max = Math.max(max, Math.abs(s.x), Math.abs(s.z));
  }
  for (const w of arenaWallColliders()) {
    for (let i = 0; i < w.segs.length; i++) {
      max = Math.max(max, Math.abs(w.segs[i]!));
    }
  }
  return Math.max(40, Math.ceil(max * 2 + 16));
}

export const ARENA_GROUND_SIZE = arenaGroundSize();

export type DesertObjective = {
  id: string;
  tag: "capture_point" | "flag_stand";
  team: "none" | "a" | "b";
  x: number;
  z: number;
  radius: number;
};

function offsetAway(p: { x: number; z: number }, dist: number): { x: number; z: number } {
  const len = Math.hypot(p.x, p.z) || 1;
  return { x: p.x + (p.x / len) * dist, z: p.z + (p.z / len) * dist };
}

function teamCentroid(team: "a" | "b"): { x: number; z: number } {
  const pads = arenaSpawnsForTeam(team);
  if (pads.length === 0) return { x: team === "a" ? -10 : 10, z: 0 };
  let x = 0;
  let z = 0;
  for (const p of pads) {
    x += p.x;
    z += p.z;
  }
  return { x: x / pads.length, z: z / pads.length };
}

/** Baked desert objective pads — used until the map is authored in the editor. */
export function desertObjectives(): DesertObjective[] {
  const a = teamCentroid("a");
  const b = teamCentroid("b");
  const flagA = offsetAway(a, 2.6);
  const flagB = offsetAway(b, 2.6);
  return [
    { id: "flag_a", tag: "flag_stand", team: "a", x: flagA.x, z: flagA.z, radius: 2.4 },
    { id: "flag_b", tag: "flag_stand", team: "b", x: flagB.x, z: flagB.z, radius: 2.4 },
    { id: "hill", tag: "capture_point", team: "none", x: 0, z: 0, radius: 4.2 },
    { id: "dom_mid", tag: "capture_point", team: "none", x: 0, z: 0, radius: 3.4 },
    { id: "dom_a", tag: "capture_point", team: "none", x: a.x * 0.45, z: a.z * 0.45, radius: 3.2 },
    { id: "dom_b", tag: "capture_point", team: "none", x: b.x * 0.45, z: b.z * 0.45, radius: 3.2 },
  ];
}
