import { ABILITIES, MAGMA_ORBS_CAST, travelDistance, type AbilityDef } from "./abilities";
import { length2, normalize2 } from "./sim";
import type { Vec2 } from "./protocol";
import type { WallCollider, ProtectionBubbleCollider, CircleCollider, BoxCollider } from "./collision";
import {
  lastFreeTBeforeWalls,
  projectileHitsSolids,
  projectileHitsProtectionBubbles,
} from "./collision";

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
  /**
   * Hit footprint, when it differs from a player's.
   *
   * Players, decoys and dummies are all one size, so this stays absent for
   * them and every hit test reads the same constant it always did. Attackable
   * map props are not: a barn and a fencepost cannot both be a 0.55m circle
   * without one being unmissable and the other unhittable.
   */
  radius?: number;
};

/** A body's hit footprint, defaulting to player size. */
export function hitRadiusOf(body: Pick<CombatBody, "radius">): number {
  return body.radius ?? COMBAT.playerHitRadius;
}

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
   * Returning projectiles use `outbound` | `turning` | `returning`.
   * Runic Shard shatter children use `fragment`.
   */
  mode: "flight" | "stuck" | "grounded" | "outbound" | "turning" | "returning" | "fragment";
  /** Target id while mode === "stuck". */
  stuckTargetId: string | null;
  /** Seconds until detonation blast (active in stuck/grounded). */
  explodeIn: number;
  /** Detonation blast damage (0 = no detonate behavior). */
  explodeDamage: number;
  /** Detonation blast radius. */
  explodeRadius: number;
  /**
   * Protection bubbles this shot spawned inside — may leave and curve through
   * without being treated as an exterior hit.
   */
  passBubbleIds: Set<string>;
  /**
   * Seconds remaining before wall/body collisions arm (spawn grace).
   * Movement still applies.
   */
  armingIn: number;
  /** returningProjectile — outbound / turning / returning leg. */
  returnPhase?: "outbound" | "turning" | "returning";
  /** Inbound leg damage (outbound uses `damage`). */
  returnDamage?: number;
  /** Targets already hit on the return leg. */
  returnHitIds?: Set<string>;
  /** Travel speed (world units / sec) for outbound + return. */
  projectileSpeed?: number;
  /** Outbound distance cap (world units). */
  maxOutboundRange?: number;
  /** Distance traveled this outbound leg. */
  outboundTraveled?: number;
  /** Countdown while paused at max range before return (seconds). */
  turnDelayRemaining?: number;
  /** Failsafe age limit (seconds). */
  maxLifetimeSec?: number;
  /** Catch radius toward live caster on return (world units). */
  returnCatchRadius?: number;
  /** Accumulated sim age (seconds). */
  ageSec?: number;
  /** Turn pause duration when entering turning phase (seconds). */
  turnDelaySec?: number;
  /** Runic Shard fragment — smaller crystal from a shatter. */
  isRunicFragment?: boolean;
  /**
   * Shared hit counts for one shatter burst (targetId → hits).
   * Caps focused damage via maxFragmentsPerTarget.
   */
  fragmentHitBudget?: Map<string, number>;
  maxFragmentsPerTarget?: number;
  /** Remaining manual shatter charges on a Runic Shard main projectile. */
  shatterChargesRemaining?: number;
  /** Server epoch ms — next shatter allowed at/after this time. */
  shatterReadyAt?: number;
  /** World spawn position (distance-scaled damage / pierce travel). */
  spawnX?: number;
  spawnZ?: number;
  /** Continue after body hits (once per target). Walls still stop the shot. */
  pierce?: boolean;
  /**
   * Ally-heal pierce: contact uses `canHeal` instead of `canHurt`.
   * `damage` carries the heal amount for hit events.
   */
  healAllies?: boolean;
  /** Soft floor before distance damage ramps. */
  damageRampStartDistance?: number;
  maxDamageDistance?: number;
  minDamage?: number;
  maxDamage?: number;
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
  /**
   * Style / sub-event index.
   * Volcano rocks: 1 = telegraph (red circle + arc), 2 = impact shatter.
   * Projectiles: COMBAT_FX_VARIANT_WALL_HIT = wall / shield disc fizzle.
   */
  variant?: number;
};

export function facingVector(yaw: number): Vec2 {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

export function pointInFront(origin: Vec2, yaw: number, distance: number): Vec2 {
  const f = facingVector(yaw);
  return { x: origin.x + f.x * distance, z: origin.z + f.z * distance };
}

/** Frozen Magma Orbs flight geometry (matches client Bezier). */
export type MagmaOrbsFlightPath = {
  left0: Vec2;
  right0: Vec2;
  ctrlL: Vec2;
  ctrlR: Vec2;
  collide: Vec2;
};

function magmaOrbsLateral(
  origin: Vec2,
  yaw: number,
  ahead: number,
  side: -1 | 1,
  lateral: number,
): Vec2 {
  const f = facingVector(yaw);
  const rx = f.z;
  const rz = -f.x;
  return {
    x: origin.x + f.x * ahead + rx * lateral * side,
    z: origin.z + f.z * ahead + rz * lateral * side,
  };
}

/** Lateral bow scale so short / long meets still look like twin arcs. */
export function magmaOrbsBowForRange(meetRange: number): number {
  const mid = MAGMA_ORBS_CAST.meetRange;
  const scale = meetRange / Math.max(0.01, mid);
  return MAGMA_ORBS_CAST.arcBow * Math.max(0.4, Math.min(1.4, scale));
}

/** Vertical flight arc height scaled by meet distance. */
export function magmaOrbsArcYForRange(meetRange: number): number {
  const mid = MAGMA_ORBS_CAST.meetRange;
  const scale = meetRange / Math.max(0.01, mid);
  return MAGMA_ORBS_CAST.flightArcY * Math.max(0.45, Math.min(1.35, scale));
}

function magmaOrbsFlightControl(
  from: Vec2,
  collide: Vec2,
  yaw: number,
  side: -1 | 1,
  bow: number,
): Vec2 {
  const f = facingVector(yaw);
  const rx = f.z;
  const rz = -f.x;
  // Push control point slightly along aim so short ranges still curve forward.
  const along = Math.max(0.25, Math.min(0.85, bow * 0.28));
  return {
    x: (from.x + collide.x) * 0.5 + rx * side * bow + f.x * along,
    z: (from.z + collide.z) * 0.5 + rz * side * bow + f.z * along,
  };
}

/**
 * Build flight path at launch — same pose the client freezes.
 * Pass `collideOverride` when the server already chose the meet point.
 */
export function buildMagmaOrbsFlightPath(
  owner: Vec2,
  yaw: number,
  meetRange = MAGMA_ORBS_CAST.meetRange,
  collideOverride?: Vec2,
): MagmaOrbsFlightPath {
  const lat = MAGMA_ORBS_CAST.lateral * 1.2;
  const ahead = MAGMA_ORBS_CAST.emergeAhead;
  const collide =
    collideOverride ??
    pointInFront(
      owner,
      yaw,
      Math.max(MAGMA_ORBS_CAST.meetRangeMin, meetRange),
    );
  const actualRange = Math.hypot(collide.x - owner.x, collide.z - owner.z);
  const bow = magmaOrbsBowForRange(actualRange);
  const left0 = magmaOrbsLateral(owner, yaw, ahead, -1, lat);
  const right0 = magmaOrbsLateral(owner, yaw, ahead, 1, lat);
  return {
    left0,
    right0,
    ctrlL: magmaOrbsFlightControl(left0, collide, yaw, -1, bow),
    ctrlR: magmaOrbsFlightControl(right0, collide, yaw, 1, bow),
    collide,
  };
}

/** Cubic ease-in — accelerate into the crash (matches client). */
export function magmaOrbsFlightT(linear01: number): number {
  const u = Math.max(0, Math.min(1, linear01));
  return u * u * u;
}

function quadBezier2(p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    z: u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
  };
}

/** Sample both orb XZ positions at eased flight progress 0..1. */
export function sampleMagmaOrbsFlight(
  path: MagmaOrbsFlightPath,
  t01: number,
): { left: Vec2; right: Vec2 } {
  const t = Math.max(0, Math.min(1, t01));
  return {
    left: quadBezier2(path.left0, path.ctrlL, path.collide, t),
    right: quadBezier2(path.right0, path.ctrlR, path.collide, t),
  };
}

/**
 * Earliest Bezier parameter t∈[0,1] along one orb path before a solid blocks it.
 * Returns 1 when the full path is clear (walls + props — not units).
 */
export function magmaOrbMaxFlightT(
  p0: Vec2,
  ctrl: Vec2,
  end: Vec2,
  walls: readonly WallCollider[],
  wallRadius: number,
  circles: readonly CircleCollider[] = [],
  boxes: readonly BoxCollider[] = [],
  steps = 48,
): number {
  if (!walls.length && !circles.length && !boxes.length) return 1;
  if (projectileHitsSolids(p0.x, p0.z, p0.x, p0.z, wallRadius, walls, circles, boxes)) return 0;

  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cur = quadBezier2(p0, ctrl, end, t);
    if (!projectileHitsSolids(prev.x, prev.z, cur.x, cur.z, wallRadius, walls, circles, boxes)) {
      prev = cur;
      continue;
    }
    let lo = (i - 1) / steps;
    let hi = t;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) * 0.5;
      const a = quadBezier2(p0, ctrl, end, lo);
      const m = quadBezier2(p0, ctrl, end, mid);
      if (projectileHitsSolids(a.x, a.z, m.x, m.z, wallRadius, walls, circles, boxes)) hi = mid;
      else lo = mid;
    }
    return lo;
  }
  return 1;
}

/** Max flight t for both Magma Orbs against world walls + solid props. */
export function magmaOrbsMaxFlightTs(
  path: MagmaOrbsFlightPath,
  walls: readonly WallCollider[],
  wallRadius = MAGMA_ORBS_CAST.flightHitRadius,
  circles: readonly CircleCollider[] = [],
  boxes: readonly BoxCollider[] = [],
): { left: number; right: number } {
  return {
    left: magmaOrbMaxFlightT(path.left0, path.ctrlL, path.collide, walls, wallRadius, circles, boxes),
    right: magmaOrbMaxFlightT(path.right0, path.ctrlR, path.collide, walls, wallRadius, circles, boxes),
  };
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
  const usesDistanceScale =
    def.minDamage != null &&
    def.maxDamage != null &&
    def.maxDamage > def.minDamage;
  const healAllies = def.healAllies === true;
  return {
    id,
    ownerId: owner.id,
    abilityId: def.id,
    x: spawn.x,
    z: spawn.z,
    vx: f.x * speed,
    vz: f.z * speed,
    damage: healAllies ? (def.heal ?? 0) : def.damage,
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
    passBubbleIds: new Set(),
    armingIn: 0,
    spawnX: spawn.x,
    spawnZ: spawn.z,
    pierce: def.pierce === true || healAllies,
    healAllies,
    ...(usesDistanceScale
      ? {
          minDamage: def.minDamage,
          maxDamage: def.maxDamage,
          maxDamageDistance: def.maxDamageDistance ?? maxRange,
          damageRampStartDistance: def.damageRampStartDistance ?? 3,
        }
      : {}),
  };
}

export function isReturningProjectileSim(p: ProjectileSim): boolean {
  return p.returnPhase != null;
}

/** Spawn a returning disc / boomerang projectile. */
export function createReturningProjectile(
  id: string,
  owner: CombatBody,
  def: AbilityDef,
): ProjectileSim | null {
  if (def.shape !== "projectile" || !def.returningProjectile) return null;
  const cfg = def.returningProjectile;
  const speed = def.speed ?? 15;
  const f = facingVector(owner.yaw);
  const spawnDist = def.spawnOffset ?? 0.32;
  const spawn = pointInFront(owner, owner.yaw, spawnDist);
  const maxRange = def.range > 0 ? def.range : 9;
  const hitRadius = def.radius ?? COMBAT.projectileHitRadius;
  const turnDelayMs = cfg.turnDelayMs ?? 70;
  const maxLifetimeMs = cfg.maxLifetimeMs ?? 2200;
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
    returnHitIds: new Set(),
    aura: false,
    slowRadius: 0,
    // Keep solid occlusion tight — hitRadius is for body contact only.
    wallRadius: COMBAT.projectileHitRadius,
    tickSec: 0.25,
    tickAcc: 0,
    mode: "outbound",
    stuckTargetId: null,
    explodeIn: 0,
    explodeDamage: 0,
    explodeRadius: 0,
    passBubbleIds: new Set(),
    // Brief grace so spawn next to the caster / props doesn't instantly turn.
    armingIn: 0.08,
    returnPhase: "outbound",
    returnDamage: cfg.returnDamage,
    projectileSpeed: speed,
    maxOutboundRange: maxRange,
    outboundTraveled: 0,
    turnDelayRemaining: 0,
    turnDelaySec: turnDelayMs / 1000,
    maxLifetimeSec: maxLifetimeMs / 1000,
    returnCatchRadius: cfg.returnCatchRadius ?? 0.6,
    ageSec: 0,
  };
}

/** Spawn a Runic Shard fragment along a yaw offset from the main shard's heading. */
export function createRunicFragment(
  id: string,
  ownerId: string,
  abilityId: string,
  origin: Vec2,
  yaw: number,
  def: AbilityDef,
  hitBudget: Map<string, number>,
): ProjectileSim | null {
  const cfg = def.runicShard;
  if (!cfg) return null;
  const speed = cfg.fragmentSpeed;
  const f = facingVector(yaw);
  const range = cfg.fragmentRange;
  const hitRadius = cfg.fragmentRadius;
  return {
    id,
    ownerId,
    abilityId,
    x: origin.x,
    z: origin.z,
    vx: f.x * speed,
    vz: f.z * speed,
    damage: cfg.fragmentDamage,
    hitRadius,
    life: range / Math.max(0.1, speed),
    hitIds: new Set(),
    aura: false,
    slowRadius: 0,
    wallRadius: COMBAT.projectileHitRadius,
    tickSec: 0.25,
    tickAcc: 0,
    mode: "fragment",
    stuckTargetId: null,
    explodeIn: 0,
    explodeDamage: 0,
    explodeRadius: 0,
    passBubbleIds: new Set(),
    armingIn: 0.02,
    isRunicFragment: true,
    fragmentHitBudget: hitBudget,
    maxFragmentsPerTarget: cfg.maxFragmentsPerTarget,
  };
}

/** Evenly spaced yaw offsets for a shatter cone or full radial burst. */
export function runicShardFragmentYaws(
  baseYaw: number,
  count: number,
  coneDegrees: number,
): number[] {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return [baseYaw];
  const cone = Math.max(0, coneDegrees);
  // Full circle: equal spacing with no duplicated endpoint.
  if (cone >= 359.5) {
    const step = (Math.PI * 2) / n;
    return Array.from({ length: n }, (_, i) => baseYaw + i * step);
  }
  const half = ((cone * Math.PI) / 180) * 0.5;
  const yaws: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    yaws.push(baseYaw - half + t * half * 2);
  }
  return yaws;
}

/** Even orbit slot offsets for `count` wisps (0, 2π/n, …). */
export function orbitingWispSlotPhases(count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  const step = (Math.PI * 2) / n;
  return Array.from({ length: n }, (_, i) => i * step);
}

/**
 * Evenly space `newCount` wisps while preserving the ring's current rotation.
 * Rotates ideal slots so the last existing wisp moves least — avoids canceling
 * the time-based spin when count changes.
 */
export function orbitingWispRetargetPhases(
  currentPhases: readonly number[],
  newCount: number,
): number[] {
  const ideal = orbitingWispSlotPhases(newCount);
  if (currentPhases.length === 0) return ideal;
  const lastIdx = Math.min(currentPhases.length, newCount) - 1;
  const ringOffset = currentPhases[lastIdx]! - ideal[lastIdx]!;
  return ideal.map((slot) => slot + ringOffset);
}

/**
 * World position for an orbiting wisp.
 * `orbitPhase` is the slot offset; rotation advances from absolute time.
 */
export function orbitingWispWorldPos(
  ownerX: number,
  ownerZ: number,
  orbitPhase: number,
  nowMs: number,
  cfg: { radius: number; height: number; angularSpeed: number },
): { x: number; y: number; z: number } {
  const angle = (nowMs / 1000) * cfg.angularSpeed + orbitPhase;
  return {
    x: ownerX + Math.cos(angle) * cfg.radius,
    y: cfg.height,
    z: ownerZ + Math.sin(angle) * cfg.radius,
  };
}

/** Shortest signed delta from `from` → `to` on a circle (radians). */
export function shortestAngleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Exponential approach of `current` toward `target` on a circle.
 * `halfLifeMs` is time to close half the gap.
 */
export function lerpOrbitPhase(
  current: number,
  target: number,
  dtMs: number,
  halfLifeMs: number,
): number {
  const hl = Math.max(1, halfLifeMs);
  const alpha = 1 - Math.pow(0.5, Math.max(0, dtMs) / hl);
  return current + shortestAngleDelta(current, target) * alpha;
}

/**
 * Project a desired world position onto an astral tether disk.
 * Preserves inward/tangential wish movement; stops only outward past `maxDistance`.
 */
export function constrainAstralTetherDesired(
  casterX: number,
  casterZ: number,
  desiredX: number,
  desiredZ: number,
  maxDistance: number,
): { x: number; z: number } {
  const max = Math.max(0.01, maxDistance);
  const dx = desiredX - casterX;
  const dz = desiredZ - casterZ;
  const dist = Math.hypot(dx, dz);
  if (dist <= max || dist < 1e-6) return { x: desiredX, z: desiredZ };
  const s = max / dist;
  return { x: casterX + dx * s, z: casterZ + dz * s };
}

/**
 * Clamp a target that is already outside the tether disk back onto the rim.
 */
export function clampAstralTetherPos(
  casterX: number,
  casterZ: number,
  targetX: number,
  targetZ: number,
  maxDistance: number,
): { x: number; z: number } {
  return constrainAstralTetherDesired(casterX, casterZ, targetX, targetZ, maxDistance);
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
 * Clamp a ground aim point to `maxRange` from the caster.
 * Degenerate aim (on top of caster) falls back along `yaw` at mid-range.
 */
export function clampGroundAim(
  owner: { x: number; z: number; yaw: number },
  aim: { x: number; z: number } | null | undefined,
  maxRange: number,
): Vec2 {
  const cap = Math.max(0.5, maxRange);
  if (
    !aim ||
    !Number.isFinite(aim.x) ||
    !Number.isFinite(aim.z)
  ) {
    return pointInFront(owner, owner.yaw, cap * 0.55);
  }
  const dx = aim.x - owner.x;
  const dz = aim.z - owner.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) {
    return pointInFront(owner, owner.yaw, cap * 0.55);
  }
  if (dist <= cap) return { x: aim.x, z: aim.z };
  const s = cap / dist;
  return { x: owner.x + dx * s, z: owner.z + dz * s };
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

/** Slipstream lane pose from caster feet along facing. */
export type SlipstreamLane = {
  origin: Vec2;
  mid: Vec2;
  end: Vec2;
  yaw: number;
  length: number;
  halfWidth: number;
};

/**
 * World-space wind lane: origin at caster, extending `length` along yaw.
 * Width = 2 * halfWidth (default 1.8m).
 */
export function slipstreamLaneFromCast(
  origin: Vec2,
  yaw: number,
  length: number,
  halfWidth: number,
): SlipstreamLane {
  const len = Math.max(1, length);
  const hw = Math.max(0.2, halfWidth);
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const end = { x: origin.x + fx * len, z: origin.z + fz * len };
  const mid = { x: origin.x + fx * (len * 0.5), z: origin.z + fz * (len * 0.5) };
  return { origin: { x: origin.x, z: origin.z }, mid, end, yaw, length: len, halfWidth: hw };
}

/**
 * Point-in-lane test (XZ oriented rectangle). Softens edges by `targetRadius`.
 */
export function pointInSlipstreamLane(
  lane: {
    originX: number;
    originZ: number;
    yaw: number;
    length: number;
    halfWidth: number;
  },
  target: Vec2,
  targetRadius = COMBAT.auraFootRadius,
): boolean {
  const dx = target.x - lane.originX;
  const dz = target.z - lane.originZ;
  const fx = Math.sin(lane.yaw);
  const fz = Math.cos(lane.yaw);
  const along = dx * fx + dz * fz;
  const across = dx * fz - dz * fx;
  const soft = Math.max(0, targetRadius);
  return (
    along >= -soft &&
    along <= lane.length + soft &&
    Math.abs(across) <= lane.halfWidth + soft
  );
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
  targetRadius: number = COMBAT.playerHitRadius,
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
  circles: readonly CircleCollider[] = [],
  boxes: readonly BoxCollider[] = [],
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
    const t = lastFreeTBeforeWalls(origin, to, wallRadius, walls, circles, boxes);
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
    /** Solid round props, which hard-clip exactly like walls. */
    circles?: readonly CircleCollider[];
    /** Oriented prop boxes, which hard-clip exactly like walls. */
    boxes?: readonly BoxCollider[];
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
  const t = lastFreeTBeforeWalls(origin, to, wallRadius, walls, opts?.circles ?? [], opts?.boxes ?? []);
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

  for (const b of bodies) {
    if (b.id === targetId || b.id === ownerId) continue;
    if (b.vulnerable === false || b.hp <= 0) continue;
    const bx = b.x - origin.x;
    const bz = b.z - origin.z;
    const along = bx * nx + bz * nz;
    if (along <= 0 || along >= distT - softEpsilon) continue;
    const perp = Math.abs(bx * nz - bz * nx);
    // Per-body: a barn-sized target casts a barn-sized shadow.
    if (perp <= hitRadiusOf(b)) return true;
  }
  return false;
}

export type ResolveConeHitsOpts = {
  walls?: readonly WallCollider[];
  /** Solid round props, which block a cone exactly as walls do. */
  circles?: readonly CircleCollider[];
  /** Oriented prop boxes, which block a cone exactly as walls do. */
  boxes?: readonly BoxCollider[];
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
  const circles = opts?.circles ?? [];
  const boxes = opts?.boxes ?? [];
  const softOcclude = opts?.softOcclude === true;
  const occlude = walls.length > 0 || circles.length > 0 || boxes.length > 0 || softOcclude;

  const hits: { targetId: string; damage: number; hpAfter: number }[] = [];
  for (const body of bodies) {
    if (body.id === ownerId) continue;
    if (body.vulnerable === false) continue;
    if (body.hp <= 0) continue;
    if (!canHurt(ownerId, body.id)) continue;
    if (!inFacingCone(origin, yaw, length, halfAngle, body, hitRadiusOf(body))) {
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
        { excludeId: body.id, circles, boxes },
      );
      // Reach must overlap the target circle — same footprint the VFX soft-stops at.
      if (dist > maxLen + hitRadiusOf(body)) continue;
    }

    const nextHp = Math.max(0, body.hp - damage);
    hits.push({ targetId: body.id, damage, hpAfter: nextHp });
  }
  return hits;
}

/**
 * First (nearest) body along a facing ray/cone — used by Arc Thread acquisition.
 */
export function resolveFirstRayHit(
  origin: Vec2,
  yaw: number,
  length: number,
  halfAngle: number,
  ownerId: string,
  bodies: CombatBody[],
  canHurt: (ownerId: string, targetId: string) => boolean,
  opts?: ResolveConeHitsOpts,
): { targetId: string; dist: number } | null {
  let best: { targetId: string; dist: number } | null = null;
  for (const body of bodies) {
    if (body.id === ownerId) continue;
    if (body.vulnerable === false) continue;
    if (body.hp <= 0) continue;
    if (!canHurt(ownerId, body.id)) continue;
    if (!inFacingCone(origin, yaw, length, halfAngle, body, hitRadiusOf(body))) {
      continue;
    }

    const walls = opts?.walls ?? [];
    const circles = opts?.circles ?? [];
    const boxes = opts?.boxes ?? [];
    const softOcclude = opts?.softOcclude === true;
    const occlude = walls.length > 0 || circles.length > 0 || boxes.length > 0 || softOcclude;
    const dx = body.x - origin.x;
    const dz = body.z - origin.z;
    const dist = Math.hypot(dx, dz);

    if (occlude) {
      const rayYaw = dist > 1e-6 ? Math.atan2(dx, dz) : yaw;
      const maxLen = coneRayMaxLength(
        origin,
        rayYaw,
        length,
        walls,
        softOcclude ? bodies : [],
        ownerId,
        { excludeId: body.id, circles, boxes },
      );
      if (dist > maxLen + hitRadiusOf(body)) continue;
    }

    if (!best || dist < best.dist) best = { targetId: body.id, dist };
  }
  return best;
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
    if (!circlesOverlap(center.x, center.z, radius, body.x, body.z, hitRadiusOf(body))) {
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

/** Projectile died to a wall / protection disc (no body hit). */
export type ProjectileWallHitEvent = {
  projectileId: string;
  ownerId: string;
  abilityId: string;
  x: number;
  z: number;
  /** Protection / Hand Shield collider id when blocked by a disc (not a world wall). */
  blockBubbleId?: string;
  /**
   * Fuse projectiles that plant on the disc instead of shattering —
   * still counts as a Hand Shield block for retaliate.
   */
  detonatedOnBlock?: boolean;
};

export type ProjectileTickResult = {
  removedIds: string[];
  hits: ProjectileHitEvent[];
  slows: ProjectileSlowEvent[];
  explodes: ProjectileExplodeEvent[];
  wallHits: ProjectileWallHitEvent[];
};

/**
 * Combat FX `variant` for projectile vs wall / block disc (downward fizzle VFX).
 * Volcano rocks use 1 (telegraph) / 2 (impact).
 */
export const COMBAT_FX_VARIANT_WALL_HIT = 3;

function armDetonate(p: ProjectileSim, delaySec: number, mode: "stuck" | "grounded", targetId: string | null) {
  p.mode = mode;
  p.stuckTargetId = targetId;
  p.vx = 0;
  p.vz = 0;
  p.explodeIn = delaySec;
  p.life = Math.max(p.life, delaySec + 0.05);
}

/** Advance projectiles; mutates projectile positions and hitIds.
 *  Wall / block-disc collisions despawn without a damage hit and report
 *  `wallHits` for client fizzle VFX, unless the projectile has a detonate fuse
 *  — then it plants and explodes.
 */
export function tickProjectiles(
  projectiles: ProjectileSim[],
  dt: number,
  bodies: CombatBody[],
  canHurt: (ownerId: string, targetId: string) => boolean,
  walls: readonly WallCollider[] = [],
  detonateDelaySecByAbility: (abilityId: string) => number = () => 0,
  protectionBubbles: readonly ProtectionBubbleCollider[] = [],
  /**
   * Solid round props -- rocks, pillars, tree trunks.
   *
   * Separate from `walls` because the two come from different sources, but
   * both stop a shot. Projectiles used to test walls only, so every circular
   * prop in every map was transparent to fire.
   */
  circles: readonly CircleCollider[] = [],
  boxes: readonly BoxCollider[] = [],
  /** Ally-heal pierce projectiles (Blooming Path). Defaults to never. */
  canHeal: (ownerId: string, targetId: string) => boolean = () => false,
): ProjectileTickResult {
  const removedIds: string[] = [];
  const hits: ProjectileHitEvent[] = [];
  const slows: ProjectileSlowEvent[] = [];
  const explodes: ProjectileExplodeEvent[] = [];
  const wallHits: ProjectileWallHitEvent[] = [];

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

    if (p.armingIn > 0) {
      p.armingIn = Math.max(0, p.armingIn - dt);
      if (p.life <= 0) {
        if (canDetonate) {
          armDetonate(p, fuseSec, "grounded", null);
        } else {
          removedIds.push(p.id);
        }
      }
      continue;
    }

    const hitWall =
      (walls.length > 0 || circles.length > 0 || boxes.length > 0) &&
      projectileHitsSolids(fromX, fromZ, p.x, p.z, p.wallRadius, walls, circles, boxes);
    const hitBubble =
      !hitWall &&
      protectionBubbles.length > 0
        ? projectileHitsProtectionBubbles(
            fromX,
            fromZ,
            p.x,
            p.z,
            p.wallRadius,
            protectionBubbles,
            p.passBubbleIds,
          )
        : null;
    if (hitWall || hitBubble) {
      if (canDetonate) {
        p.x = fromX;
        p.z = fromZ;
        armDetonate(p, fuseSec, "grounded", null);
        // Hand Shield still retaliates when a fuse projectile plants on the disc.
        if (hitBubble?.id) {
          wallHits.push({
            projectileId: p.id,
            ownerId: p.ownerId,
            abilityId: p.abilityId,
            x: fromX,
            z: fromZ,
            blockBubbleId: hitBubble.id,
            detonatedOnBlock: true,
          });
        }
      } else {
        removedIds.push(p.id);
        wallHits.push({
          projectileId: p.id,
          ownerId: p.ownerId,
          abilityId: p.abilityId,
          x: fromX,
          z: fromZ,
          blockBubbleId: hitBubble?.id,
        });
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
      if (p.healAllies) {
        if (!canHeal(p.ownerId, body.id)) continue;
      } else if (!canHurt(p.ownerId, body.id)) {
        continue;
      }
      if (!circlesOverlap(p.x, p.z, p.hitRadius, body.x, body.z, hitRadiusOf(body))) {
        continue;
      }
      // Runic shatter: cap how many fragments from one burst can hit the same target.
      if (p.isRunicFragment && p.fragmentHitBudget) {
        const used = p.fragmentHitBudget.get(body.id) ?? 0;
        if (used >= (p.maxFragmentsPerTarget ?? 3)) continue;
        p.fragmentHitBudget.set(body.id, used + 1);
      }
      p.hitIds.add(body.id);
      let hitDamage = p.damage;
      if (
        p.minDamage != null &&
        p.maxDamage != null &&
        p.maxDamage > p.minDamage
      ) {
        const travel = Math.hypot(
          p.x - (p.spawnX ?? p.x),
          p.z - (p.spawnZ ?? p.z),
        );
        const rampStart = p.damageRampStartDistance ?? 3;
        const rampEnd = p.maxDamageDistance ?? 14;
        const t = Math.max(
          0,
          Math.min(1, (travel - rampStart) / Math.max(1e-4, rampEnd - rampStart)),
        );
        hitDamage = Math.round(p.minDamage + (p.maxDamage - p.minDamage) * t);
      }
      const hpAfter = Math.max(0, body.hp - hitDamage);
      hits.push({
        projectileId: p.id,
        ownerId: p.ownerId,
        abilityId: p.abilityId,
        targetId: body.id,
        damage: hitDamage,
        hpAfter,
        x: body.x,
        z: body.z,
      });
      if (canDetonate) {
        armDetonate(p, fuseSec, "stuck", body.id);
        break;
      }
      if (p.pierce) {
        // Keep flying; allow further targets this tick / later frames.
        continue;
      }
      removedIds.push(p.id);
      break;
    }
  }

  return { removedIds: [...new Set(removedIds)], hits, slows, explodes, wallHits };
}

/** Advance returning projectiles (outbound pierce → turn → homing return). */
export function tickReturningProjectiles(
  projectiles: ProjectileSim[],
  dt: number,
  bodies: CombatBody[],
  canHurt: (ownerId: string, targetId: string) => boolean,
  walls: readonly WallCollider[] = [],
  protectionBubbles: readonly ProtectionBubbleCollider[] = [],
  circles: readonly CircleCollider[] = [],
  boxes: readonly BoxCollider[] = [],
): ProjectileTickResult {
  const removedIds: string[] = [];
  const hits: ProjectileHitEvent[] = [];
  const wallHits: ProjectileWallHitEvent[] = [];
  const bodyById = new Map<string, CombatBody>();
  for (const b of bodies) bodyById.set(b.id, b);

  const beginTurn = (p: ProjectileSim) => {
    p.returnPhase = "turning";
    p.mode = "turning";
    p.vx = 0;
    p.vz = 0;
    p.turnDelayRemaining = p.turnDelaySec ?? 0.07;
  };

  for (const p of projectiles) {
    if (!p.returnPhase) continue;

    p.ageSec = (p.ageSec ?? 0) + dt;
    if ((p.maxLifetimeSec ?? 2.2) > 0 && p.ageSec >= (p.maxLifetimeSec ?? 2.2)) {
      removedIds.push(p.id);
      continue;
    }

    const owner = bodyById.get(p.ownerId);
    if (!owner || owner.hp <= 0) {
      removedIds.push(p.id);
      continue;
    }

    const speed = p.projectileSpeed ?? 15;

    if (p.returnPhase === "turning") {
      p.turnDelayRemaining = Math.max(0, (p.turnDelayRemaining ?? 0) - dt);
      if (p.turnDelayRemaining <= 0) {
        p.returnPhase = "returning";
        p.mode = "returning";
        const dir = dirFromTo({ x: p.x, z: p.z }, { x: owner.x, z: owner.z });
        p.vx = dir.x * speed;
        p.vz = dir.z * speed;
      }
      continue;
    }

    const fromX = p.x;
    const fromZ = p.z;

    if (p.returnPhase === "outbound") {
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.life -= dt;
      const stepDist = Math.hypot(p.x - fromX, p.z - fromZ);
      p.outboundTraveled = (p.outboundTraveled ?? 0) + stepDist;

      if (p.armingIn > 0) {
        p.armingIn = Math.max(0, p.armingIn - dt);
        continue;
      }

      const hitWall =
        (walls.length > 0 || circles.length > 0 || boxes.length > 0) &&
        projectileHitsSolids(fromX, fromZ, p.x, p.z, p.wallRadius, walls, circles, boxes);
      const hitBubble =
        !hitWall &&
        protectionBubbles.length > 0
          ? projectileHitsProtectionBubbles(
              fromX,
              fromZ,
              p.x,
              p.z,
              p.wallRadius,
              protectionBubbles,
              p.passBubbleIds,
            )
          : null;

      if (hitWall || hitBubble) {
        p.x = fromX;
        p.z = fromZ;
        if (hitBubble?.id) {
          wallHits.push({
            projectileId: p.id,
            ownerId: p.ownerId,
            abilityId: p.abilityId,
            x: fromX,
            z: fromZ,
            blockBubbleId: hitBubble.id,
          });
        }
        beginTurn(p);
        continue;
      }

      if (p.life <= 0 || (p.outboundTraveled ?? 0) >= (p.maxOutboundRange ?? 9)) {
        beginTurn(p);
      }

      for (const body of bodies) {
        if (body.id === p.ownerId) continue;
        if (p.hitIds.has(body.id)) continue;
        if (body.vulnerable === false || body.hp <= 0) continue;
        if (!canHurt(p.ownerId, body.id)) continue;
        if (!circlesOverlap(p.x, p.z, p.hitRadius, body.x, body.z, hitRadiusOf(body))) {
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
      }
      continue;
    }

    // --- Returning leg ---
    const dir = dirFromTo({ x: p.x, z: p.z }, { x: owner.x, z: owner.z });
    p.vx = dir.x * speed;
    p.vz = dir.z * speed;
    p.x += p.vx * dt;
    p.z += p.vz * dt;

    // Catch vs caster center only — do not add player hit radius (spawn sits
    // inside that inflated disc and would despawn on a near-spawn turnaround).
    const catchR = p.returnCatchRadius ?? 0.6;
    const toOwner = Math.hypot(p.x - owner.x, p.z - owner.z);
    if (toOwner <= catchR) {
      removedIds.push(p.id);
      continue;
    }

    const hitWall =
      (walls.length > 0 || circles.length > 0 || boxes.length > 0) &&
      projectileHitsSolids(fromX, fromZ, p.x, p.z, p.wallRadius, walls, circles, boxes);
    const hitBubble =
      !hitWall &&
      protectionBubbles.length > 0
        ? projectileHitsProtectionBubbles(
            fromX,
            fromZ,
            p.x,
            p.z,
            p.wallRadius,
            protectionBubbles,
            p.passBubbleIds,
          )
        : null;
    if (hitWall || hitBubble) {
      removedIds.push(p.id);
      wallHits.push({
        projectileId: p.id,
        ownerId: p.ownerId,
        abilityId: p.abilityId,
        x: fromX,
        z: fromZ,
        blockBubbleId: hitBubble?.id,
      });
      continue;
    }

    const returnDmg = p.returnDamage ?? p.damage;
    const returnHits = p.returnHitIds ?? p.hitIds;
    for (const body of bodies) {
      if (body.id === p.ownerId) continue;
      if (returnHits.has(body.id)) continue;
      if (body.vulnerable === false || body.hp <= 0) continue;
      if (!canHurt(p.ownerId, body.id)) continue;
      if (!circlesOverlap(p.x, p.z, p.hitRadius, body.x, body.z, hitRadiusOf(body))) {
        continue;
      }
      returnHits.add(body.id);
      const hpAfter = Math.max(0, body.hp - returnDmg);
      hits.push({
        projectileId: p.id,
        ownerId: p.ownerId,
        abilityId: p.abilityId,
        targetId: body.id,
        damage: returnDmg,
        hpAfter,
        x: body.x,
        z: body.z,
      });
    }
  }

  return {
    removedIds: [...new Set(removedIds)],
    hits,
    slows: [],
    explodes: [],
    wallHits,
  };
}

export function abilityOrThrow(id: string): AbilityDef {
  const def = ABILITIES[id];
  if (!def) throw new Error(`Unknown ability ${id}`);
  return def;
}

export function dirFromTo(from: Vec2, to: Vec2): Vec2 {
  return normalize2(to.x - from.x, to.z - from.z);
}
