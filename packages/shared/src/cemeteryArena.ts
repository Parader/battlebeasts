/**
 * Cemetery Wave Assault arena (PvE dungeon).
 * Visual: apps/web/public/assets/maps/cemetery.glb
 * Walls: packages/shared/src/maps/cemetery.walls.json (Blender CollisionWalls)
 */

import type { StaticCollider, WallCollider } from "./collision";
import cemeteryWalls from "./maps/cemetery.walls.json";

type WallsDoc = {
  version?: number;
  exportedAt?: string;
  walls?: Array<{
    id: string;
    segs: number[];
  }>;
};

const wallsDoc = cemeteryWalls as WallsDoc;

/** Cache-bust when re-exporting the GLB / walls. */
export const CEMETERY_SCENE_URL = `/assets/maps/cemetery.glb?v=${encodeURIComponent(
  wallsDoc.exportedAt ?? "2",
)}`;

/** Same authoring scale family as village / desert. */
export const CEMETERY_SCENE_SCALE = 0.2;

const S = CEMETERY_SCENE_SCALE;

function sx(v: number) {
  return v * S;
}

function wallExtentHalf(): number {
  let max = 40;
  for (const w of wallsDoc.walls ?? []) {
    for (const v of w.segs) max = Math.max(max, Math.abs(sx(v)));
  }
  return max;
}

/** Approx half-extent of Blender wall polylines (world units). */
export const CEMETERY_PLAYABLE_HALF = wallExtentHalf();

/** Soft ground plane under the GLB (matches wall extent). */
export const CEMETERY_GROUND_SIZE = Math.ceil(CEMETERY_PLAYABLE_HALF * 2 + 16);

/** Player spawn at arena center (solo / slot 0). */
export const CEMETERY_PLAYER_SPAWN = { x: 0, z: 0, yaw: 0 } as const;

/**
 * Coop spawn pads around center so up to 4 fighters don't stack.
 * Slot 0 stays at the classic center spawn.
 */
export function cemeteryPlayerSpawn(slotIndex: number): {
  x: number;
  z: number;
  yaw: number;
} {
  const slot = Math.max(0, Math.floor(slotIndex));
  if (slot === 0) return { ...CEMETERY_PLAYER_SPAWN };
  const radius = 1.75;
  const angle = ((slot - 1) / 3) * Math.PI * 2;
  return {
    x: Math.sin(angle) * radius,
    z: Math.cos(angle) * radius,
    yaw: 0,
  };
}

/**
 * Candidate enemy spawn ring (world units). Director picks points farthest from players.
 * Sized inside the fence (~70% of wall half-extent).
 */
export const CEMETERY_ENEMY_SPAWN_RING: ReadonlyArray<{ x: number; z: number }> = (() => {
  const out: { x: number; z: number }[] = [];
  const r = Math.max(28, Math.min(CEMETERY_PLAYABLE_HALF * 0.7, CEMETERY_PLAYABLE_HALF - 8));
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: Math.sin(a) * r, z: Math.cos(a) * r });
  }
  return out;
})();

export function cemeteryWallColliders(): WallCollider[] {
  return (wallsDoc.walls ?? []).map((w) => ({
    id: w.id,
    shape: "walls" as const,
    segs: Float32Array.from(w.segs.map(sx)),
  }));
}

/** Movement solids for Wave Assault (Blender CollisionWalls curves). */
export function cemeteryStaticColliders(): StaticCollider[] {
  return cemeteryWallColliders();
}
