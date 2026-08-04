/**
 * Cemetery Wave Assault arena (PvE dungeon).
 * Visual: apps/web/public/assets/maps/cemetery.glb
 * Bézier boundary curves are in the blend but not in the GLB — until
 * cemetery.walls.json is exported, we use a procedural playable box.
 */

import type { StaticCollider, WallCollider } from "./collision";

/** Cache-bust when re-exporting the GLB. */
export const CEMETERY_SCENE_URL = `/assets/maps/cemetery.glb?v=1`;

/** Same authoring scale family as village / desert. */
export const CEMETERY_SCENE_SCALE = 0.2;

/**
 * Ground mesh ≈ ±42.6 world after node×scene scale.
 * Keep a little inset so hunters don't clip through fence meshes.
 */
export const CEMETERY_PLAYABLE_HALF = 38;

/** Soft ground plane under the GLB (matches mesh extent). */
export const CEMETERY_GROUND_SIZE = CEMETERY_PLAYABLE_HALF * 2 + 10;

/** Player spawn at arena center. */
export const CEMETERY_PLAYER_SPAWN = { x: 0, z: 0, yaw: 0 } as const;

/**
 * Candidate enemy spawn ring (world units). Director picks points farthest from players.
 * Inside the playable box so they don't spawn outside the fence.
 */
export const CEMETERY_ENEMY_SPAWN_RING: ReadonlyArray<{ x: number; z: number }> = (() => {
  const out: { x: number; z: number }[] = [];
  const r = 28;
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: Math.sin(a) * r, z: Math.cos(a) * r });
  }
  return out;
})();

/** Build a closed square as wall segments (axis-aligned playable bounds). */
function squareWallSegs(half: number, stepsPerSide = 10): number[] {
  const corners: Array<[number, number]> = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
    [-half, -half],
  ];
  const segs: number[] = [];
  for (let s = 0; s < 4; s++) {
    const [ax, az] = corners[s]!;
    const [bx, bz] = corners[s + 1]!;
    for (let i = 0; i < stepsPerSide; i++) {
      const t0 = i / stepsPerSide;
      const t1 = (i + 1) / stepsPerSide;
      segs.push(
        ax + (bx - ax) * t0,
        az + (bz - az) * t0,
        ax + (bx - ax) * t1,
        az + (bz - az) * t1,
      );
    }
  }
  return segs;
}

export function cemeteryWallColliders(): WallCollider[] {
  return [
    {
      id: "cemetery_bounds",
      shape: "walls" as const,
      segs: Float32Array.from(squareWallSegs(CEMETERY_PLAYABLE_HALF)),
    },
  ];
}

/** Movement solids for Wave Assault (swap for Blender walls.json when exported). */
export function cemeteryStaticColliders(): StaticCollider[] {
  return cemeteryWallColliders();
}
