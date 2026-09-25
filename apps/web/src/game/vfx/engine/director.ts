import { ATLAS_UV } from "./atlas";
import { BatchId, Collide, LodRank, type EmitterSpawn } from "./types";
import { getParticleWorld, type ParticleWorld } from "./particleWorld";
import { killAllLightningClusters } from "./lightningArcs";

export type { EmitterSpawn } from "./types";
export { BatchId, Collide, LodRank } from "./types";

export function spawnEmitter(cfg: EmitterSpawn): number {
  return getParticleWorld()?.spawnEmitter(cfg) ?? -1;
}

export function setEmitterPose(
  id: number,
  x: number,
  y: number,
  z: number,
  dirX?: number,
  dirY?: number,
  dirZ?: number,
): void {
  getParticleWorld()?.setEmitterPose(id, x, y, z, dirX, dirY, dirZ);
}

export function setEmitterRate(id: number, rate: number): void {
  getParticleWorld()?.setEmitterRate(id, rate);
}

export function setEmitterLook(id: number, spread: number, size: number, sizeEnd: number): void {
  getParticleWorld()?.setEmitterLook(id, spread, size, sizeEnd);
}

export function setEmitterLife(id: number, life: number, lifeJitter?: number): void {
  getParticleWorld()?.setEmitterLife(id, life, lifeJitter);
}

/** Steer living particles from this emitter toward a world point. */
export function setEmitterHoming(
  id: number,
  x: number,
  y: number,
  z: number,
  strength: number,
  killRadius = 0,
): void {
  getParticleWorld()?.setEmitterHoming(id, x, y, z, strength, killRadius);
}

export function killEmitter(id: number): void {
  getParticleWorld()?.killEmitter(id);
}

export function killAllEmitters(): void {
  getParticleWorld()?.killAll();
  killAllLightningClusters();
}

export function fireCone(x: number, y: number, z: number, extra?: Partial<EmitterSpawn>): EmitterSpawn {
  return {
    x,
    y,
    z,
    dirX: 0,
    dirY: 2.6,
    dirZ: 0,
    rate: 90,
    spread: 0.2,
    gravity: 0.35,
    drag: 0.08,
    noise: 0.55,
    groundY: 0,
    collide: Collide.None,
    batch: BatchId.AdditiveFire,
    atlasUv: ATLAS_UV.fire,
    color0: "#fffbeb",
    color1: "#fb923c",
    color2: "#ea580c",
    size: 0.95,
    sizeEnd: 0.22,
    life: 0.95,
    lifeJitter: 0.25,
    rotRate: 2.2,
    lod: LodRank.Core,
    burst: 8,
    ...extra,
  };
}

export function emberTrail(x: number, y: number, z: number, extra?: Partial<EmitterSpawn>): EmitterSpawn {
  return fireCone(x, y, z, {
    rate: 40,
    dirY: 1.4,
    spread: 0.28,
    size: 0.32,
    sizeEnd: 0.06,
    life: 0.65,
    burst: 4,
    batch: BatchId.AdditiveSpark,
    atlasUv: ATLAS_UV.spark,
    color0: "#fef08a",
    color1: "#f97316",
    color2: "#b91c1c",
    lod: LodRank.Trail,
    ...extra,
  });
}

export function smokePuff(x: number, y: number, z: number, extra?: Partial<EmitterSpawn>): EmitterSpawn {
  return {
    x,
    y,
    z,
    dirY: 0.7,
    rate: 22,
    spread: 0.35,
    gravity: -0.55,
    drag: 1.4,
    noise: 0.5,
    batch: BatchId.AlphaSmoke,
    color0: "#6b503f",
    color1: "#3b2c25",
    color2: "#141010",
    size: 0.55,
    sizeEnd: 2.2,
    life: 2.2,
    opacity: 0.11,
    rotRate: 0.3,
    lod: LodRank.Trail,
    ...extra,
  };
}

export function frostMist(x: number, y: number, z: number, extra?: Partial<EmitterSpawn>): EmitterSpawn {
  return {
    x,
    y,
    z,
    dirY: 0.8,
    rate: 40,
    spread: 0.22,
    gravity: 0.15,
    drag: 0.08,
    noise: 0.5,
    batch: BatchId.AlphaIce,
    atlasUv: ATLAS_UV.ice,
    color0: "#f8fafc",
    color1: "#7dd3fc",
    color2: "#38bdf8",
    size: 0.38,
    sizeEnd: 0.08,
    life: 0.9,
    lod: LodRank.Core,
    ...extra,
  };
}

/**
 * Grid of fire cones for the 16ms gate.
 * Dense Ardent-style sheets, but total live stays under ~2.5k so we don't soak the pool.
 * Particles 16 ≈ 32 emitters (core+ember); 48 ≈ 96 emitters at lower per-cone rate.
 */
export function spawnStressCones(
  world: ParticleWorld,
  count = 16,
  spacing = 2.2,
  origin?: { x: number; y?: number; z: number },
): number[] {
  killAllLightningClusters();
  const ids: number[] = [];
  const n = Math.max(1, count);
  const cols = Math.ceil(Math.sqrt(n));
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 1.05;
  const oz = origin?.z ?? 0;
  // Target ~1.8–2.2k live at 16, ~2.4–2.8k at 48 — dense, not capped.
  const coreRate = n <= 16 ? 70 : Math.max(28, Math.round(1800 / n));
  const trailRate = Math.max(10, Math.round(coreRate * 0.4));
  for (let i = 0; i < n; i++) {
    const cx = (i % cols) - (cols - 1) / 2;
    const cz = Math.floor(i / cols) - (cols - 1) / 2;
    const x = ox + cx * spacing;
    const z = oz + cz * spacing;
    const id = world.spawnEmitter(fireCone(x, oy + 0.15, z, { rate: coreRate }));
    if (id >= 0) ids.push(id);
    const trail = world.spawnEmitter(emberTrail(x, oy + 0.25, z, { rate: trailRate }));
    if (trail >= 0) ids.push(trail);
  }
  return ids;
}
