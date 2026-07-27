import { ABILITIES, travelDistance, type AbilityDef } from "./abilities";
import { length2, normalize2 } from "./sim";
import type { Vec2 } from "./protocol";
import type { WallCollider } from "./collision";
import { lastFreeTBeforeWalls, projectileHitsWalls } from "./collision";

/** Angular pie slices for cone wall occlusion (Frost Mist). */
export const CONE_OCCLUSION_SECTORS = 24;

export const COMBAT = {
  playerHitRadius: 0.55,
  projectileHitRadius: 0.35,
  /**
   * Ground-aura ticks (Frost Ball shell, etc.): treat as "feet in the disc"
   * so gameplay matches the painted radius (no +playerHitRadius overshoot).
   */
  auraFootRadius: 0.12,
  maxProjectiles: 64,
  /** Base chance an outgoing hit/heal rolls critical (0–1). */
  critChance: 0.05,
  /** Critical hits deal / heal this × the pre-mitigation amount. */
  critMultiplier: 1.5,
} as const;

/** One RNG check — hot-path safe (no allocations). */
export function rollCrit(chance: number = COMBAT.critChance): boolean {
  return chance > 0 && Math.random() < chance;
}

/** Apply crit multiplier before rounding/mitigation. */
export function scaleForCrit(
  amount: number,
  crit: boolean,
  mult: number = COMBAT.critMultiplier,
): number {
  if (!crit || !(amount > 0)) return amount;
  return amount * mult;
}

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
  /** Seconds remaining before despawn (flight only; detonate uses explodeIn). */
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
  /**
   * Sticky / ground fuse (Ice Lance). `flight` until contact, miss, or wall;
   * then `stuck` (follow target) or `grounded` until explodeIn elapses.
   */
  mode: "flight" | "stuck" | "grounded";
  /** Target id while mode === "stuck". */
  stuckTargetId: string | null;
  /** Seconds until detonation blast (active in stuck/grounded). */
  explodeIn: number;
  /** Detonation blast damage (0 = no detonate behavior). */
  explodeDamage: number;
  /** Detonation blast radius. */
  explodeRadius: number;
};

export type CombatFxEvent = {
  kind: "aoe" | "melee" | "dash" | "hit" | "cast_phase" | "portal";
  abilityId: string;
  x: number;
  z: number;
  /** World Y for height-aware FX (e.g. Ice Lance stuck vs grounded blast). */
  y?: number;
  /** Portal blink destination (kind === "portal"). */
  x2?: number;
  z2?: number;
  radius?: number;
  /** Facing for oriented FX (frost mist cone, etc.). */
  yaw?: number;
  ownerId?: string;
  targetId?: string;
  /** Damage / heal amount for hit popups (kind === "hit"). */
  damage?: number;
  /** True when this hit/heal rolled a critical. */
  crit?: boolean;
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
  const det = def.detonate;
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
    mode: "flight",
    stuckTargetId: null,
    explodeIn: 0,
    explodeDamage: det?.damage ?? 0,
    explodeRadius: det?.radius ?? 0,
  };
}

export function dashOffset(yaw: number, distance: number): Vec2 {
  const f = facingVector(yaw);
  return { x: f.x * distance, z: f.z * distance };
}

/**
 * Portal channel: distance from elapsed wall ms (0 at channel start → max at channelChargeMs).
 */
export function channelChargeDistance(def: AbilityDef, elapsedMs: number): number {
  const max = travelDistance(def);
  const min = Math.max(0, Math.min(max, def.channelMinRange ?? 0));
  const chargeMs = Math.max(1, def.channelChargeMs ?? 1000);
  const t = Math.max(0, Math.min(1, elapsedMs / chargeMs));
  return min + (max - min) * t;
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

/**
 * Firewall wall samples — perpendicular to aim, centered in front of caster.
 * Ordered left → right so VFX can grow from the middle outward.
 * Hit samples are inset so endpoint circles don't overshoot the painted wall.
 */
export function firewallWallPoints(
  owner: CombatBody,
  def: AbilityDef,
): { mid: Vec2; yaw: number; halfLength: number; points: Vec2[] } {
  const count = Math.max(1, Math.floor(def.spikeCount ?? 11));
  const midDist = Math.max(1.2, def.spikeStart ?? 3.4);
  const halfLength = Math.max(1.5, (def.range > 0 ? def.range : 9) * 0.5);
  const hitRadius = Math.max(0.4, def.radius ?? 0.9);
  /** Keep sample centers inside the visual wall so ticks don't land past the VFX. */
  const hitHalf = Math.max(1.2, halfLength - hitRadius * 0.7);
  const mid = pointInFront(owner, owner.yaw, midDist);
  const face = facingVector(owner.yaw);
  // Perpendicular in XZ (right when facing +yaw forward).
  const rightX = face.z;
  const rightZ = -face.x;
  const points: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    points.push({
      x: mid.x + rightX * hitHalf * t,
      z: mid.z + rightZ * hitHalf * t,
    });
  }
  return { mid, yaw: owner.yaw, halfLength, points };
}

/**
 * Facing cone test (XZ). `halfAngle` in radians; `targetRadius` softens the rim.
 */
export function inFacingCone(
  origin: Vec2,
  yaw: number,
  length: number,
  halfAngle: number,
  target: Vec2,
  targetRadius = COMBAT.playerHitRadius,
): boolean {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const dist = Math.hypot(dx, dz);
  if (dist > length + targetRadius) return false;
  if (dist <= targetRadius * 0.35) return true;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const nx = dx / dist;
  const nz = dz / dist;
  const dot = fx * nx + fz * nz;
  const rim = Math.asin(Math.min(1, targetRadius / Math.max(dist, 1e-4)));
  return dot >= Math.cos(Math.max(0.05, halfAngle + rim));
}

/** Signed angle of target relative to facing yaw (−π…π). */
export function angleFromFacing(origin: Vec2, yaw: number, target: Vec2): number {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return 0;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const nx = dx / dist;
  const nz = dz / dist;
  const dot = fx * nx + fz * nz;
  const cross = fx * nz - fz * nx;
  return Math.atan2(cross, dot);
}

/** Map a bearing within ±halfAngle to a pie-slice index, or null if outside. */
export function coneSectorIndex(
  origin: Vec2,
  yaw: number,
  halfAngle: number,
  target: Vec2,
  sectors = CONE_OCCLUSION_SECTORS,
): number | null {
  const ang = angleFromFacing(origin, yaw, target);
  const span = Math.max(1e-4, 2 * halfAngle);
  if (Math.abs(ang) > halfAngle + 0.25) return null;
  const u = (ang + halfAngle) / span;
  return Math.min(sectors - 1, Math.max(0, Math.floor(u * sectors)));
}

/**
 * Hard wall clip length per pie sector (mid-angle ray). Soft unit occlusion is separate.
 */
export function coneSectorRanges(
  origin: Vec2,
  yaw: number,
  length: number,
  halfAngle: number,
  walls: readonly WallCollider[],
  sectors = CONE_OCCLUSION_SECTORS,
  wallRadius = COMBAT.projectileHitRadius,
): Float32Array {
  const ranges = new Float32Array(sectors);
  const len = Math.max(0, length);
  for (let i = 0; i < sectors; i++) {
    const u = (i + 0.5) / sectors;
    const ang = yaw + (-halfAngle + u * 2 * halfAngle);
    const to = {
      x: origin.x + Math.sin(ang) * len,
      z: origin.z + Math.cos(ang) * len,
    };
    const t = lastFreeTBeforeWalls(origin, to, wallRadius, walls);
    ranges[i] = t == null ? len : len * Math.max(0, t);
  }
  return ranges;
}

/**
 * Max travel along one world-yaw ray: walls hard-clip; nearest unit soft-stops
 * at its near edge (that unit is still hittable for gameplay).
 */
export function coneRayMaxLength(
  origin: Vec2,
  rayYaw: number,
  length: number,
  walls: readonly WallCollider[],
  bodies: readonly { id: string; x: number; z: number; hp?: number; vulnerable?: boolean }[],
  ownerId: string | null,
  opts?: {
    wallRadius?: number;
    bodyRadius?: number;
    /** Skip this body as a soft occluder (the intended hit target). */
    excludeId?: string | null;
  },
): number {
  const len = Math.max(0, length);
  if (len <= 0) return 0;
  const wallRadius = opts?.wallRadius ?? COMBAT.projectileHitRadius;
  const bodyRadius = opts?.bodyRadius ?? COMBAT.playerHitRadius;
  const excludeId = opts?.excludeId ?? null;
  const to = {
    x: origin.x + Math.sin(rayYaw) * len,
    z: origin.z + Math.cos(rayYaw) * len,
  };
  const t = lastFreeTBeforeWalls(origin, to, wallRadius, walls);
  let max = t == null ? len : len * Math.max(0, t);

  const nx = Math.sin(rayYaw);
  const nz = Math.cos(rayYaw);
  for (const b of bodies) {
    if (ownerId && b.id === ownerId) continue;
    if (excludeId && b.id === excludeId) continue;
    if (b.vulnerable === false) continue;
    if (typeof b.hp === "number" && b.hp <= 0) continue;
    const bx = b.x - origin.x;
    const bz = b.z - origin.z;
    const along = bx * nx + bz * nz;
    if (along <= 0 || along >= max) continue;
    const perp = Math.abs(bx * nz - bz * nx);
    if (perp > bodyRadius) continue;
    // Soft stop at near edge of the front body.
    const near = Math.max(0, along - Math.sqrt(Math.max(0, bodyRadius * bodyRadius - perp * perp)));
    if (near < max) max = near;
  }
  return max;
}

/**
 * True when another body sits on the ray to `target` and soft-blocks (front body still hits).
 */
export function coneRaySoftOccluded(
  origin: Vec2,
  target: Vec2,
  targetId: string,
  bodies: readonly CombatBody[],
  ownerId: string,
  softEpsilon = COMBAT.playerHitRadius * 0.5,
): boolean {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const distT = Math.hypot(dx, dz);
  if (distT < 1e-4) return false;
  const nx = dx / distT;
  const nz = dz / distT;
  const R = COMBAT.playerHitRadius;

  for (const b of bodies) {
    if (b.id === targetId || b.id === ownerId) continue;
    if (b.vulnerable === false || b.hp <= 0) continue;
    const bx = b.x - origin.x;
    const bz = b.z - origin.z;
    const along = bx * nx + bz * nz;
    if (along <= 0 || along >= distT - softEpsilon) continue;
    const perp = Math.abs(bx * nz - bz * nx);
    if (perp <= R) return true;
  }
  return false;
}

export type ResolveConeHitsOpts = {
  walls?: readonly WallCollider[];
  /** Soft unit cover (front takes hit, behind safe). Default false. */
  softOcclude?: boolean;
};

/**
 * Cone hits. With `walls` / `softOcclude`, reach matches `coneRayMaxLength`
 * (same clip as Frost Mist VFX): only targets the mist can touch.
 */
export function resolveConeHits(
  origin: Vec2,
  yaw: number,
  length: number,
  halfAngle: number,
  damage: number,
  ownerId: string,
  bodies: CombatBody[],
  canHurt: (ownerId: string, targetId: string) => boolean,
  opts?: ResolveConeHitsOpts,
): { targetId: string; damage: number; hpAfter: number }[] {
  const walls = opts?.walls ?? [];
  const softOcclude = opts?.softOcclude === true;
  const occlude = walls.length > 0 || softOcclude;

  const hits: { targetId: string; damage: number; hpAfter: number }[] = [];
  for (const body of bodies) {
    if (body.id === ownerId) continue;
    if (body.vulnerable === false) continue;
    if (body.hp <= 0) continue;
    if (!canHurt(ownerId, body.id)) continue;
    if (!inFacingCone(origin, yaw, length, halfAngle, body, COMBAT.playerHitRadius)) {
      continue;
    }

    if (occlude) {
      const dx = body.x - origin.x;
      const dz = body.z - origin.z;
      const dist = Math.hypot(dx, dz);
      // Same yaw convention as movement: x=sin(yaw), z=cos(yaw).
      const rayYaw = dist > 1e-6 ? Math.atan2(dx, dz) : yaw;
      const maxLen = coneRayMaxLength(
        origin,
        rayYaw,
        length,
        walls,
        softOcclude ? bodies : [],
        ownerId,
        { excludeId: body.id },
      );
      // Reach must overlap the target circle — same footprint the VFX soft-stops at.
      if (dist > maxLen + COMBAT.playerHitRadius) continue;
    }

    const nextHp = Math.max(0, body.hp - damage);
    hits.push({ targetId: body.id, damage, hpAfter: nextHp });
  }
  return hits;
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

export type ProjectileExplodeEvent = {
  projectileId: string;
  ownerId: string;
  abilityId: string;
  x: number;
  z: number;
  damage: number;
  radius: number;
  /** Where the lance was when it detonated — drives blast height. */
  mode: "stuck" | "grounded";
};

export type ProjectileTickResult = {
  removedIds: string[];
  hits: ProjectileHitEvent[];
  slows: ProjectileSlowEvent[];
  explodes: ProjectileExplodeEvent[];
};

function armDetonate(p: ProjectileSim, delaySec: number, mode: "stuck" | "grounded", targetId: string | null) {
  p.mode = mode;
  p.stuckTargetId = targetId;
  p.vx = 0;
  p.vz = 0;
  p.explodeIn = delaySec;
  p.life = Math.max(p.life, delaySec + 0.05);
}

/** Advance projectiles; mutates projectile positions and hitIds.
 *  Wall collisions despawn without a damage hit (no hit VFX), unless the
 *  projectile has a detonate fuse — then it plants and explodes.
 */
export function tickProjectiles(
  projectiles: ProjectileSim[],
  dt: number,
  bodies: CombatBody[],
  canHurt: (ownerId: string, targetId: string) => boolean,
  walls: readonly WallCollider[] = [],
  detonateDelaySecByAbility: (abilityId: string) => number = () => 0,
): ProjectileTickResult {
  const removedIds: string[] = [];
  const hits: ProjectileHitEvent[] = [];
  const slows: ProjectileSlowEvent[] = [];
  const explodes: ProjectileExplodeEvent[] = [];

  const bodyById = new Map<string, CombatBody>();
  for (const b of bodies) bodyById.set(b.id, b);

  for (const p of projectiles) {
    const canDetonate = p.explodeDamage > 0 && p.explodeRadius > 0;
    const fuseSec = canDetonate ? Math.max(0.05, detonateDelaySecByAbility(p.abilityId)) : 0;

    // --- Stuck / grounded fuse ---
    if (p.mode === "stuck" || p.mode === "grounded") {
      if (p.mode === "stuck" && p.stuckTargetId) {
        const target = bodyById.get(p.stuckTargetId);
        if (!target || target.hp <= 0 || target.vulnerable === false) {
          p.mode = "grounded";
          p.stuckTargetId = null;
        } else {
          p.x = target.x;
          p.z = target.z;
        }
      }
      p.explodeIn -= dt;
      if (p.explodeIn <= 0) {
        explodes.push({
          projectileId: p.id,
          ownerId: p.ownerId,
          abilityId: p.abilityId,
          x: p.x,
          z: p.z,
          damage: p.explodeDamage,
          radius: p.explodeRadius,
          mode: p.mode === "stuck" ? "stuck" : "grounded",
        });
        removedIds.push(p.id);
      }
      continue;
    }

    // --- Flight ---
    const fromX = p.x;
    const fromZ = p.z;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.life -= dt;

    if (walls.length > 0 && projectileHitsWalls(fromX, fromZ, p.x, p.z, p.wallRadius, walls)) {
      if (canDetonate) {
        p.x = fromX;
        p.z = fromZ;
        armDetonate(p, fuseSec, "grounded", null);
      } else {
        removedIds.push(p.id);
      }
      continue;
    }

    if (p.life <= 0) {
      if (canDetonate) {
        armDetonate(p, fuseSec, "grounded", null);
      } else {
        removedIds.push(p.id);
      }
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
      if (canDetonate) {
        armDetonate(p, fuseSec, "stuck", body.id);
      } else {
        removedIds.push(p.id);
      }
      break;
    }
  }

  return { removedIds: [...new Set(removedIds)], hits, slows, explodes };
}

export function abilityOrThrow(id: string): AbilityDef {
  const def = ABILITIES[id];
  if (!def) throw new Error(`Unknown ability ${id}`);
  return def;
}

export function dirFromTo(from: Vec2, to: Vec2): Vec2 {
  return normalize2(to.x - from.x, to.z - from.z);
}
