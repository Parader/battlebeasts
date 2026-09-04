import {
  ABILITIES,
  COLLISION,
  MAGMA_ORBS_CAST,
  RIFT_FISSURE_CAST,
  abilityEffectKind,
  buildMagmaOrbsFlightPath,
  clampGroundAim,
  clampTargetBeforeWalls,
  firewallWallPoints,
  magmaOrbsMaxFlightTs,
  pointInFront,
  projectileBlockers,
  resolveMagmaOrbsMeetRange,
  sampleMagmaOrbsFlight,
  sampleTravel,
  sweepTravel,
  travelDistance,
  type AbilityDef,
  type CircleCollider,
  type BoxCollider,
  type StaticCollider,
  type WallCollider,
} from "@battlebeasts/shared";

export type CastPreviewKind =
  | "none"
  | "placeCircle"
  | "selfCircle"
  | "allyBind"
  | "cone"
  | "wall"
  | "line"
  | "blink"
  | "forwardPlace"
  | "projectile"
  | "skillshot"
  | "meleeArc"
  | "magmaOrbs";

export type CastPreview = {
  kind: CastPreviewKind;
  abilityId: string;
  color: string;
  /** Soft max-range ring at caster feet (0 = none). */
  rangeRing: number;
  /** When true, range ring reads as refused (thin red). */
  rangeRingOutOfRange: boolean;
  /** Self / cone / melee size at feet. */
  feetRadius: number;
  halfAngle: number;
  /** Placed / blink / aim point. */
  aimX: number;
  aimZ: number;
  aimRadius: number;
  /** Wall / line corridor. */
  midX: number;
  midZ: number;
  yaw: number;
  length: number;
  halfWidth: number;
  /** Projectile aim line end (world). */
  lineEndX: number;
  lineEndZ: number;
  /** Magma Orbs: ground Bezier polylines as flat [x,z, x,z, …]. */
  curveLeft: number[];
  curveRight: number[];
};

const EMPTY: Omit<CastPreview, "abilityId" | "color"> = {
  kind: "none",
  rangeRing: 0,
  rangeRingOutOfRange: false,
  feetRadius: 0,
  halfAngle: 0.7,
  aimX: 0,
  aimZ: 0,
  aimRadius: 0,
  midX: 0,
  midZ: 0,
  yaw: 0,
  length: 0,
  halfWidth: 0,
  lineEndX: 0,
  lineEndZ: 0,
  curveLeft: [],
  curveRight: [],
};

const MAGMA_CURVE_STEPS = 28;

/**
 * Aliased to the shared splitter so previews stop exactly where the server
 * says the cast will. Any divergence here shows up as a telegraph that lies.
 */
const wallsAndCircles = projectileBlockers;

function clampPlace(
  owner: { x: number; z: number; yaw: number },
  aim: { x: number; z: number } | null,
  range: number,
  hitRadius: number,
  statics: readonly StaticCollider[],
): { x: number; z: number } {
  const aimed = clampGroundAim(owner, aim, range);
  const { walls, circles, boxes } = wallsAndCircles(statics);
  return clampTargetBeforeWalls(owner, aimed, hitRadius, walls, circles, boxes);
}

function blinkLand(
  owner: { x: number; z: number; yaw: number },
  distance: number,
  statics: readonly StaticCollider[],
): { x: number; z: number } {
  const ideal = sampleTravel(owner, owner.yaw, Math.max(0.5, distance), 1);
  return sweepTravel(owner, ideal, COLLISION.playerRadius, statics);
}

function sampleMagmaCurves(
  owner: { x: number; z: number; yaw: number },
  collide: { x: number; z: number },
  statics: readonly StaticCollider[],
): { left: number[]; right: number[] } {
  const meet = Math.hypot(collide.x - owner.x, collide.z - owner.z);
  const path = buildMagmaOrbsFlightPath(owner, owner.yaw, meet, collide);
  const { walls, circles, boxes } = wallsAndCircles(statics);
  const maxT = magmaOrbsMaxFlightTs(
    path,
    walls,
    MAGMA_ORBS_CAST.flightHitRadius,
    circles,
    boxes,
  );
  const left: number[] = [];
  const right: number[] = [];
  const stepsL = Math.max(2, Math.ceil(MAGMA_CURVE_STEPS * Math.max(0.05, maxT.left)));
  const stepsR = Math.max(2, Math.ceil(MAGMA_CURVE_STEPS * Math.max(0.05, maxT.right)));
  for (let i = 0; i <= stepsL; i++) {
    const t = (maxT.left * i) / stepsL;
    const p = sampleMagmaOrbsFlight(path, t).left;
    left.push(p.x, p.z);
  }
  for (let i = 0; i <= stepsR; i++) {
    const t = (maxT.right * i) / stepsR;
    const p = sampleMagmaOrbsFlight(path, t).right;
    right.push(p.x, p.z);
  }
  return { left, right };
}

/**
 * Classify ability → preview kind. Portal is handled by PortalLandingTelegraph.
 */
export function castPreviewKindFor(def: AbilityDef): CastPreviewKind {
  if (def.id === "portal") return "none";

  const kind = abilityEffectKind(def);
  if (kind === "magmaOrbs") return "magmaOrbs";
  if (kind === "volcano" || kind === "poisonCloud" || kind === "shrooms") {
    return "placeCircle";
  }
  if (kind === "firewall") return "wall";
  if (kind === "slipstream" || kind === "spikeWave") return "line";
  if (kind === "coneChannel" || kind === "silenceSweep") return "cone";
  if (kind === "arcThread") return "none";
  if (kind === "soulRelay") return "allyBind";
  if (kind === "lifeLeech" || kind === "healBeam") return "line";
  if (kind === "riftFissure") return "placeCircle";
  if (
    kind === "smokeBomb" ||
    kind === "holyGround" ||
    kind === "protectionBubble" ||
    (kind === "standard" && def.shape === "aoe" && def.range <= 0 && (def.radius ?? 0) > 0)
  ) {
    return "selfCircle";
  }
  if (kind === "decoy") return "placeCircle";

  if (def.shape === "dash" || def.id === "smash" || def.id === "spiritForm") {
    return "blink";
  }
  if (def.shape === "melee") {
    // Crescent reads better without a ground ghost.
    if (def.id === "crescent") return "none";
    return "meleeArc";
  }
  if (def.shape === "projectile" || kind === "fireball") return "skillshot";

  // Self buffs / counters — no ground ghost.
  if (def.shape === "buff") return "none";

  if (def.shape === "aoe" && (def.radius ?? 0) > 0) {
    return def.range > 0 ? "placeCircle" : "selfCircle";
  }

  return "none";
}

export type CastPreviewInput = {
  abilityId: string;
  color: string;
  owner: { x: number; z: number; yaw: number };
  aim: { x: number; z: number } | null;
  statics: readonly StaticCollider[];
  /** Optional healable bodies for ally-bind aim (players / dummies). */
  healables?: readonly { id: string; x: number; z: number }[];
};

/** Build a frame of cast-aim geometry (world XZ). */
export function resolveCastPreview(input: CastPreviewInput): CastPreview {
  const def = ABILITIES[input.abilityId];
  if (!def) {
    return { ...EMPTY, abilityId: input.abilityId, color: input.color };
  }

  const kind = castPreviewKindFor(def);
  const base: CastPreview = {
    ...EMPTY,
    kind,
    abilityId: input.abilityId,
    color: input.color,
    yaw: input.owner.yaw,
  };
  if (kind === "none") return base;

  const owner = input.owner;
  const aim = input.aim;
  const statics = input.statics;

  switch (kind) {
    case "magmaOrbs": {
      const meet = resolveMagmaOrbsMeetRange(owner, aim);
      let placed = pointInFront(owner, owner.yaw, meet);
      if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.z)) {
        const dx = aim.x - owner.x;
        const dz = aim.z - owner.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.05) {
          const s = meet / dist;
          placed = { x: owner.x + dx * s, z: owner.z + dz * s };
        }
      }
      const { walls, circles, boxes } = wallsAndCircles(statics);
      placed = clampTargetBeforeWalls(owner, placed, 0.35, walls, circles, boxes);
      const curves = sampleMagmaCurves(owner, placed, statics);
      return {
        ...base,
        aimX: placed.x,
        aimZ: placed.z,
        aimRadius: Math.max(0.8, def.radius ?? MAGMA_ORBS_CAST.blastRadius),
        curveLeft: curves.left,
        curveRight: curves.right,
      };
    }
    case "placeCircle": {
      const range = Math.max(0.5, def.range > 0 ? def.range : 8);
      // Rift mouth is tiny — preview ring stays readable like the old forward place.
      const aimRadius =
        def.id === "riftFissure"
          ? 1.1
          : Math.max(0.4, def.radius ?? 1.2);
      const placed = clampPlace(owner, aim, range, Math.max(0.35, aimRadius * 0.35), statics);
      return {
        ...base,
        rangeRing: def.id === "riftFissure" ? range : 0,
        aimX: placed.x,
        aimZ: placed.z,
        aimRadius,
      };
    }
    case "selfCircle": {
      return {
        ...base,
        feetRadius: Math.max(0.6, def.radius ?? 2),
        aimX: owner.x,
        aimZ: owner.z,
        aimRadius: Math.max(0.6, def.radius ?? 2),
      };
    }
    case "allyBind": {
      const range = Math.max(1, def.range > 0 ? def.range : 8.5);
      const fx = Math.sin(owner.yaw);
      const fz = Math.cos(owner.yaw);
      const aimPt =
        aim && Number.isFinite(aim.x) && Number.isFinite(aim.z)
          ? aim
          : { x: owner.x, z: owner.z };

      let best: {
        id: string;
        x: number;
        z: number;
        aimDist: number;
        casterDist: number;
        isSelf: boolean;
      } = {
        id: "",
        x: owner.x,
        z: owner.z,
        aimDist: Math.hypot(owner.x - aimPt.x, owner.z - aimPt.z),
        casterDist: 0,
        isSelf: true,
      };

      const consider = (
        id: string,
        x: number,
        z: number,
        isSelf: boolean,
      ) => {
        const dx = x - owner.x;
        const dz = z - owner.z;
        const casterDist = Math.hypot(dx, dz);
        if (!isSelf) {
          if (casterDist < 0.05) return;
          const dot = (dx * fx + dz * fz) / casterDist;
          if (dot < 0.5) return;
        }
        const aimDist = Math.hypot(x - aimPt.x, z - aimPt.z);
        if (
          aimDist < best.aimDist - 1e-4 ||
          (Math.abs(aimDist - best.aimDist) <= 1e-4 && casterDist < best.casterDist)
        ) {
          best = { id, x, z, aimDist, casterDist, isSelf };
        }
      };

      consider("", owner.x, owner.z, true);
      for (const h of input.healables ?? []) {
        if (h.id === "") continue;
        consider(h.id, h.x, h.z, false);
      }

      const inRange = best.casterDist <= range;
      const oorIntent = !best.isSelf && !inRange;
      const selfIntent = best.isSelf;
      return {
        ...base,
        rangeRing: range,
        rangeRingOutOfRange: oorIntent,
        feetRadius: 0,
        aimX: !oorIntent && !selfIntent ? best.x : owner.x,
        aimZ: !oorIntent && !selfIntent ? best.z : owner.z,
        // Ally in range: target ring. Self / no lock: soft self ring. OOR: range only.
        aimRadius: !oorIntent && !selfIntent ? 0.85 : oorIntent ? 0 : 0.65,
      };
    }
    case "cone": {
      const length = Math.max(
        1,
        def.mistStartRange != null && def.mistStartRange > 0
          ? def.range
          : def.range > 0
            ? def.range
            : 8,
      );
      return {
        ...base,
        feetRadius: length,
        halfAngle: Math.max(0.15, def.coneHalfAngle ?? 0.7),
        rangeRing: 0,
      };
    }
    case "wall": {
      const body = {
        id: "preview",
        x: owner.x,
        z: owner.z,
        yaw: owner.yaw,
        hp: 1,
        maxHp: 1,
      };
      const wall = firewallWallPoints(body, def);
      const halfWidth = Math.max(0.35, def.radius ?? 0.9);
      return {
        ...base,
        midX: wall.mid.x,
        midZ: wall.mid.z,
        yaw: wall.yaw,
        length: wall.halfLength * 2,
        halfWidth,
      };
    }
    case "line": {
      const length = Math.max(1, def.range > 0 ? def.range : 10);
      const halfWidth = Math.max(
        0.25,
        def.radius ??
          (def.coneHalfAngle != null ? length * Math.tan(def.coneHalfAngle) : 0.55),
      );
      const midDist = length * 0.5;
      const mid = pointInFront(owner, owner.yaw, midDist);
      // Capsule length is along local +X; rotate yaw+π/2 so it runs along facing.
      return {
        ...base,
        midX: mid.x,
        midZ: mid.z,
        yaw: owner.yaw + Math.PI / 2,
        length,
        halfWidth,
        rangeRing: 0,
      };
    }
    case "blink": {
      const dist =
        travelDistance(def) > 0
          ? travelDistance(def)
          : def.range > 0
            ? def.range
            : 5;
      // Smash / aim dashes: land at clamped cursor when range allows.
      let land: { x: number; z: number };
      if (def.id === "smash" && def.range > 0) {
        land = clampPlace(owner, aim, def.range, Math.max(0.5, def.radius ?? 2), statics);
      } else {
        land = blinkLand(owner, dist, statics);
      }
      const aoe = Math.max(0.5, def.radius ?? 0.95);
      return {
        ...base,
        rangeRing: 0,
        aimX: land.x,
        aimZ: land.z,
        aimRadius: aoe,
        lineEndX: land.x,
        lineEndZ: land.z,
      };
    }
    case "forwardPlace": {
      const forward = Math.max(1, RIFT_FISSURE_CAST.placeForward ?? def.range ?? 2.1);
      const mouth = pointInFront(owner, owner.yaw, forward);
      const { walls, circles, boxes } = wallsAndCircles(statics);
      const clamped = clampTargetBeforeWalls(owner, mouth, 0.55, walls, circles, boxes);
      return {
        ...base,
        aimX: clamped.x,
        aimZ: clamped.z,
        aimRadius: 1.1,
        rangeRing: 0,
      };
    }
    case "skillshot": {
      const rawRange = Math.max(1, def.range > 0 ? def.range : 12);
      // Long / "infinite" ranges get a readable fixed corridor (not cursor-scaled).
      const length = rawRange > 24 ? 12 : rawRange;
      const r = def.radius ?? 0.55;
      // Thin skillshots (Prism Lance) keep a readable but narrow corridor.
      const halfWidth = Math.max(r < 0.35 ? 0.12 : 0.4, Math.min(1.05, r));
      const mid = pointInFront(owner, owner.yaw, length * 0.5);
      const tip = pointInFront(owner, owner.yaw, length);
      return {
        ...base,
        midX: mid.x,
        midZ: mid.z,
        yaw: owner.yaw,
        length,
        halfWidth,
        rangeRing: 0,
        lineEndX: tip.x,
        lineEndZ: tip.z,
        aimX: tip.x,
        aimZ: tip.z,
        aimRadius: halfWidth,
      };
    }
    case "projectile": {
      // Legacy alias — treat as skillshot.
      const rawRange = Math.max(1, def.range > 0 ? def.range : 12);
      const length = rawRange > 24 ? 12 : rawRange;
      const r = def.radius ?? 0.55;
      const halfWidth = Math.max(r < 0.35 ? 0.12 : 0.4, Math.min(1.05, r));
      const mid = pointInFront(owner, owner.yaw, length * 0.5);
      const tip = pointInFront(owner, owner.yaw, length);
      return {
        ...base,
        kind: "skillshot",
        midX: mid.x,
        midZ: mid.z,
        yaw: owner.yaw,
        length,
        halfWidth,
        lineEndX: tip.x,
        lineEndZ: tip.z,
      };
    }
    case "meleeArc": {
      const reach = Math.max(0.8, def.range > 0 ? def.range : 2);
      return {
        ...base,
        feetRadius: reach,
        halfAngle: 0.85,
        aimRadius: Math.max(0.5, def.radius ?? 1),
      };
    }
    default:
      return base;
  }
}
