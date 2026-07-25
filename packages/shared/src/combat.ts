import { ABILITIES, type AbilityDef } from "./abilities";
import { length2, normalize2 } from "./sim";
import type { Vec2 } from "./protocol";
import type { WallCollider } from "./collision";
import { projectileHitsWalls } from "./collision";

export const COMBAT = {
  playerHitRadius: 0.55,
  projectileHitRadius: 0.35,
  /**
   * Ground-aura ticks (Frost Ball shell, etc.): treat as "feet in the disc"
   * so gameplay matches the painted radius (no +playerHitRadius overshoot).
   */
  auraFootRadius: 0.12,
  maxProjectiles: 64,
} as const;

export type CombatBody = {
  id: string;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  /** When false, body cannot be damaged (e.g. disconnected). */
  vulnerable?: boolean;
};

export type ProjectileSim = {
  id: string;
  ownerId: string;
  abilityId: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  damage: number;
  hitRadius: number;
  /** Seconds remaining before despawn. */
  life: number;
  /** Session/target ids already hit (contact projectiles: no multi-hit). */
  hitIds: Set<string>;
  /** Traveling aura — ticks damage/slow without despawning on contact. */
  aura: boolean;
  /** Outer slow shell (world units). */
  slowRadius: number;
  /**
   * Radius for wall occlusion. Aura projectiles keep this small so a large
   * damage/slow shell does not instantly despawn next to scenery.
   */
  wallRadius: number;
  /** Aura tick interval (seconds). */
  tickSec: number;
  /** Accumulator toward next aura tick. */
  tickAcc: number;
};

export type CombatFxEvent = {
  kind: "aoe" | "melee" | "dash" | "hit" | "cast_phase";
  abilityId: string;
  x: number;
  z: number;
  radius?: number;
  ownerId?: string;
  targetId?: string;
  /** Damage dealt for hit popups (kind === "hit"). */
  damage?: number;
  /** For cast_phase events. */
  phase?: "anticipation" | "cast" | "impact" | "recovery" | "cancel" | "interrupt" | "idle";
  phaseEndsAt?: number;
  /**
   * When set, clients should start this ability's cooldown for `cooldownMs`.
   * Used for combo abilities (CD after final hit / early stop) and as an
   * explicit signal so clients don't assume every impact starts CD.
   */
  cooldownMs?: number;
  /** 1-based combo swing index when relevant. */
  comboHit?: number;
};

export function facingVector(yaw: number): Vec2 {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

export function pointInFront(origin: Vec2, yaw: number, distance: number): Vec2 {
  const f = facingVector(yaw);
  return { x: origin.x + f.x * distance, z: origin.z + f.z * distance };
}

export function circlesOverlap(
  ax: number,
  az: number,
  ar: number,
  bx: number,
  bz: number,
  br: number,
): boolean {
  return length2(ax - bx, az - bz) <= ar + br;
}

export function createProjectile(
  id: string,
  owner: CombatBody,
  def: AbilityDef,
): ProjectileSim | null {
  if (def.shape !== "projectile") return null;
  const speed = def.speed ?? 18;
  const f = facingVector(owner.yaw);
  const spawnDist = def.spawnOffset ?? 0.32;
  const spawn = pointInFront(owner, owner.yaw, spawnDist);
  const maxRange = def.range > 0 ? def.range : 12;
  const aura = def.aura === true;
  const hitRadius = def.radius ?? COMBAT.projectileHitRadius;
  return {
    id,
    ownerId: owner.id,
    abilityId: def.id,
    x: spawn.x,
    z: spawn.z,
    vx: f.x * speed,
    vz: f.z * speed,
    damage: def.damage,
    hitRadius,
    life: maxRange / speed,
    hitIds: new Set(),
    aura,
    slowRadius: def.slowRadius ?? (aura ? hitRadius * 2 : 0),
    wallRadius: aura ? COMBAT.projectileHitRadius : hitRadius,
    tickSec: Math.max(0.05, (def.tickMs ?? 250) / 1000),
    // Fire first aura pulse immediately on spawn.
    tickAcc: aura ? Math.max(0.05, (def.tickMs ?? 250) / 1000) : 0,
  };
}

export function dashOffset(yaw: number, distance: number): Vec2 {
  const f = facingVector(yaw);
  return { x: f.x * distance, z: f.z * distance };
}

/** Sample a translate path at progress 0..1 (caller may ease progress first). */
export function sampleTravel(
  from: Vec2,
  yaw: number,
  distance: number,
  progress01: number,
): Vec2 {
  const p = Math.max(0, Math.min(1, progress01));
  const off = dashOffset(yaw, distance * p);
  return { x: from.x + off.x, z: from.z + off.z };
}

export function meleeCenter(owner: CombatBody, def: AbilityDef): Vec2 {
  // Reach follows `range`; `radius` is hit width only.
  const reach = Math.max(0.5, def.range * 0.45);
  return pointInFront(owner, owner.yaw, reach);
}

export function ruptureCenter(owner: CombatBody, def: AbilityDef): Vec2 {
  return pointInFront(owner, owner.yaw, Math.max(2, def.range * 0.65));
}

/** Aim-line sample points for staggered ground spikes (near → far). */
export function spikeLinePoints(
  owner: CombatBody,
  def: AbilityDef,
): Vec2[] {
  const count = Math.max(1, Math.floor(def.spikeCount ?? 8));
  const start = Math.max(0.4, def.spikeStart ?? def.spawnOffset ?? 0.8);
  const end = Math.max(start + 0.5, def.range > 0 ? def.range : 10);
  const pts: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 1 : i / (count - 1);
    pts.push(pointInFront(owner, owner.yaw, start + (end - start) * t));
  }
  return pts;
}

export function resolveInstantHits(
  center: Vec2,
  radius: number,
  damage: number,
  ownerId: string,
  bodies: CombatBody[],
  canHurt: (ownerId: string, targetId: string) => boolean,
): { targetId: string; damage: number; hpAfter: number }[] {
  const hits: { targetId: string; damage: number; hpAfter: number }[] = [];
  for (const body of bodies) {
    if (body.id === ownerId) continue;
    if (body.vulnerable === false) continue;
    if (body.hp <= 0) continue;
    if (!canHurt(ownerId, body.id)) continue;
    if (!circlesOverlap(center.x, center.z, radius, body.x, body.z, COMBAT.playerHitRadius)) {
      continue;
    }
    const nextHp = Math.max(0, body.hp - damage);
    hits.push({ targetId: body.id, damage, hpAfter: nextHp });
  }
  return hits;
}

export type ProjectileHitEvent = {
  projectileId: string;
  ownerId: string;
  abilityId: string;
  targetId: string;
  damage: number;
  hpAfter: number;
  x: number;
  z: number;
};

export type ProjectileSlowEvent = {
  projectileId: string;
  ownerId: string;
  abilityId: string;
  targetId: string;
};

export type ProjectileTickResult = {
  removedIds: string[];
  hits: ProjectileHitEvent[];
  slows: ProjectileSlowEvent[];
};

/** Advance projectiles; mutates projectile positions and hitIds.
 *  Wall collisions despawn without a damage hit (no hit VFX).
 */
export function tickProjectiles(
  projectiles: ProjectileSim[],
  dt: number,
  bodies: CombatBody[],
  canHurt: (ownerId: string, targetId: string) => boolean,
  walls: readonly WallCollider[] = [],
): ProjectileTickResult {
  const removedIds: string[] = [];
  const hits: ProjectileHitEvent[] = [];
  const slows: ProjectileSlowEvent[] = [];

  for (const p of projectiles) {
    const fromX = p.x;
    const fromZ = p.z;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.life -= dt;
    if (p.life <= 0) {
      removedIds.push(p.id);
      continue;
    }

    if (walls.length > 0 && projectileHitsWalls(fromX, fromZ, p.x, p.z, p.wallRadius, walls)) {
      removedIds.push(p.id);
      continue;
    }

    if (p.aura) {
      p.tickAcc += dt;
      if (p.tickAcc < p.tickSec) continue;
      p.tickAcc -= p.tickSec;

      for (const body of bodies) {
        if (body.id === p.ownerId) continue;
        if (body.vulnerable === false || body.hp <= 0) continue;
        if (!canHurt(p.ownerId, body.id)) continue;

        const inSlow = circlesOverlap(
          p.x,
          p.z,
          p.slowRadius,
          body.x,
          body.z,
          COMBAT.auraFootRadius,
        );
        if (!inSlow) continue;

        slows.push({
          projectileId: p.id,
          ownerId: p.ownerId,
          abilityId: p.abilityId,
          targetId: body.id,
        });

        if (
          circlesOverlap(p.x, p.z, p.hitRadius, body.x, body.z, COMBAT.auraFootRadius)
        ) {
          const hpAfter = Math.max(0, body.hp - p.damage);
          hits.push({
            projectileId: p.id,
            ownerId: p.ownerId,
            abilityId: p.abilityId,
            targetId: body.id,
            damage: p.damage,
            hpAfter,
            x: body.x,
            z: body.z,
          });
        }
      }
      continue;
    }

    for (const body of bodies) {
      if (body.id === p.ownerId) continue;
      if (p.hitIds.has(body.id)) continue;
      if (body.vulnerable === false || body.hp <= 0) continue;
      if (!canHurt(p.ownerId, body.id)) continue;
      if (!circlesOverlap(p.x, p.z, p.hitRadius, body.x, body.z, COMBAT.playerHitRadius)) {
        continue;
      }
      p.hitIds.add(body.id);
      const hpAfter = Math.max(0, body.hp - p.damage);
      hits.push({
        projectileId: p.id,
        ownerId: p.ownerId,
        abilityId: p.abilityId,
        targetId: body.id,
        damage: p.damage,
        hpAfter,
        x: body.x,
        z: body.z,
      });
      removedIds.push(p.id);
      break;
    }
  }

  return { removedIds: [...new Set(removedIds)], hits, slows };
}

export function abilityOrThrow(id: string): AbilityDef {
  const def = ABILITIES[id];
  if (!def) throw new Error(`Unknown ability ${id}`);
  return def;
}

export function dirFromTo(from: Vec2, to: Vec2): Vec2 {
  return normalize2(to.x - from.x, to.z - from.z);
}
