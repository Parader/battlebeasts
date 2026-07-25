import type { StaticCollider, WallCollider } from "./collision";
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
  team: "a" | "b";
  x: number;
  z: number;
  yaw: number;
};

/** Spawn 1–3 = team A, Spawn 4–6 = team B. */
export const ARENA_SPAWNS: ArenaSpawnPose[] = (() => {
  const out: ArenaSpawnPose[] = [];
  for (const m of markersDoc.markers ?? []) {
    const match = /^spawn_([1-6])$/.exec(m.kind);
    if (!match) continue;
    const index = Number(match[1]);
    out.push({
      index,
      team: index <= 3 ? "a" : "b",
      x: sx(m.x),
      z: sx(m.z),
      // Face toward midfield (team A looks +X, team B looks -X).
      yaw: index <= 3 ? Math.PI / 2 : -Math.PI / 2,
    });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
})();

export function arenaSpawnsForTeam(team: "a" | "b"): ArenaSpawnPose[] {
  return ARENA_SPAWNS.filter((s) => s.team === team);
}

/** nth fighter slot on a team (0-based) → spawn pose. */
export function arenaSpawnForSlot(team: "a" | "b", slot: number): ArenaSpawnPose | undefined {
  const list = arenaSpawnsForTeam(team);
  return list[Math.max(0, Math.min(list.length - 1, slot))];
}

export function arenaWallColliders(): WallCollider[] {
  return (wallsDoc.walls ?? []).map((w) => ({
    id: w.id,
    shape: "walls" as const,
    segs: Float32Array.from(w.segs.map(sx)),
  }));
}

export function arenaStaticColliders(): StaticCollider[] {
  return arenaWallColliders();
}

export function arenaGroundSize(): number {
  let max = 20;
  for (const s of ARENA_SPAWNS) {
    max = Math.max(max, Math.abs(s.x), Math.abs(s.z));
  }
  for (const w of wallsDoc.walls ?? []) {
    for (const v of w.segs) max = Math.max(max, Math.abs(sx(v)));
  }
  return Math.max(40, Math.ceil(max * 2 + 16));
}

export const ARENA_GROUND_SIZE = arenaGroundSize();
