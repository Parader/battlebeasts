import type { Room } from "@colyseus/core";
import {
  ABILITIES,
  BARRIER_CAST,
  clampEnergy,
  COLLISION,
  COMBAT,
  energyFor,
  EnergyLimiter,
  type EnergySource,
  flexCost,
  GROOVE_CAST,
  HEAL_BEAM_CAST,
  LIFE_LEECH_CAST,
  MOVE_SPEED,
  PRACTICE_DUMMY_MAX_HP,
  POISON_CLOUD_CAST,
  SMOKE_BOMB_CAST,
  HOLY_GROUND_CAST,
  SLIPSTREAM_CAST,
  SOUL_RELAY_CAST,
  SOUL_SEVER_CAST,
  soulSeverSnapDamage,
  ARC_BLADE_CAST,
  arcBladeHitDamage,
  BLOOMING_PATH_CAST,
  VERDANT_LEAP_CAST,
  BULWARK_CHARGE_CAST,
  PREDATOR_STEP_CAST,
  REBOUND_CAST,
  TELEPORT_SLAM_CAST,
  RIFT_FISSURE_CAST,
  VOLCANO_CAST,
  MAGMA_ORBS_CAST,
  resolveMagmaOrbsMeetRange,
  FIREBALL_CAST,
  fireballCharge01,
  fireballConfirmRecoveryWallMs,
  fireballLaunchDelayWallMs,
  fireballLerp,
  PROTECTION_BUBBLE_CAST,
  SHROOM_CAST,
  SPIRIT_FORM_CAST,
  ARC_THREAD_CAST,
  ASTRAL_CHAIN_CAST,
  STARTER_COLORS,
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  REVENGE_CAST,
  HAND_SHIELD_CAST,
  HAND_SHIELD_ARMED_MS,
  abilityBreaksAstralChain,
  abilityEffectKind,
  abilityTriggersCounter,
  abilityCanProcFifthCadence,
  abilityCanProcOpeningSalvo,
  abilityCanProcOpportunist,
  abilityCanProcOverflow,
  abilityCanProcProtectiveInstinct,
  FIFTH_CADENCE_SPELL_INTERVAL,
  canInterruptOtherCast,
  canPlayerCancelCast,
  channelChargeDistance,
  abilityComboHitDamage,
  clampGroundAim,
  clampTargetBeforeWalls,
  projectileBlockers,
  COMBAT_ENGAGE_LINGER_MS,
  OPENING_SALVO_COOLDOWN_MS,
  OVERFLOW_DURATION_MS,
  PROTECTIVE_INSTINCT_COOLDOWN_MS,
  PROTECTIVE_INSTINCT_DURATION_MS,
  COMBAT_FX_VARIANT_WALL_HIT,
  createProjectile,
  createReturningProjectile,
  createRunicFragment,
  runicShardFragmentYaws,
  orbitingWispRetargetPhases,
  orbitingWispWorldPos,
  lerpOrbitPhase,
  constrainAstralTetherDesired,
  dashOffset,
  isComboAbility,
  isInIFrameWindow,
  kitCooldownMs,
  kitScaledRadius,
  length2,
  meleeCenter,
  moveAndCollide,
  nextCastPhase,
  unitCollidersExcept,
  playerCollidersExcept,
  targetColliders,
  riftPortalColliders,
  volcanoColliders,
  phaseDurationMs,
  pointInFront,
  pointInSlipstreamLane,
  slipstreamLaneFromCast,
  buildMagmaOrbsFlightPath,
  magmaOrbsFlightT,
  magmaOrbsMaxFlightTs,
  sampleMagmaOrbsFlight,
  circlesOverlap,
  projectileEntersProtectionBubble,
  pointInProtectionBubble,
  type ProtectionBubbleCollider,
  resolveCastMoveMul,
  resolveComboContinueMoveMul,
  resolveCollisions,
  resolveInstantHits,
  resolveKit,
  resolveTravel,
  resolveConeHits,
  resolveFirstRayHit,
  coneRayMaxLength,
  inFacingCone,
  angleFromFacing,
  rollCrit,
  scaleForCrit,
  sampleTravel,
  spikeLinePoints,
  firewallWallPoints,
  sweepTravel,
  tickProjectiles,
  tickReturningProjectiles,
  isReturningProjectileSim,
  totalCastDurationMs,
  travelDistance,
  travelDurationMs,
  travelProgress01,
  travelTakeoffDelayMs,
  normalize2,
  nextFrostChillStacks,
  FROST_CHILL_MAX_STACKS,
  getStatus,
  type AbilityDef,
  type CastPhaseId,
  type CircleCollider,
  type BoxCollider,
  type CombatSessionKit,
  type StaticCollider,
  type CombatBody,
  type CombatFxEvent,
  type ProjectileSim,
  type TalentBuild,
  type Vec2,
  hitRadiusOf,
  PROP_TARGET_KIND,
  propTargetId,
  propTargetRadius,
  type MapPropPlacement,
} from "@battlebeasts/shared";
import {
  runEffectKindFire,
  type EffectKindFireArgs,
  type EffectKindFireHandlers,
} from "./effectKindHandlers";
import {
  BaseCityState,
  AstralChainState,
  DecoyState,
  OrbitingWispState,
  PlayerState,
  ProjectileState,
  ProtectionBubbleState,
  RiftPortalState,
  ShroomState,
  SoulSeverState,
  SpiritHuskState,
  VolcanoState,
  WorldTargetState,
} from "../schema/BaseCityState.js";
import { StatusSystem } from "../status/StatusSystem.js";

export type CombatRoomHooks = {
  canHurtPlayers: boolean;
  onTargetDamaged?: (targetId: string, damage: number, attackerSessionId: string) => void;
  /** Fired when a world target hits 0 HP, before soft-respawn reset. */
  onTargetKilled?: (targetId: string, killerSessionId: string) => void;
  onPlayerDamaged?: (sessionId: string, damage: number, attackerSessionId: string) => void;
};

type RoomLike = Room & {
  state: BaseCityState;
  broadcast: (type: string, message: unknown) => void;
};

type ActiveCast = {
  abilityId: string;
  phase: CastPhaseId;
  phaseEndsAt: number;
  /** Wall-clock when prep (or cast, if no prep) began — i-frame clock. */
  castStartedAt: number;
  /**
   * Confirm-on-release channel anchor (impact enter). Charge distance
   * and grace are measured from this, not castStartedAt.
   */
  channelAnchorAt?: number;
  yaw: number;
  effectFired: boolean;
  /** Stick direction frozen at cast start (Decoy drift). */
  moveX: number;
  moveZ: number;
  /** Ground aim frozen at cast start (Volcano place). */
  aimX?: number;
  aimZ?: number;
  /** Feet pose frozen at cast start (Protection Bubble place). */
  originX?: number;
  originZ?: number;
  /** Fireball: 0..1 charge at confirm; launch after release anim. */
  fireballCharge01?: number;
  fireballLaunchAt?: number;
  /** Magma Orbs meet range broadcast via cast_phase (aim sync). */
  magmaMeetRange?: number;
  /** Facing used for the last magma meet broadcast (detect late turns). */
  magmaMeetYaw?: number;
  /** Verdant Leap solo: short impact so heal+haste doesn't root for leap duration. */
  verdantSoloImpactMs?: number;
};

type PendingFireballBurn = {
  ownerId: string;
  abilityId: string;
  x: number;
  z: number;
  radius: number;
  nextTickAt: number;
  expiresAt: number;
  tickMs: number;
};

export type CastBeginOpts = {
  moveX?: number;
  moveZ?: number;
  aimX?: number;
  aimZ?: number;
};

/** How long the decoy clone stays in the world after spawn. */
const DECOY_LIFE_MS = 2000;
/** Stop when within this distance of cast-time ground aim. */
const DECOY_ARRIVE_M = 0.35;
/** Walk speed matches player so the clone sells the fake. */
const DECOY_SPEED = MOVE_SPEED;

type ActiveTravel = {
  abilityId: string;
  fromX: number;
  fromZ: number;
  yaw: number;
  distance: number;
  startAt: number;
  endAt: number;
  /** Fire melee/AoE hit + FX when translate completes. */
  pendingLandingEffect?: boolean;
  /** Last sample for path hit sweeps (Blood Rush). */
  lastX?: number;
  lastZ?: number;
  /** Targets already nicked this cast. */
  pathHitIds?: Set<string>;
  /** Spirit Form return — fly through walls to husk. */
  ignoreCollision?: boolean;
  /** Space arrival callbacks. */
  spaceArrive?: "verdantLeap" | "bulwarkCharge" | "predatorStep";
  /** Soft-target id (ally for Verdant, enemy for Predator). */
  followTargetId?: string;
  /** Stop short of follow target (m). */
  stopDistance?: number;
};

type ActiveKnockback = {
  targetId: string;
  kind: "player" | "target";
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  startAt: number;
  endAt: number;
  /** Optional facing applied when the shove/blink completes. */
  faceYaw?: number;
};

type ActiveCombo = {
  abilityId: string;
  hitsDone: number;
  /** 0 while mid-cast; wall time when continue window expires after a hit. */
  continueUntil: number;
};

type PendingSpike = {
  fireAt: number;
  x: number;
  z: number;
  radius: number;
  damage: number;
  ownerId: string;
  abilityId: string;
  /** Shared across one wave so a target is only hit once. */
  hitIds: Set<string>;
};

/** Arc Blade — delayed self-centered spin snapshots that follow the caster. */
type PendingArcBladeHit = {
  fireAt: number;
  ownerId: string;
  abilityId: string;
  radius: number;
  /** 0-based spin hit index (for damageByHit). */
  hitIndex: number;
};

/** Blooming Path — growing/lingering vine corridor that heals you and allies standing inside. */
type PendingBloomingPath = {
  ownerId: string;
  abilityId: string;
  /** Live projectile id while tip is traveling; null after tip despawns. */
  projectileId: string | null;
  originX: number;
  originZ: number;
  tipX: number;
  tipZ: number;
  halfWidth: number;
  heal: number;
  nextTickAt: number;
  tickMs: number;
  /** Set when tip despawns; while growing, treated as still active. */
  expiresAt: number | null;
};

/** Teleport Slam — blink shortly after the slam impact. */
type PendingTeleportSlamBlink = {
  fireAt: number;
  ownerId: string;
  abilityId: string;
  yaw: number;
  distance: number;
};

/** Ground AoE with `delayedImpactMs` — place first, damage later. */
type PendingDelayedAoe = {
  explodeAt: number;
  x: number;
  z: number;
  radius: number;
  damage: number;
  ownerId: string;
  abilityId: string;
};

/** Silence Sweep — thin blade rotates right→left across a frontal cone. */
type PendingSilenceSweep = {
  ownerId: string;
  abilityId: string;
  x: number;
  z: number;
  /** Caster facing at cast resolve. */
  yaw: number;
  range: number;
  coneHalfAngle: number;
  bladeHalfAngle: number;
  startAt: number;
  expiresAt: number;
  hitIds: Set<string>;
};

type PendingFirewall = {
  ownerId: string;
  abilityId: string;
  /** Wall segment centers for hit tests. */
  points: Vec2[];
  radius: number;
  damage: number;
  nextTickAt: number;
  expiresAt: number;
  tickMs: number;
};

/** Lingering circular poison cloud — status ticks only (no direct damage). */
type PendingPoisonCloud = {
  ownerId: string;
  abilityId: string;
  x: number;
  z: number;
  radius: number;
  nextTickAt: number;
  expiresAt: number;
  tickMs: number;
};

/** Ally buff circle at caster feet — refresh holyBlessed while standing inside. */
type PendingHolyGround = {
  ownerId: string;
  abilityId: string;
  x: number;
  z: number;
  radius: number;
  expiresAt: number;
};

/** World-space Slipstream wind lane — haste while inside; Tailwind on qualified exit. */
type PendingSlipstream = {
  ownerId: string;
  abilityId: string;
  originX: number;
  originZ: number;
  yaw: number;
  length: number;
  halfWidth: number;
  expiresAt: number;
  insideAccumMs: number;
  wasInside: boolean;
  hasGrantedTailwind: boolean;
};

type PendingVolcanoRock = {
  x: number;
  z: number;
  telegraphAt: number;
  landAt: number;
  telegraphed: boolean;
  landed: boolean;
};

type PendingVolcano = {
  id: string;
  ownerId: string;
  abilityId: string;
  x: number;
  z: number;
  yaw: number;
  collideRadius: number;
  blastRadius: number;
  damage: number;
  /** When rising finishes and rocks may start. */
  activeAt: number;
  /** When active rock window ends (start sinking). */
  activeEndsAt: number;
  /** When schema entry is deleted. */
  despawnAt: number;
  nextRockAt: number;
  rockIntervalMs: number;
  /** Contact-burn refresh while hugging the volcano body. */
  nextContactTickAt: number;
  contactTickMs: number;
  telegraphMs: number;
  ringMin: number;
  ringMax: number;
  seed: number;
  rocks: PendingVolcanoRock[];
  phase: "rising" | "active" | "sinking";
};

type PendingMagmaOrbs = {
  ownerId: string;
  abilityId: string;
  x: number;
  z: number;
  radius: number;
  damage: number;
  launchAt: number;
  explodeAt: number;
  path: ReturnType<typeof buildMagmaOrbsFlightPath>;
  flightHitRadius: number;
  /** Bezier t where left orb dies to a wall (1 = reaches meet). */
  leftMaxT: number;
  /** Bezier t where right orb dies to a wall (1 = reaches meet). */
  rightMaxT: number;
  /** Bubbles this cast erupted inside — curve may leave / skim without dying. */
  passBubbleIds: Set<string>;
  /** Targets already burned by a flying orb this cast. */
  pathHitIds: Set<string>;
};

type PendingProtectionBubble = {
  id: string;
  ownerId: string;
  abilityId: string;
  x: number;
  z: number;
  radius: number;
  spawnedAt: number;
  formEndsAt: number;
  activeEndsAt: number;
  despawnAt: number;
  phase: "forming" | "active" | "fading";
  /** Next absorb tick while fully formed. */
  nextShieldAt: number;
  /** Absorb granted from this bubble (capped). */
  shieldGranted: number;
};

type PendingShroom = {
  id: string;
  ownerId: string;
  abilityId: string;
  x: number;
  z: number;
  yaw: number;
  triggerRadius: number;
  blastRadius: number;
  damage: number;
  plantedAt: number;
  stage2At: number;
  stage3At: number;
  expiresAt: number;
  stage: 1 | 2 | 3;
  variant: number;
  /** Step triggers only after cast completes. */
  armed: boolean;
  /** Oldest cull / expire bury. */
  sinking: boolean;
  sinkEndsAt: number;
};

type PendingFrostMist = {
  ownerId: string;
  abilityId: string;
  startedAt: number;
  nextTickAt: number;
  tickIndex: number;
  ticksTotal: number;
  tickMs: number;
  growMs: number;
  damage: number;
  startRange: number;
  endRange: number;
  halfAngleStart: number;
  halfAngleEnd: number;
};

type PendingGrooveHeal = {
  ownerId: string;
  abilityId: string;
  nextTickAt: number;
  tickIndex: number;
  ticksTotal: number;
  tickMs: number;
  heal: number;
  radius: number;
};

/** Narrow forward heal channel (Heal Beam). */
type PendingHealBeam = {
  ownerId: string;
  abilityId: string;
  nextTickAt: number;
  tickIndex: number;
  ticksTotal: number;
  tickMs: number;
  heal: number;
  range: number;
  halfAngle: number;
};

/** Short-range drain laser (Life Leech). */
type PendingLifeLeech = {
  ownerId: string;
  abilityId: string;
  nextTickAt: number;
  tickIndex: number;
  /** When true, keep ticking until the cast is cleared. */
  hold: boolean;
  ticksTotal: number;
  tickMs: number;
  damage: number;
  healFrac: number;
  range: number;
  halfAngle: number;
};

/** Arc Thread — tether after first-contact ray hit. */
type PendingArcThread = {
  ownerId: string;
  targetId: string;
  abilityId: string;
  startedAt: number;
  endsAt: number;
  nextCheckAt: number;
  range: number;
  aimToleranceRad: number;
  secondaryDamage: number;
};

/** Barrier absorb ramps 0→target during windup; mid-cast hits only eat built stacks. */
type PendingBarrier = {
  ownerId: string;
  castStartedAt: number;
  /** When anticipation+cast end (impact begins). */
  impactAt: number;
  /** Total shield HP granted so far this cast (not current remaining). */
  granted: number;
  target: number;
  durationMs: number;
  finalized: boolean;
};

/**
 * Server-side combat: Anticipation → Cast → Impact → Recovery.
 * Cancel is only valid during anticipation (before commitment / effect).
 * Effect (projectile, hit, travel) resolves at impact start by default.
 * Travel with `effectOnArrive` defers melee/AoE damage+FX until landing.
 * Statuses (stun/slow/DoT/…) are owned by StatusSystem.
 */
export class CombatSystem {
  private sims = new Map<string, ProjectileSim>();
  private cds = new Map<string, Map<string, number>>();
  private casts = new Map<string, ActiveCast>();
  private travels = new Map<string, ActiveTravel>();
  /** Brief invuln after Portal blink (not tied to castStartedAt). */
  private blinkIframeUntil = new Map<string, number>();
  private knockbacks = new Map<string, ActiveKnockback>();
  private combos = new Map<string, ActiveCombo>();
  private pendingSpikes: PendingSpike[] = [];
  private pendingArcBladeHits: PendingArcBladeHit[] = [];
  private pendingBloomingPaths: PendingBloomingPath[] = [];
  private pendingTeleportSlamBlinks: PendingTeleportSlamBlink[] = [];
  private pendingDelayedAoes: PendingDelayedAoe[] = [];
  private pendingSilenceSweeps: PendingSilenceSweep[] = [];
  private pendingFirewalls: PendingFirewall[] = [];
  private pendingPoisonClouds: PendingPoisonCloud[] = [];
  private pendingHolyGrounds: PendingHolyGround[] = [];
  /** Bodies currently holding holyBlessed from a live Holy Ground zone. */
  private holyBlessedBodyIds = new Set<string>();
  private pendingSlipstreams: PendingSlipstream[] = [];
  /** Owners currently holding slipstreamHaste from a live Slipstream lane. */
  private slipstreamHasteBodyIds = new Set<string>();
  /**
   * Rift Fissure — owner → first portal while arming, or both once linked.
   * Traveler cooldowns prevent portal ping-pong.
   */
  private pendingRifts = new Map<
    string,
    {
      portalAId: string;
      portalBId: string | null;
      armEndsAt: number;
      expiresAt: number;
      travelerCd: Map<string, number>;
    }
  >();
  private pendingFireballBurns: PendingFireballBurn[] = [];
  private pendingVolcanoes: PendingVolcano[] = [];
  private pendingMagmaOrbs: PendingMagmaOrbs[] = [];
  private pendingProtectionBubbles: PendingProtectionBubble[] = [];
  private pendingShrooms: PendingShroom[] = [];
  private pendingFrostMist: PendingFrostMist[] = [];
  private pendingGrooveHeal: PendingGrooveHeal[] = [];
  private pendingHealBeam: PendingHealBeam[] = [];
  private pendingLifeLeech: PendingLifeLeech[] = [];
  private pendingArcThreads: PendingArcThread[] = [];
  private pendingBarrier = new Map<string, PendingBarrier>();
  /** Frost Mist: haste/empower granted once while Counter stays armed for later ticks. */
  private counterMistRiposted = new Set<string>();
  /** Frost Mist: Revenge blink once while Revenge stays armed for later ticks. */
  private revengeMistBlinked = new Set<string>();
  /** Active Spirit Form sessions (husk id + end time + link stun tracking). */
  private spiritForms = new Map<
    string,
    { huskId: string; endsAt: number; linkHitIds: Set<string> }
  >();
  /** Husk kept alive while the return dash plays; deleted on travel end. */
  private spiritReturnHusks = new Map<string, string>();
  /** Target orbit slot phase per wisp id (smooth redistribute). */
  private orbitingWispTargetPhase = new Map<string, number>();
  /** Original spawn pose for practice dummies (respawn here on death). */
  private targetSpawns = new Map<string, { x: number; z: number }>();
  private nextId = 1;
  private hooks: CombatRoomHooks;
  private staticColliders: StaticCollider[] = [];
  /** Cached wall colliders — rebuilt in setStaticColliders. */
  private wallColliders: Extract<StaticCollider, { shape: "walls" }>[] = [];
  /** Cached solid circle props (rocks) — rebuilt in setStaticColliders. */
  private circleColliders: CircleCollider[] = [];
  /** Cached oriented prop boxes — rebuilt in setStaticColliders. */
  private boxColliders: BoxCollider[] = [];
  /** Reused each collectBodies / tick — avoid GC spikes. */
  private bodyBuffer: CombatBody[] = [];
  private simList: ProjectileSim[] = [];
  /** Per-session baked loadout + talent mods. */
  private kits = new Map<string, CombatSessionKit>();
  /**
   * Engagement / Opening Salvo state — leave-combat mirrors client HP linger.
   * `disarmed` = got hit first (or contested) this engagement; cleared when OOC.
   */
  private engageBySession = new Map<
    string,
    { inCombatUntil: number; disarmed: boolean; salvoReadyAt: number }
  >();
  /** Protective Instinct internal CD (ready-at epoch ms). */
  private protectiveInstinctReadyAt = new Map<string, number>();
  /** Per-player energy rate limiter. Refilled from the tick. */
  private energyLimiters = new Map<string, EnergyLimiter>();
  /**
   * Fifth Cadence — `count` = damaging spells toward next bonus (0–5);
   * armed window applies +15% only to the 5th spell's ability id.
   */
  private fifthSpellBySession = new Map<
    string,
    { count: number; armedAbilityId: string; armedUntil: number }
  >();
  /** Pending ally-cast Soul Relay heals (projectile travel delay). */
  private pendingSoulRelayHeals: {
    casterId: string;
    targetId: string;
    healAmount: number;
    relayDur: number;
    resolveAt: number;
  }[] = [];
  /** Active Soul Relay per caster — at most one. */
  private activeSoulRelays = new Map<
    string,
    {
      casterId: string;
      linkedTargetId: string;
      startedAt: number;
      endsAt: number;
    }
  >();
  /** Set by fireEffect — false when the spell did not resolve (e.g. Soul Relay OOR). */
  private lastFireCommitted = true;
  /** Admin testing — ability CDs skipped while set. */
  private noCooldownSessions = new Set<string>();
  readonly statuses: StatusSystem;

  constructor(
    private room: RoomLike,
    hooks: CombatRoomHooks,
  ) {
    this.hooks = hooks;
    this.statuses = new StatusSystem(room.state, {
      onInterruptCast: (targetId) => this.interruptCast(targetId),
      onDotDamage: (targetId, damage, statusId, sourceId) => {
        this.applyRawDamage(targetId, damage, sourceId, statusId);
      },
      onHotHeal: (targetId, heal, statusId, sourceId) => {
        this.applyHealAmount(targetId, heal, sourceId, statusId);
      },
    });
  }

  setHooks(hooks: Partial<CombatRoomHooks>) {
    this.hooks = { ...this.hooks, ...hooks };
  }

  setStaticColliders(colliders: StaticCollider[]) {
    this.staticColliders = colliders;
    // Movement still collides with everything; only the projectile sets honour
    // `blocksProjectiles`, so low cover stops bodies but not arrows.
    const { walls, circles, boxes } = projectileBlockers(colliders);
    this.wallColliders = walls;
    this.circleColliders = circles;
    this.boxColliders = boxes;
  }

  /** Bake loadout + stub talents + catalog talent build for this session. */
  syncSessionKit(
    sessionId: string,
    loadoutCsv: string,
    talentIdsCsv: string,
    talentBuild?: TalentBuild,
  ) {
    const talentIds = talentIdsCsv.split(",").filter(Boolean);
    const kit = resolveKit(loadoutCsv, talentIds, talentBuild);
    this.kits.set(sessionId, kit);
    this.syncFifthCadenceStatus(sessionId, Date.now());
  }

  /** Scale authored radii for Widened Elements (elemental AoE only). */
  private talentRadius(sessionId: string, abilityId: string, base: number): number {
    return kitScaledRadius(this.kits.get(sessionId), abilityId, base);
  }

  private fifthSpellState(sessionId: string) {
    let state = this.fifthSpellBySession.get(sessionId);
    if (!state) {
      state = { count: 0, armedAbilityId: "", armedUntil: 0 };
      this.fifthSpellBySession.set(sessionId, state);
    }
    return state;
  }

  /** Grant / refresh / clear the permanent Fifth Cadence HUD tracker. */
  private syncFifthCadenceStatus(sessionId: string, now: number) {
    const bonus = this.kits.get(sessionId)?.fifthSpellDmgBonus ?? 0;
    if (!(bonus > 0)) {
      this.statuses.remove(sessionId, "fifthSpellCadence");
      this.fifthSpellBySession.delete(sessionId);
      return;
    }
    const state = this.fifthSpellState(sessionId);
    this.statuses.apply(sessionId, "fifthSpellCadence", sessionId, now, {
      stacks: state.count,
      setStacks: true,
    });
  }

  /**
   * Advance Fifth Cadence on damaging spell release.
   * Only the 5th spell in the cycle gets +15%; the next cast clears the arm
   * so damage goes back to normal until the following 5th.
   */
  private tryAdvanceFifthCadence(sessionId: string, abilityId: string, now: number) {
    const bonus = this.kits.get(sessionId)?.fifthSpellDmgBonus ?? 0;
    if (!(bonus > 0) || !abilityCanProcFifthCadence(abilityId)) return;
    const state = this.fifthSpellState(sessionId);
    if (state.count >= FIFTH_CADENCE_SPELL_INTERVAL) {
      state.count = 0;
    }
    state.count += 1;
    if (state.count >= FIFTH_CADENCE_SPELL_INTERVAL) {
      // Empower only this cast's ability for a short window (delayed hits / AoE ticks).
      state.armedAbilityId = abilityId;
      state.armedUntil = now + 5_000;
    } else {
      // Back to normal — do not let a prior 5th keep boosting later casts of the same spell.
      state.armedAbilityId = "";
      state.armedUntil = 0;
    }
    this.syncFifthCadenceStatus(sessionId, now);
  }

  private peekFifthCadenceMul(
    attackerSessionId: string,
    abilityId: string,
    damage: number,
  ): number {
    if (!(damage > 0) || !attackerSessionId) return 1;
    const bonus = this.kits.get(attackerSessionId)?.fifthSpellDmgBonus ?? 0;
    if (!(bonus > 0) || !abilityCanProcFifthCadence(abilityId)) return 1;
    const state = this.fifthSpellBySession.get(attackerSessionId);
    if (!state || state.armedAbilityId !== abilityId) return 1;
    if (Date.now() >= state.armedUntil) return 1;
    return 1 + bonus;
  }

  getSessionKit(sessionId: string): CombatSessionKit | undefined {
    return this.kits.get(sessionId);
  }

  private engageState(sessionId: string, now: number) {
    let state = this.engageBySession.get(sessionId);
    if (!state) {
      state = { inCombatUntil: 0, disarmed: false, salvoReadyAt: 0 };
      this.engageBySession.set(sessionId, state);
    }
    // Left combat → clear "hit first" disarm so the next initiation can fire.
    if (now >= state.inCombatUntil && state.disarmed) {
      state.disarmed = false;
    }
    return state;
  }

  /** Refresh combat linger; if entering via being hit, disarm Opening Salvo. */
  private noteTookDamage(sessionId: string, now: number) {
    if (!sessionId || !this.room.state.players.has(sessionId)) return;
    const state = this.engageState(sessionId, now);
    if (now >= state.inCombatUntil) {
      state.disarmed = true;
    }
    state.inCombatUntil = now + COMBAT_ENGAGE_LINGER_MS;
  }

  /**
   * Grant energy to a player, rate limited (see `packages/shared/src/energy.ts`).
   *
   * Only players hold energy. Damage into a practice dummy counts, so the bar
   * can be exercised solo; damage into a decoy does not, since a decoy is an
   * illusion the opponent chose to spend a cooldown on and farming it would
   * turn their defensive play into your resource.
   *
   * A flex spell's own output earns its caster nothing. Otherwise any flex
   * spell that generates more than it costs pays for itself and can be looped
   * forever -- Life Leech is the clear case, since it double-dips by counting
   * as both damage dealt and healing done. Capping the rate only slows that
   * loop down; refusing the credit removes it. Being hit by a flex spell still
   * pays the victim, which is why `damageTaken` is exempt.
   */
  private grantEnergy(
    sessionId: string,
    source: EnergySource,
    amount: number,
    abilityId?: string,
  ) {
    if (source !== "damageTaken" && abilityId && this.isFlexAbility(sessionId, abilityId)) {
      return;
    }
    const pips = energyFor(source, amount);
    if (!(pips > 0)) return;
    const player = this.room.state.players.get(sessionId);
    if (!player || player.disconnected || player.roundDead) return;

    let limiter = this.energyLimiters.get(sessionId);
    if (!limiter) {
      limiter = new EnergyLimiter();
      this.energyLimiters.set(sessionId, limiter);
    }
    const granted = limiter.take(pips);
    if (granted > 0) player.energy = clampEnergy(player.energy + granted);
  }

  /**
   * Whether this player casts `abilityId` from a flex slot.
   *
   * Checking the slot rather than the individual cast is exact here, not an
   * approximation: a spell may not sit on the main bar and in a flex slot at
   * the same time (`handleSetFlexLoadout` drops the duplicate, since they
   * would share a cooldown anyway). So a spell in the flex list has exactly
   * one way of being cast.
   */
  private isFlexAbility(sessionId: string, abilityId: string): boolean {
    const player = this.room.state.players.get(sessionId);
    if (!player || !player.flexLoadout) return false;
    return player.flexLoadout.split(",").includes(abilityId);
  }

  /**
   * Opening Salvo eligibility (no side effects). Caller commits CD only when the hit lands.
   */
  private peekOpeningSalvoMul(
    attackerSessionId: string,
    abilityId: string,
    damage: number,
    now: number,
  ): number {
    if (!(damage > 0) || !attackerSessionId || !this.room.state.players.has(attackerSessionId)) {
      return 1;
    }
    const bonus = this.kits.get(attackerSessionId)?.openingSalvoDmgBonus ?? 0;
    if (bonus <= 0 || !abilityCanProcOpeningSalvo(abilityId)) return 1;
    const state = this.engageState(attackerSessionId, now);
    if (now < state.inCombatUntil) return 1; // already in combat
    if (state.disarmed || now < state.salvoReadyAt) return 1;
    return 1 + bonus;
  }

  private commitOpeningSalvo(attackerSessionId: string, now: number) {
    const state = this.engageState(attackerSessionId, now);
    state.salvoReadyAt = now + OPENING_SALVO_COOLDOWN_MS;
    state.inCombatUntil = now + COMBAT_ENGAGE_LINGER_MS;
  }

  /**
   * Opportunist — bonus damage vs targets you have hard-CC'd (stun / root / silence).
   */
  private peekOpportunistMul(
    attackerSessionId: string,
    targetId: string,
    abilityId: string,
    damage: number,
  ): number {
    if (!(damage > 0) || !attackerSessionId) return 1;
    const bonus = this.kits.get(attackerSessionId)?.opportunistDmgBonus ?? 0;
    if (bonus <= 0 || !abilityCanProcOpportunist(abilityId)) return 1;
    if (!this.statuses.hasHardCcFrom(targetId, attackerSessionId)) return 1;
    return 1 + bonus;
  }

  private noteDealtDamage(attackerSessionId: string, now: number) {
    if (!attackerSessionId || !this.room.state.players.has(attackerSessionId)) return;
    const state = this.engageState(attackerSessionId, now);
    state.inCombatUntil = now + COMBAT_ENGAGE_LINGER_MS;
  }

  /**
   * Protective Instinct — Defense cast grants nearest ally (else self) DR.
   * Internal CD; magnitude from kit (`protectiveInstinctReducePct`).
   */
  private tryProcProtectiveInstinct(
    sessionId: string,
    player: PlayerState,
    abilityId: string,
    now: number,
  ) {
    const reducePct = this.kits.get(sessionId)?.protectiveInstinctReducePct ?? 0;
    if (!(reducePct > 0) || !abilityCanProcProtectiveInstinct(abilityId)) return;
    if ((this.protectiveInstinctReadyAt.get(sessionId) ?? 0) > now) return;

    let bestId: string | null = null;
    let bestDist = Infinity;
    this.room.state.players.forEach((other, otherId) => {
      if (otherId === sessionId) return;
      if (other.disconnected || other.hp <= 0 || other.roundDead || other.role === "spectator") {
        return;
      }
      // Friendly = cannot hurt (same team / hub PvP off).
      if (this.canHurt(sessionId, otherId)) return;
      const dist = Math.hypot(other.x - player.x, other.z - player.z);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = otherId;
      }
    });
    const targetId = bestId ?? sessionId;
    this.statuses.apply(targetId, "protectiveInstinct", sessionId, now, {
      durationMs: PROTECTIVE_INSTINCT_DURATION_MS,
      stacks: reducePct,
      setStacks: true,
    });
    this.protectiveInstinctReadyAt.set(sessionId, now + PROTECTIVE_INSTINCT_COOLDOWN_MS);
  }

  /**
   * Overflow — convert wasted heal into a short absorb on the target.
   * Healing spells and HoT ticks; works on self and allies.
   */
  private tryProcOverflow(
    healerId: string,
    targetId: string,
    overheal: number,
    maxHp: number,
    abilityId: string,
    now: number,
  ) {
    if (!(overheal > 0) || !(maxHp > 0) || !healerId) return;
    const kit = this.kits.get(healerId);
    const convertFrac = kit?.overflowConvertFrac ?? 0;
    const capFrac = kit?.overflowCapFrac ?? 0;
    if (!(convertFrac > 0) || !(capFrac > 0) || !abilityCanProcOverflow(abilityId)) return;

    const converted = Math.floor(overheal * convertFrac);
    if (converted <= 0) return;
    const cap = Math.max(1, Math.floor(maxHp * capFrac));
    const current = this.statuses.getStacks(targetId, "overflowShield");
    const next = Math.min(cap, current + converted);
    if (!(next > 0)) return;

    this.statuses.apply(targetId, "overflowShield", healerId, now, {
      durationMs: OVERFLOW_DURATION_MS,
      stacks: next,
      setStacks: true,
    });
  }

  /** Static world + live rift panes (walk-block; face approaches skip the pane). */
  private walkStaticColliders(at?: Vec2): StaticCollider[] {
    const rifts = riftPortalColliders(
      this.room.state.riftPortals.entries(),
      at ? { x: at.x, z: at.z } : undefined,
    );
    if (rifts.length === 0) return this.staticColliders;
    return [...this.staticColliders, ...rifts];
  }

  /** Authoritative move with player/static/volcano/rift collision. */
  movePlayer(sessionId: string, from: Vec2, desired: Vec2): Vec2 {
    const me = this.room.state.players.get(sessionId);
    // Sample face-open at the desired pose so you can step into the trigger.
    return moveAndCollide(
      from,
      desired,
      COLLISION.playerRadius,
      this.walkStaticColliders(desired),
      [
        ...unitCollidersExcept(
          this.room.state.players.entries(),
          this.room.state.targets.entries(),
          sessionId,
          me?.id,
        ),
        ...volcanoColliders(this.room.state.volcanoes.entries()),
      ],
    );
  }

  /**
   * Strip outward wish movement for the tethered target only.
   * Caster may walk away; overshoot is resolved by tugging the target.
   */
  constrainAstralChainDesired(sessionId: string, desired: Vec2): Vec2 {
    if (this.room.state.astralChains.size === 0) return desired;
    let next = desired;
    this.room.state.astralChains.forEach((chain) => {
      if (chain.targetId !== sessionId) return;
      const caster = this.room.state.players.get(chain.casterId);
      if (!caster) return;
      next = constrainAstralTetherDesired(
        caster.x,
        caster.z,
        next.x,
        next.z,
        chain.maxDistance,
      );
    });
    return next;
  }

  /** Clamp a teleport/dash sample into free space (swept so we can't skip walls). */
  clampPlayerPos(sessionId: string, pos: Vec2): Vec2 {
    const me = this.room.state.players.get(sessionId);
    return resolveCollisions(
      pos,
      COLLISION.playerRadius,
      this.walkStaticColliders(pos),
      [
        ...unitCollidersExcept(
          this.room.state.players.entries(),
          this.room.state.targets.entries(),
          sessionId,
          me?.id,
        ),
        ...volcanoColliders(this.room.state.volcanoes.entries()),
      ],
    );
  }

  /** Sweep from → to for dashes / charges (through enemies; stop on walls). */
  sweepPlayerPos(_sessionId: string, from: Vec2, to: Vec2): Vec2 {
    return sweepTravel(from, to, COLLISION.playerRadius, this.staticColliders);
  }

  /** Force-cancel an in-progress cast (stun / silence). Clears travel too. */
  interruptCast(targetId: string) {
    const player = this.room.state.players.get(targetId);
    if (player) {
      const cast = this.casts.get(targetId);
      if (!cast) return;
      const abilityId = cast.abilityId;
      const now = Date.now();
      this.travels.delete(targetId);
      if (abilityId === "bulwarkCharge") {
        this.statuses.remove(targetId, "bulwarkCharging");
      }
      let cooldownMs = this.endComboEarly(targetId, abilityId, cast.effectFired, now);
      const def = ABILITIES[abilityId];
      if (def?.holdChannel && cast.effectFired) {
        cooldownMs = this.startCooldown(targetId, abilityId, now);
      }
      this.clearPendingFrostMist(targetId);
      this.clearPendingGrooveHeal(targetId);
      this.clearPendingHealBeam(targetId);
      this.clearPendingLifeLeech(targetId);
      this.clearPendingArcThread(targetId, "break");
      this.clearUnarmedShrooms(targetId);
      this.clearCastState(targetId, player);
      this.phaseFx(targetId, player, abilityId, "cancel", now, { cooldownMs });
      return;
    }

    // Practice dummies cast on WorldTargetState (not CombatSystem.casts).
    const target = this.room.state.targets.get(targetId);
    if (!target) return;
    if (!target.castAbilityId && !target.castPhase) return;
    target.castAbilityId = "";
    target.castPhase = "";
    target.castLockUntil = 0;
  }

  /**
   * Ability interrupt (e.g. Space during LMB): end caster phases/anim lock only.
   * Projectiles already spawned keep flying. Travel from the interrupted ability is dropped.
   */
  softInterruptCast(sessionId: string, player: PlayerState, now: number) {
    const cast = this.casts.get(sessionId);
    if (!cast) return;
    const abilityId = cast.abilityId;
    let cooldownMs = this.endComboEarly(sessionId, abilityId, cast.effectFired, now);
    const def = ABILITIES[abilityId];
    if (def?.holdChannel && cast.effectFired) {
      cooldownMs = this.startCooldown(sessionId, abilityId, now);
    }
    this.clearPendingFrostMist(sessionId);
    this.clearPendingGrooveHeal(sessionId);
    this.clearPendingHealBeam(sessionId);
    this.clearPendingLifeLeech(sessionId);
    this.clearPendingArcThread(sessionId, "break");
    this.clearUnarmedShrooms(sessionId);
    this.clearCastState(sessionId, player);
    this.phaseFx(sessionId, player, abilityId, "interrupt", now, { cooldownMs });
  }

  ensurePracticeDummy(x: number, z: number, id = "practice_dummy", yaw = 0) {
    this.targetSpawns.set(id, { x, z });
    if (this.room.state.targets.has(id)) return;
    const t = new WorldTargetState();
    t.id = id;
    t.kind = "dummy";
    t.x = x;
    t.z = z;
    t.yaw = yaw;
    t.hp = PRACTICE_DUMMY_MAX_HP;
    t.maxHp = PRACTICE_DUMMY_MAX_HP;
    this.room.state.targets.set(t.id, t);
  }

  /**
   * Turn an authored map prop into something players can hit.
   *
   * The prop keeps its static collider and its rendering -- nothing about it
   * changes except that it now has health. Killing it refills rather than
   * removes, so the model on the client never has to disappear and the static
   * collider list never has to be rebuilt mid-match.
   */
  spawnPropTarget(p: MapPropPlacement) {
    const id = propTargetId(p);
    this.targetSpawns.set(id, { x: p.x, z: p.z });
    if (this.room.state.targets.has(id)) return;
    const hp = Math.max(1, Math.round(p.hp ?? 0));
    const t = new WorldTargetState();
    t.id = id;
    t.kind = PROP_TARGET_KIND;
    t.x = p.x;
    t.z = p.z;
    t.y = p.y;
    t.yaw = p.yaw;
    t.hp = hp;
    t.maxHp = hp;
    t.radius = propTargetRadius(p);
    this.room.state.targets.set(t.id, t);
  }

  /** PvE wave mob — dies permanently (no hub dummy respawn). */
  spawnWaveMob(
    id: string,
    x: number,
    z: number,
    opts: { kind: string; hp: number; yaw?: number },
  ) {
    if (this.room.state.targets.has(id)) return;
    this.targetSpawns.set(id, { x, z });
    const t = new WorldTargetState();
    t.id = id;
    t.kind = opts.kind;
    t.x = x;
    t.z = z;
    t.yaw = opts.yaw ?? 0;
    t.hp = opts.hp;
    t.maxHp = opts.hp;
    this.room.state.targets.set(t.id, t);
  }

  /** Move a world target with the same collision stack as players. */
  moveTarget(targetId: string, from: Vec2, desired: Vec2): Vec2 {
    const otherTargets: Array<[string, { x: number; z: number; hp?: number }]> = [];
    for (const [id, t] of this.room.state.targets.entries()) {
      if (id === targetId) continue;
      otherTargets.push([id, t]);
    }
    return moveAndCollide(
      from,
      desired,
      COLLISION.dummyRadius,
      this.walkStaticColliders(desired),
      [
        ...playerCollidersExcept(this.room.state.players.entries(), ""),
        ...targetColliders(otherTargets),
        ...volcanoColliders(this.room.state.volcanoes.entries()),
      ],
    );
  }

  /** Move a wave mob — players + statics; soft mob-vs-mob happens in WaveDirector. */
  moveWaveMob(targetId: string, from: Vec2, desired: Vec2): Vec2 {
    return moveAndCollide(
      from,
      desired,
      COLLISION.dummyRadius,
      this.walkStaticColliders(desired),
      playerCollidersExcept(this.room.state.players.entries(), ""),
    );
  }

  /** Direct hit from an NPC (zombie melee) onto a player. */
  npcStrikePlayer(
    attackerTargetId: string,
    targetSessionId: string,
    damage: number,
    abilityId = "zombie_melee",
  ) {
    const target = this.room.state.players.get(targetSessionId);
    const attacker = this.room.state.targets.get(attackerTargetId);
    if (!target || !attacker || target.hp <= 0 || attacker.hp <= 0) return;
    this.applyRawDamage(targetSessionId, damage, attackerTargetId, abilityId, {
      triggersCounter: true,
    });
  }

  /** Scale aura / explode footprints for Widened Elements (not contact hitbox). */
  private applyTalentProjectileRadii(sessionId: string, sim: ProjectileSim) {
    const mul = kitScaledRadius(this.kits.get(sessionId), sim.abilityId, 1);
    if (mul <= 1.001) return;
    const def = ABILITIES[sim.abilityId];
    if (def?.aura && sim.hitRadius > 0) sim.hitRadius *= mul;
    if (sim.slowRadius > 0) sim.slowRadius *= mul;
    if (sim.explodeRadius > 0) sim.explodeRadius *= mul;
  }

  /** Live projectiles owned by a caster for a given ability (returning disc cap). */
  private activeProjectileCount(sessionId: string, abilityId: string): number {
    let n = 0;
    for (const sim of this.sims.values()) {
      if (sim.ownerId === sessionId && sim.abilityId === abilityId) n += 1;
    }
    return n;
  }

  /** Main Runic Shard only (excludes shatter fragments). */
  private findActiveRunicShard(sessionId: string): ProjectileSim | null {
    for (const sim of this.sims.values()) {
      if (
        sim.ownerId === sessionId &&
        sim.abilityId === "runicShard" &&
        !sim.isRunicFragment
      ) {
        return sim;
      }
    }
    return null;
  }

  private activeRunicShardCount(sessionId: string): number {
    let n = 0;
    for (const sim of this.sims.values()) {
      if (
        sim.ownerId === sessionId &&
        sim.abilityId === "runicShard" &&
        !sim.isRunicFragment
      ) {
        n += 1;
      }
    }
    return n;
  }

  /** Main shard or any shatter fragment still in flight. */
  private hasRunicShardVolley(sessionId: string): boolean {
    for (const sim of this.sims.values()) {
      if (sim.ownerId === sessionId && sim.abilityId === "runicShard") {
        return true;
      }
    }
    return false;
  }

  /** Manual recast — radial fragment burst; main shard can shatter multiple times. */
  private shatterRunicShard(sessionId: string, shard: ProjectileSim, now: number) {
    const def = ABILITIES.runicShard;
    if (!def?.runicShard) {
      this.sims.delete(shard.id);
      this.room.state.projectiles.delete(shard.id);
      return;
    }
    const cfg = def.runicShard;
    const yaw = Math.atan2(shard.vx, shard.vz);
    const origin = { x: shard.x, z: shard.z };

    const maxCharges = cfg.shatterCharges ?? 2;
    const before = shard.shatterChargesRemaining ?? maxCharges;
    const charges = Math.max(0, before - 1);
    shard.shatterChargesRemaining = charges;
    shard.shatterReadyAt = now + (cfg.shatterArmingMs ?? 320);
    const consumeMain = charges <= 0;

    if (consumeMain) {
      this.sims.delete(shard.id);
      this.room.state.projectiles.delete(shard.id);
    }

    this.fx({
      kind: "aoe",
      abilityId: "runicShard",
      x: origin.x,
      z: origin.z,
      y: 0.95,
      radius: 0.85,
      ownerId: sessionId,
      variant: 1,
    });

    const budget = new Map<string, number>();
    const yaws = runicShardFragmentYaws(yaw, cfg.fragmentCount, cfg.fragmentConeDegrees);
    for (const fragYaw of yaws) {
      if (this.sims.size >= COMBAT.maxProjectiles) break;
      const id = `p_${this.nextId++}`;
      const frag = createRunicFragment(
        id,
        sessionId,
        def.id,
        origin,
        fragYaw,
        def,
        budget,
      );
      if (!frag) continue;
      this.stampProjectileBubblePass(frag, now);
      this.sims.set(id, frag);
      const st = new ProjectileState();
      st.id = id;
      st.ownerSessionId = sessionId;
      st.abilityId = def.id;
      st.x = frag.x;
      st.z = frag.z;
      st.vx = frag.vx;
      st.vz = frag.vz;
      st.radius = frag.hitRadius;
      st.slowRadius = 0;
      st.mode = frag.mode;
      st.stuckTargetId = "";
      this.room.state.projectiles.set(id, st);
    }
  }

  /**
   * Spawn a projectile from an arbitrary body (e.g. practice dummy retaliation).
   * Aim with `body.yaw` (`atan2(dx, dz)` toward the target).
   */
  fireProjectileFrom(
    ownerId: string,
    body: CombatBody,
    abilityId: string,
  ): boolean {
    const def = ABILITIES[abilityId];
    if (!def || def.shape !== "projectile") return false;
    if (this.sims.size >= COMBAT.maxProjectiles) return false;
    const id = `p_${this.nextId++}`;
    const sim = createProjectile(id, body, def);
    if (!sim) return false;
    // Owner id on the sim is body.id from createProjectile — force the dummy id.
    sim.ownerId = ownerId;
    this.applyTalentProjectileRadii(ownerId, sim);
    this.stampProjectileBubblePass(sim, Date.now());
    this.sims.set(id, sim);
    const st = new ProjectileState();
    st.id = id;
    st.ownerSessionId = ownerId;
    st.abilityId = def.id;
    st.x = sim.x;
    st.z = sim.z;
    st.vx = sim.vx;
    st.vz = sim.vz;
    st.radius = sim.hitRadius;
    st.slowRadius = sim.slowRadius;
    st.mode = sim.mode;
    st.stuckTargetId = sim.stuckTargetId ?? "";
    this.room.state.projectiles.set(id, st);
    return true;
  }

  clearSession(sessionId: string) {
    const cast = this.casts.get(sessionId);
    const player = this.room.state.players.get(sessionId);
    // Notify clients — silent wipe left awaitingCastAck / local castPhase stuck.
    if (cast && player) {
      this.phaseFx(sessionId, player, cast.abilityId, "cancel", Date.now());
    }
    this.cds.delete(sessionId);
    this.noCooldownSessions.delete(sessionId);
    this.casts.delete(sessionId);
    this.travels.delete(sessionId);
    this.combos.delete(sessionId);
    this.kits.delete(sessionId);
    this.engageBySession.delete(sessionId);
    this.protectiveInstinctReadyAt.delete(sessionId);
    this.fifthSpellBySession.delete(sessionId);
    this.energyLimiters.delete(sessionId);
    this.statuses.clearTarget(sessionId);
    this.clearPendingFrostMist(sessionId);
    this.clearPendingGrooveHeal(sessionId);
    this.clearPendingHealBeam(sessionId);
    this.clearPendingLifeLeech(sessionId);
    this.clearPendingArcThread(sessionId, "break");
    this.counterMistRiposted.delete(sessionId);
    this.revengeMistBlinked.delete(sessionId);
    this.clearOwnedDecoys(sessionId);
    this.clearOwnedOrbitingWisps(sessionId);
    this.clearAstralChainsForSession(sessionId);
    this.clearOwnerRifts(sessionId);
    this.clearSpiritForm(sessionId, Date.now(), false);
    this.clearSpiritReturn(sessionId);
    this.clearSoulRelay(sessionId);
    this.pendingSoulRelayHeals = this.pendingSoulRelayHeals.filter(
      (p) => p.casterId !== sessionId && p.targetId !== sessionId,
    );
    for (const [id, sim] of this.sims) {
      if (sim.ownerId === sessionId) {
        this.sims.delete(id);
        this.room.state.projectiles.delete(id);
      }
    }
  }

  /** Clear ground zones / world FX that survive per-fighter clearSession (round transitions). */
  clearRoundWorldEffects() {
    this.pendingShrooms = [];
    this.pendingVolcanoes = [];
    this.pendingProtectionBubbles = [];
    this.pendingMagmaOrbs = [];
    this.pendingRifts.clear();
    this.room.state.shrooms.clear();
    this.room.state.volcanoes.clear();
    this.room.state.protectionBubbles.clear();
    this.room.state.orbitingWisps.clear();
    this.orbitingWispTargetPhase.clear();
    this.clearAllAstralChains("silent");
    // Drop any remaining projectiles so arena floors reset cleanly.
    this.sims.clear();
    this.room.state.projectiles.clear();
    // Clear all active rift pairs.
    const portalIds: string[] = [];
    this.room.state.riftPortals.forEach((_, id) => portalIds.push(id));
    for (const id of portalIds) this.room.state.riftPortals.delete(id);
  }

  /** Strip cloaked — called when the player casts, cancels, or interacts. */
  revealCloak(sessionId: string) {
    this.statuses.remove(sessionId, "cloaked");
    // Owner reappeared — remove the clone.
    this.clearOwnedDecoys(sessionId);
  }

  clearOwnedDecoys(sessionId: string) {
    const toDelete: string[] = [];
    this.room.state.decoys.forEach((d, id) => {
      if (d.ownerSessionId === sessionId) toDelete.push(id);
    });
    for (const id of toDelete) this.room.state.decoys.delete(id);
  }

  clearOwnedOrbitingWisps(sessionId: string) {
    const toDelete: string[] = [];
    this.room.state.orbitingWisps.forEach((w, id) => {
      if (w.ownerSessionId === sessionId) toDelete.push(id);
    });
    for (const id of toDelete) {
      this.orbitingWispTargetPhase.delete(id);
      this.room.state.orbitingWisps.delete(id);
    }
  }

  /** Summon one orbiting wisp; at max, replace oldest. Never rejects for being full. */
  private commitOrbitingWisp(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
  ) {
    const cfg = def.orbitingWisp;
    if (!cfg) return;

    const owned: { id: string; spawnedAt: number }[] = [];
    this.room.state.orbitingWisps.forEach((w, id) => {
      if (w.ownerSessionId === sessionId) {
        owned.push({ id, spawnedAt: w.spawnedAt });
      }
    });
    owned.sort((a, b) => a.spawnedAt - b.spawnedAt);

    const max = Math.max(1, cfg.maxCount);
    if (owned.length >= max) {
      const oldest = owned[0]!;
      const old = this.room.state.orbitingWisps.get(oldest.id);
      if (old) {
        this.fx({
          kind: "hit",
          abilityId: def.id,
          x: old.x,
          z: old.z,
          y: old.y,
          ownerId: sessionId,
          damage: 0,
          variant: 2,
        });
      }
      this.orbitingWispTargetPhase.delete(oldest.id);
      this.room.state.orbitingWisps.delete(oldest.id);
      owned.shift();
    }

    const id = `wisp_${this.nextId++}`;
    const slotsAfter = owned.length + 1;
    const currentPhases = owned.map((o) => {
      const w = this.room.state.orbitingWisps.get(o.id);
      return w?.orbitPhase ?? 0;
    });
    const targets = orbitingWispRetargetPhases(currentPhases, slotsAfter);
    // New wisp starts near hand (phase ≈ facing) then lerps to its slot.
    const handPhase = player.yaw - Math.PI / 2;
    const st = new OrbitingWispState();
    st.id = id;
    st.ownerSessionId = sessionId;
    st.abilityId = def.id;
    st.spawnedAt = now;
    st.armedAt = now + (cfg.armingMs ?? 180);
    st.expiresAt = now + cfg.durationMs;
    st.orbitPhase = handPhase;
    const pos = orbitingWispWorldPos(player.x, player.z, st.orbitPhase, now, cfg);
    // Spawn closer to caster during arming spiral (client lerps out).
    st.x = player.x + (pos.x - player.x) * 0.35;
    st.z = player.z + (pos.z - player.z) * 0.35;
    st.y = cfg.height;
    this.room.state.orbitingWisps.set(id, st);
    this.orbitingWispTargetPhase.set(id, targets[slotsAfter - 1]!);

    // Retarget existing wisps to even spacing (oldest → slot 0).
    for (let i = 0; i < owned.length; i++) {
      this.orbitingWispTargetPhase.set(owned[i]!.id, targets[i]!);
    }

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: player.x,
      z: player.z,
      y: cfg.height,
      ownerId: sessionId,
      radius: cfg.radius,
      variant: 0,
    });
  }

  /** Orbit follow + collision + natural expire. */
  private advanceOrbitingWisps(dt: number, now: number) {
    if (this.room.state.orbitingWisps.size === 0) return;
    const dtMs = Math.max(0, dt * 1000);
    const bodies = this.collectBodies();
    const toRemove: string[] = [];
    const ownersTouched = new Set<string>();

    this.room.state.orbitingWisps.forEach((w, id) => {
      if (now >= w.expiresAt) {
        this.fx({
          kind: "hit",
          abilityId: w.abilityId || "orbitingWisp",
          x: w.x,
          z: w.z,
          y: w.y,
          ownerId: w.ownerSessionId,
          damage: 0,
          variant: 2,
        });
        toRemove.push(id);
        ownersTouched.add(w.ownerSessionId);
        return;
      }

      const owner = this.room.state.players.get(w.ownerSessionId);
      if (!owner || owner.hp <= 0 || owner.disconnected) {
        toRemove.push(id);
        ownersTouched.add(w.ownerSessionId);
        return;
      }

      const def = ABILITIES[w.abilityId] ?? ABILITIES.orbitingWisp;
      const cfg = def?.orbitingWisp;
      if (!cfg) {
        toRemove.push(id);
        return;
      }

      const targetPhase =
        this.orbitingWispTargetPhase.get(id) ?? w.orbitPhase;
      w.orbitPhase = lerpOrbitPhase(
        w.orbitPhase,
        targetPhase,
        dtMs,
        cfg.redistributeMs ?? 220,
      );
      const pos = orbitingWispWorldPos(owner.x, owner.z, w.orbitPhase, now, cfg);
      // During arming, ease from spawn toward full orbit radius.
      const armT =
        cfg.armingMs && cfg.armingMs > 0
          ? Math.max(0, Math.min(1, (now - w.spawnedAt) / cfg.armingMs))
          : 1;
      const ease = armT * armT * (3 - 2 * armT);
      w.x = owner.x + (pos.x - owner.x) * ease;
      w.z = owner.z + (pos.z - owner.z) * ease;
      w.y = cfg.height;

      if (now < w.armedAt) return;

      const hitR = cfg.collisionRadius;
      for (const body of bodies) {
        if (body.id === w.ownerSessionId) continue;
        if (body.vulnerable === false || body.hp <= 0) continue;
        if (!this.canHurt(w.ownerSessionId, body.id)) continue;
        if (
          !circlesOverlap(w.x, w.z, hitR, body.x, body.z, hitRadiusOf(body))
        ) {
          continue;
        }
        const dmg = def?.damage ?? 0;
        this.applyRawDamage(body.id, dmg, w.ownerSessionId, w.abilityId || "orbitingWisp");
        toRemove.push(id);
        ownersTouched.add(w.ownerSessionId);
        break;
      }
    });

    for (const id of toRemove) {
      this.orbitingWispTargetPhase.delete(id);
      this.room.state.orbitingWisps.delete(id);
    }

    // Re-space remaining slots after removals.
    for (const ownerId of ownersTouched) {
      const remaining: { id: string; spawnedAt: number }[] = [];
      this.room.state.orbitingWisps.forEach((w, id) => {
        if (w.ownerSessionId === ownerId) {
          remaining.push({ id, spawnedAt: w.spawnedAt });
        }
      });
      if (remaining.length === 0) continue;
      remaining.sort((a, b) => a.spawnedAt - b.spawnedAt);
      const currentPhases = remaining.map((r) => {
        const w = this.room.state.orbitingWisps.get(r.id);
        return w?.orbitPhase ?? 0;
      });
      const slots = orbitingWispRetargetPhases(currentPhases, remaining.length);
      for (let i = 0; i < remaining.length; i++) {
        this.orbitingWispTargetPhase.set(remaining[i]!.id, slots[i]!);
      }
    }
  }

  /** Drop every chain involving this session (caster or target). */
  clearAstralChainsForSession(sessionId: string) {
    const toBreak: string[] = [];
    this.room.state.astralChains.forEach((c, id) => {
      if (c.casterId === sessionId || c.targetId === sessionId) toBreak.push(id);
    });
    for (const id of toBreak) this.breakAstralChain(id, "hard");
  }

  clearAllAstralChains(reason: "expire" | "escape" | "hard" | "silent") {
    const ids: string[] = [];
    this.room.state.astralChains.forEach((_, id) => ids.push(id));
    for (const id of ids) this.breakAstralChain(id, reason);
  }

  /** Target Dash/Blink mobility snaps their leash. */
  private tryBreakAstralChainOnEscape(
    sessionId: string,
    def: AbilityDef,
    _now: number,
  ) {
    if (!abilityBreaksAstralChain(def)) return;
    const toBreak: string[] = [];
    this.room.state.astralChains.forEach((c, id) => {
      if (c.targetId === sessionId) toBreak.push(id);
    });
    for (const id of toBreak) this.breakAstralChain(id, "escape");
  }

  private applyAstralChainHit(
    targetId: string,
    damage: number,
    attackerSessionId: string,
    abilityId: string,
    now: number,
  ) {
    const def = ABILITIES[abilityId] ?? ABILITIES.astralChain;
    if (!def) return;
    this.applyDamage(targetId, damage, attackerSessionId, abilityId, now);

    const caster = this.room.state.players.get(attackerSessionId);
    const target =
      this.room.state.players.get(targetId) ?? this.room.state.targets.get(targetId);
    if (!caster || !target || caster.hp <= 0) return;
    if ("hp" in target && target.hp <= 0) return;

    // One active leash per caster — replace existing.
    const replace: string[] = [];
    this.room.state.astralChains.forEach((c, id) => {
      if (c.casterId === attackerSessionId) replace.push(id);
    });
    for (const id of replace) this.breakAstralChain(id, "hard");

    const dist = Math.hypot(target.x - caster.x, target.z - caster.z);
    const maxDistance = Math.max(
      dist,
      ASTRAL_CHAIN_CAST.minTetherDistance,
    );
    const durationMs = def.tetherDurationMs ?? ASTRAL_CHAIN_CAST.tetherDurationMs;
    const id = `achain_${this.nextId++}`;
    const st = new AstralChainState();
    st.id = id;
    st.casterId = attackerSessionId;
    st.targetId = targetId;
    st.abilityId = def.id;
    st.startedAt = now;
    st.endsAt = now + durationMs;
    st.maxDistance = maxDistance;
    this.room.state.astralChains.set(id, st);

    this.statuses.apply(attackerSessionId, "astralChainBurden", attackerSessionId, now, {
      durationMs,
    });
  }

  private advanceAstralChains(now: number) {
    if (this.room.state.astralChains.size === 0) return;
    const toBreak: { id: string; reason: "expire" | "hard" }[] = [];

    this.room.state.astralChains.forEach((chain, id) => {
      if (now >= chain.endsAt) {
        toBreak.push({ id, reason: "expire" });
        return;
      }
      const caster = this.room.state.players.get(chain.casterId);
      const targetPlayer = this.room.state.players.get(chain.targetId);
      const targetDummy = this.room.state.targets.get(chain.targetId);
      const target = targetPlayer ?? targetDummy;

      if (
        !caster ||
        caster.hp <= 0 ||
        caster.disconnected ||
        !target ||
        target.hp <= 0
      ) {
        toBreak.push({ id, reason: "hard" });
        return;
      }

      // Keep burden status locked to remaining tether time.
      const remain = Math.max(1, chain.endsAt - now);
      if (!this.statuses.has(chain.casterId, "astralChainBurden")) {
        this.statuses.apply(chain.casterId, "astralChainBurden", chain.casterId, now, {
          durationMs: remain,
        });
      }

      // Target cannot walk out. Caster may walk away — then soft-tug the target.
      const dist = Math.hypot(target.x - caster.x, target.z - caster.z);
      const slack = 0.04;
      if (dist <= chain.maxDistance + slack) return;

      const pullStrength = ASTRAL_CHAIN_CAST.casterPullStrength;
      const softStretch = ASTRAL_CHAIN_CAST.softStretchMeters;
      const excess = dist - chain.maxDistance;
      const inv = 1 / dist;
      const nx = (target.x - caster.x) * inv;
      const nz = (target.z - caster.z) * inv;

      // Map props are immovable — no drag; caster hits the leash instead.
      if (targetDummy?.kind === PROP_TARGET_KIND) {
        const clampedCaster = constrainAstralTetherDesired(
          target.x,
          target.z,
          caster.x,
          caster.z,
          chain.maxDistance,
        );
        const resolved = this.clampPlayerPos(chain.casterId, clampedCaster);
        caster.x = resolved.x;
        caster.z = resolved.z;
        return;
      }

      // Soft tug on players / dummies: only a fraction of excess. Hard clamp past soft stretch.
      const tug =
        dist > chain.maxDistance + softStretch
          ? excess
          : excess * Math.max(0, Math.min(1, pullStrength));

      if (targetPlayer) {
        const nextTarget = {
          x: targetPlayer.x - nx * tug,
          z: targetPlayer.z - nz * tug,
        };
        const resolved = this.clampPlayerPos(chain.targetId, nextTarget);
        targetPlayer.x = resolved.x;
        targetPlayer.z = resolved.z;
      } else if (targetDummy) {
        targetDummy.x -= nx * tug;
        targetDummy.z -= nz * tug;
      }
    });

    for (const { id, reason } of toBreak) this.breakAstralChain(id, reason);
  }

  private breakAstralChain(
    id: string,
    reason: "expire" | "escape" | "hard" | "silent",
  ) {
    const chain = this.room.state.astralChains.get(id);
    if (!chain) return;
    const caster = this.room.state.players.get(chain.casterId);
    const target =
      this.room.state.players.get(chain.targetId) ??
      this.room.state.targets.get(chain.targetId);

    this.statuses.remove(chain.casterId, "astralChainBurden", chain.casterId);
    this.room.state.astralChains.delete(id);

    if (reason === "silent") return;

    const cx = caster?.x ?? 0;
    const cz = caster?.z ?? 0;
    const tx = target?.x ?? cx;
    const tz = target?.z ?? cz;
    // variant: 0 expire, 1 escape snap, 2 hard/death cleanup
    const variant = reason === "expire" ? 0 : reason === "escape" ? 1 : 2;
    this.fx({
      kind: "aoe",
      abilityId: chain.abilityId || "astralChain",
      x: cx,
      z: cz,
      x2: tx,
      z2: tz,
      y: ASTRAL_CHAIN_CAST.handY,
      ownerId: chain.casterId,
      targetId: chain.targetId,
      radius: chain.maxDistance,
      variant,
    });
  }

  /** Drop husk without snapping (leave / death). */
  clearSpiritForm(sessionId: string, now: number, snap: boolean) {
    if (snap) {
      this.endSpiritForm(sessionId, now);
      return;
    }
    const active = this.spiritForms.get(sessionId);
    if (active) {
      this.spiritForms.delete(sessionId);
      this.room.state.spiritHusks.delete(active.huskId);
      this.statuses.remove(sessionId, "spiritFormed");
    }
    this.clearSpiritReturn(sessionId);
  }

  private clearSpiritReturn(sessionId: string) {
    const huskId = this.spiritReturnHusks.get(sessionId);
    if (huskId) {
      this.spiritReturnHusks.delete(sessionId);
      this.room.state.spiritHusks.delete(huskId);
    }
    // Cancel in-flight return dash if any.
    const travel = this.travels.get(sessionId);
    if (travel?.abilityId === "spiritForm") this.travels.delete(sessionId);
  }

  private finishSpiritReturn(sessionId: string) {
    const huskId = this.spiritReturnHusks.get(sessionId);
    if (!huskId) return;
    this.spiritReturnHusks.delete(sessionId);
    this.room.state.spiritHusks.delete(huskId);
  }

  private spiritReturnDurationMs(dist: number): number {
    const raw = (dist / Math.max(0.1, SPIRIT_FORM_CAST.snapReturnSpeed)) * 1000;
    return Math.max(
      SPIRIT_FORM_CAST.snapReturnMinMs,
      Math.min(SPIRIT_FORM_CAST.snapReturnMaxMs, Math.round(raw)),
    );
  }

  private advanceSpiritForms(now: number) {
    if (this.spiritForms.size === 0) return;
    for (const [sessionId, active] of [...this.spiritForms]) {
      if (now >= active.endsAt) {
        this.endSpiritForm(sessionId, now);
        continue;
      }
      const player = this.room.state.players.get(sessionId);
      if (!player || player.disconnected || player.hp <= 0) {
        this.clearSpiritForm(sessionId, now, false);
        continue;
      }
      this.applySpiritLinkHits(sessionId, active, player, now);
    }
  }

  /**
   * Spirit Form tether — stun enemies that cross the husk↔spirit link (once each).
   */
  private applySpiritLinkHits(
    sessionId: string,
    active: { huskId: string; linkHitIds: Set<string> },
    player: PlayerState,
    now: number,
  ) {
    const husk = this.room.state.spiritHusks.get(active.huskId);
    if (!husk) return;

    const fromX = husk.x;
    const fromZ = husk.z;
    const toX = player.x;
    const toZ = player.z;
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;

    const hitR = SPIRIT_FORM_CAST.linkHitRadius;
    const bodies = this.collectBodies();
    const steps = Math.max(1, Math.ceil(len / Math.max(0.25, hitR * 0.85)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = fromX + dx * t;
      const cz = fromZ + dz * t;
      const hits = resolveInstantHits(
        { x: cx, z: cz },
        hitR,
        0,
        sessionId,
        bodies,
        (o, tid) => this.canHurt(o, tid),
      );
      for (const hit of hits) {
        if (active.linkHitIds.has(hit.targetId)) continue;
        const applied = this.statuses.apply(hit.targetId, "stunned", sessionId, now, {
          durationMs: SPIRIT_FORM_CAST.linkStunMs,
        });
        if (!applied) continue;
        active.linkHitIds.add(hit.targetId);
        this.fx({
          kind: "hit",
          abilityId: "spiritForm",
          x: cx,
          z: cz,
          ownerId: sessionId,
          targetId: hit.targetId,
          damage: 0,
        });
      }
    }
  }

  private commitSpiritForm(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
  ) {
    this.clearSpiritForm(sessionId, now, false);

    const yaw = player.yaw;
    const origin = { x: player.x, z: player.z };
    const huskIdeal = pointInFront(origin, yaw + Math.PI, SPIRIT_FORM_CAST.huskBack);
    const spiritIdeal = pointInFront(origin, yaw, SPIRIT_FORM_CAST.splitForward);
    const spiritPos = this.sweepPlayerPos(sessionId, origin, spiritIdeal);

    const huskId = `spirit_husk_${this.nextId++}`;
    const husk = new SpiritHuskState();
    husk.id = huskId;
    husk.ownerSessionId = sessionId;
    husk.x = huskIdeal.x;
    husk.z = huskIdeal.z;
    husk.yaw = yaw;
    husk.color = player.color || STARTER_COLORS[0]!;
    husk.pattern = player.pattern || DEFAULT_COSMETIC_PATTERN;
    husk.patternColor = player.patternColor || DEFAULT_COSMETIC_PATTERN_COLOR;
    husk.startedAt = now;
    husk.expiresAt = now + SPIRIT_FORM_CAST.formMs;
    this.room.state.spiritHusks.set(huskId, husk);

    player.x = spiritPos.x;
    player.z = spiritPos.z;

    this.spiritForms.set(sessionId, {
      huskId,
      endsAt: husk.expiresAt,
      linkHitIds: new Set(),
    });

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: husk.x,
      z: husk.z,
      x2: spiritPos.x,
      z2: spiritPos.z,
      yaw,
      ownerId: sessionId,
      radius: SPIRIT_FORM_CAST.timerRingRadius,
      variant: 0,
      phaseEndsAt: husk.expiresAt,
    });
  }

  private endSpiritForm(sessionId: string, now: number) {
    const active = this.spiritForms.get(sessionId);
    if (!active) return;
    const player = this.room.state.players.get(sessionId);
    const husk = this.room.state.spiritHusks.get(active.huskId);
    this.spiritForms.delete(sessionId);
    this.statuses.remove(sessionId, "spiritFormed");

    if (player && husk && player.hp > 0 && !player.disconnected) {
      const from = { x: player.x, z: player.z };
      // Return ignores collision — always land on the husk pose.
      const landed = { x: husk.x, z: husk.z };
      const dx = landed.x - from.x;
      const dz = landed.z - from.z;
      const dist = Math.hypot(dx, dz);
      const dur = this.spiritReturnDurationMs(dist);
      const yaw = dist > 1e-4 ? Math.atan2(dx, dz) : player.yaw;

      this.travels.delete(sessionId);
      if (dist >= 0.05) {
        this.travels.set(sessionId, {
          abilityId: "spiritForm",
          fromX: from.x,
          fromZ: from.z,
          yaw,
          distance: dist,
          startAt: now,
          endAt: now + dur,
          lastX: from.x,
          lastZ: from.z,
          ignoreCollision: true,
        });
      } else {
        player.x = landed.x;
        player.z = landed.z;
      }

      this.spiritReturnHusks.set(sessionId, active.huskId);
      this.blinkIframeUntil.set(
        sessionId,
        now + Math.max(dur, SPIRIT_FORM_CAST.snapIframeMs),
      );
      this.fx({
        kind: "dash",
        abilityId: "spiritForm",
        x: from.x,
        z: from.z,
        x2: landed.x,
        z2: landed.z,
        yaw,
        ownerId: sessionId,
        phaseEndsAt: now + dur,
        variant: 1,
      });
      if (dist < 0.05) this.finishSpiritReturn(sessionId);
      return;
    }

    if (husk) this.room.state.spiritHusks.delete(active.huskId);
  }

  getMoveMultiplier(sessionId: string): number {
    if (this.travels.has(sessionId)) return 0;
    let mul = 1;
    const cast = this.casts.get(sessionId);
    const combo = this.combos.get(sessionId);
    const now = Date.now();

    if (cast) {
      const def = ABILITIES[cast.abilityId];
      if (def) mul *= resolveCastMoveMul(def, cast.phase);
    } else if (combo?.hitsDone && combo.continueUntil > now) {
      mul *= resolveComboContinueMoveMul(ABILITIES[combo.abilityId]);
    }

    mul *= this.statuses.getMoveMul(sessionId);
    return mul;
  }

  getEffectiveMoveSpeed(sessionId: string, base = MOVE_SPEED): number {
    if (!this.statuses.canMove(sessionId)) return 0;
    const kitMul = this.kits.get(sessionId)?.moveSpeedMul ?? 1;
    return base * kitMul * this.getMoveMultiplier(sessionId);
  }

  tryBeginCast(
    sessionId: string,
    player: PlayerState,
    castId: string,
    now: number,
    opts?: CastBeginOpts,
  ): boolean {
    /** Client sets awaitingCastAck optimistically — silent reject leaves casting stuck. */
    const reject = (): false => {
      this.phaseFx(sessionId, player, castId, "cancel", now);
      return false;
    };

    const kit = this.kits.get(sessionId);
    const inLoadout = kit ? kit.loadoutIds.has(castId) : player.loadout.split(",").includes(castId);
    // Flex picks are castable too, but they are paid for. Tracked separately
    // from `inLoadout` so only the flex route is charged -- a spell sitting in
    // both places would otherwise cost Energy from its own main-bar key.
    const fromFlex = !inLoadout && player.flexLoadout.split(",").includes(castId);
    if (!inLoadout && !fromFlex) return reject();
    const def = ABILITIES[castId];
    if (!def) return reject();
    if (player.disconnected || player.hp <= 0) return reject();
    if (player.role === "spectator") return reject();
    if (!this.statuses.canCast(sessionId)) return reject();

    // Spirit Form recast: snap back without needing CD ready.
    if (castId === "spiritForm" && this.spiritForms.has(sessionId)) {
      this.endSpiritForm(sessionId, now);
      return true;
    }

    // Runic Shard recast: shatter active main shard (no cast anim / no CD refresh).
    if (castId === "runicShard") {
      const shard = this.findActiveRunicShard(sessionId);
      if (shard) {
        // Hold-LMB re-sends every frame — ignore until arming clears.
        if ((shard.shatterReadyAt ?? 0) > now) {
          this.phaseFx(sessionId, player, "runicShard", "idle", now);
          return true;
        }
        this.shatterRunicShard(sessionId, shard, now);
        // Ack client awaitingCastAck without starting a cast.
        this.phaseFx(sessionId, player, "runicShard", "idle", now);
        return true;
      }
      // Volley still resolving (fragments / stale state) — no new throw.
      if (this.hasRunicShardVolley(sessionId)) {
        return reject();
      }
    }

    // Rift Fissure second plant: allow during CD while arming portal B.
    const riftArming =
      castId === "riftFissure" &&
      (() => {
        const pending = this.pendingRifts.get(sessionId);
        return Boolean(pending && !pending.portalBId && now < pending.armEndsAt);
      })();

    const existing = this.casts.get(sessionId);
    if (existing) {
      const cur = ABILITIES[existing.abilityId];
      const canCut = canInterruptOtherCast(def, cur, {
        sameAbility: existing.abilityId === castId,
      });
      if (canCut) {
        // Fired missiles keep living; only caster phases/anim are cleared
        this.softInterruptCast(sessionId, player, now);
      } else if (cur?.timing.blocksOtherCasts !== false) {
        return reject();
      }
    }

    // After soft-interrupt, travel from the old cast may be gone; still block if mid-travel of same/other
    if (this.travels.has(sessionId)) return reject();

    if (!this.noCooldownSessions.has(sessionId) && !riftArming) {
      let bag = this.cds.get(sessionId);
      if (!bag) {
        bag = new Map();
        this.cds.set(sessionId, bag);
      }
      if ((bag.get(castId) ?? 0) > now) return reject();
    }

    // Affordability is checked before anything with a side effect (ending an
    // open combo, breaking cloak) so a rejected flex cast leaves the kit
    // exactly as it was. The spend itself happens once the cast is committed.
    const energyCost = fromFlex ? flexCost(castId) : 0;
    if (energyCost > 0 && Math.floor(player.energy) < energyCost) return reject();

    // Switching abilities ends an open combo continue window (stop LMB chain when casting RMB, etc.)
    const openCombo = this.combos.get(sessionId);
    if (openCombo && openCombo.abilityId !== castId) {
      const endedId = openCombo.abilityId;
      const cooldownMs = this.endComboEarly(sessionId, endedId, true, now);
      if (cooldownMs != null) {
        this.phaseFx(sessionId, player, endedId, "idle", now, { cooldownMs });
      }
    }

    const first = nextCastPhase(def, null);
    if (!first) return reject();

    // Committed: past every reject path, so the charge is safe to take. Whole
    // pips only -- the fractional remainder is kept, since it was earned.
    if (energyCost > 0) {
      player.energy = clampEnergy(player.energy - energyCost);
    }

    // Any successful new cast breaks cloak (including re-casting Decoy).
    this.revealCloak(sessionId);
    this.tryBreakAstralChainOnEscape(sessionId, def, now);

    const moveX = opts?.moveX ?? 0;
    const moveZ = opts?.moveZ ?? 0;
    const aimX = opts?.aimX;
    const aimZ = opts?.aimZ;

    this.beginComboHitIndex(sessionId, player, def);

    if (first === "impact") {
      // Seed cast early so fireEffect can read move stick for Decoy.
      this.casts.set(sessionId, {
        abilityId: def.id,
        phase: "impact",
        phaseEndsAt: now,
        castStartedAt: now,
        yaw: player.yaw,
        effectFired: false,
        moveX,
        moveZ,
        aimX,
        aimZ,
        originX: player.x,
        originZ: player.z,
      });
      const committed = this.fireEffect(sessionId, player, def, now);
      const cooldownMs = committed
        ? this.onEffectResolved(sessionId, def, now)
        : undefined;
      this.enterPhase(sessionId, player, def, "impact", now, now, {
        cooldownMs,
        comboHit: this.comboHitFor(sessionId, def.id),
        moveX,
        moveZ,
        aimX,
        aimZ,
      });
      const live = this.casts.get(sessionId);
      if (live) live.effectFired = true;
      this.syncInvulnerable(sessionId, player, now);
      return true;
    }

    this.enterPhase(sessionId, player, def, first, now, now, {
      moveX,
      moveZ,
      aimX,
      aimZ,
    });
    // Decoy: clone + cloak commit immediately so the fake appears before the crouch.
    if (abilityEffectKind(def) === "decoy") {
      this.commitDecoyCast(sessionId, player, def, now);
    }
    // Predator Step: cloak + haste at cast begin (no dash).
    if (abilityEffectKind(def) === "predatorStep") {
      this.commitPredatorCloak(sessionId, now);
    }
    if (def.id === "barrier") {
      this.commitBarrierCast(sessionId, def, now);
    }
    if (def.id === "counter") {
      this.commitCounterCast(sessionId, now);
    }
    if (def.id === "revenge") {
      this.commitRevengeCast(sessionId, now);
    }
    this.syncInvulnerable(sessionId, player, now);
    return true;
  }

  /** Refresh ground aim on an in-progress cast (cursor tracking during windup). */
  refreshCastAim(sessionId: string, aimX?: number, aimZ?: number) {
    if (aimX == null || aimZ == null) return;
    if (!Number.isFinite(aimX) || !Number.isFinite(aimZ)) return;
    const cast = this.casts.get(sessionId);
    if (!cast) return;
    cast.aimX = aimX;
    cast.aimZ = aimZ;

    // Magma Orbs: rebroadcast meet point so observers track live aim (not phase-stamp only).
    if (cast.abilityId !== "magmaOrbs") return;
    const player = this.room.state.players.get(sessionId);
    if (!player) return;
    const meet = resolveMagmaOrbsMeetRange(
      { x: player.x, z: player.z },
      { x: aimX, z: aimZ },
    );
    // Prefer live facing — cast.yaw lags one sim tick behind input yaw.
    const yaw = player.yaw;
    cast.yaw = yaw;
    const collide = pointInFront({ x: player.x, z: player.z }, yaw, meet);
    const prev = cast.magmaMeetRange;
    const prevYaw = cast.magmaMeetYaw;
    const now = Date.now();
    const msToPhaseEnd = cast.phaseEndsAt - now;
    // Last third of windup / any cast→impact: sync every tick so late flicks land.
    const urgent =
      cast.phase === "cast" ||
      cast.phase === "impact" ||
      msToPhaseEnd <= 450;
    const rangeDelta = prev == null ? 99 : Math.abs(prev - meet);
    const yawDelta =
      prevYaw == null ? 99 : Math.abs(Math.atan2(Math.sin(yaw - prevYaw), Math.cos(yaw - prevYaw)));
    if (!urgent && rangeDelta < 0.08 && yawDelta < 0.04) return;
    cast.magmaMeetRange = meet;
    cast.magmaMeetYaw = yaw;
    this.phaseFx(sessionId, player, "magmaOrbs", cast.phase, cast.phaseEndsAt, {
      radius: meet,
      x2: collide.x,
      z2: collide.z,
      yaw,
    });
  }

  tryCancelCast(sessionId: string, player: PlayerState, now: number): boolean {
    const cast = this.casts.get(sessionId);
    if (!cast) return false;
    const def = ABILITIES[cast.abilityId];
    if (!def) return false;
    if (!canPlayerCancelCast(def, cast.phase)) return false;

    this.revealCloak(sessionId);
    let cooldownMs = this.endComboEarly(sessionId, def.id, cast.effectFired, now);
    // Hold channels stamp CD on release / cancel once the drain has started.
    if (def.holdChannel && cast.effectFired) {
      cooldownMs = this.startCooldown(sessionId, def.id, now);
    }
    this.clearPendingFrostMist(sessionId);
    this.clearPendingGrooveHeal(sessionId);
    this.clearPendingHealBeam(sessionId);
    this.clearPendingLifeLeech(sessionId);
    this.clearPendingArcThread(sessionId, "break");
    this.clearUnarmedShrooms(sessionId);
    if (def.id === "counter") {
      this.statuses.remove(sessionId, "counterArmed");
      this.counterMistRiposted.delete(sessionId);
    }
    if (def.id === "revenge") {
      this.statuses.remove(sessionId, "revengeArmed");
      this.revengeMistBlinked.delete(sessionId);
    }
    if (def.id === "handShield") {
      this.statuses.remove(sessionId, "handShielding");
    }
    this.clearCastState(sessionId, player);
    this.phaseFx(sessionId, player, def.id, "cancel", now, { cooldownMs });
    return true;
  }

  /**
   * Confirm hold-to-release channel (Portal blink / Fireball throw).
   * Returns false if not channeling a confirm-on-release ability.
   */
  tryConfirmCast(sessionId: string, player: PlayerState, now: number): boolean {
    const cast = this.casts.get(sessionId);
    if (!cast || cast.effectFired) return false;
    if (cast.phase !== "impact") return false;
    const def = ABILITIES[cast.abilityId];
    if (!def?.confirmOnRelease) return false;

    const anchor = cast.channelAnchorAt ?? cast.castStartedAt;
    const elapsed = Math.max(0, now - anchor);
    const chargeMs = def.channelChargeMs ?? 1000;
    const graceMs = def.channelCapGraceMs ?? 1000;
    if (elapsed > chargeMs + graceMs) {
      if (abilityEffectKind(def) === "fireball") {
        return this.confirmFireball(sessionId, player, def, cast, elapsed, now);
      }
      this.tryCancelCast(sessionId, player, now);
      return false;
    }

    cast.yaw = player.yaw;

    if (abilityEffectKind(def) === "fireball") {
      return this.confirmFireball(sessionId, player, def, cast, elapsed, now);
    }

    const dist = channelChargeDistance(def, elapsed);
    const cooldownMs = this.onEffectResolved(sessionId, def, now);
    this.applyInstantBlink(sessionId, player, def, now, dist, cooldownMs);
    cast.effectFired = true;

    this.enterPhase(sessionId, player, def, "recovery", now, cast.castStartedAt, {
      cooldownMs,
      comboHit: this.comboHitFor(sessionId, def.id),
    });
    this.syncInvulnerable(sessionId, player, now);
    return true;
  }

  /** Launch fireball at current charge (0..1). Rejects before chargeMinMs.
   * Early confirm locks charge and schedules spawn at the release frame
   * (anim seeks to throw, then projectile leaves ~frame 160). */
  private confirmFireball(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    cast: ActiveCast,
    elapsedMs: number,
    now: number,
  ): boolean {
    if (elapsedMs < FIREBALL_CAST.chargeMinMs) return false;
    if (cast.fireballLaunchAt != null) return false;

    const charge01 = fireballCharge01(elapsedMs);
    cast.fireballCharge01 = charge01;
    cast.yaw = player.yaw;
    cast.effectFired = true;

    const delayMs = fireballLaunchDelayWallMs(elapsedMs);
    cast.fireballLaunchAt = now + delayMs;

    const cooldownMs = this.onEffectResolved(sessionId, def, now);
    const recoveryMs = fireballConfirmRecoveryWallMs(elapsedMs);
    this.enterPhase(sessionId, player, def, "recovery", now, cast.castStartedAt, {
      cooldownMs,
      comboHit: this.comboHitFor(sessionId, def.id),
      durationMs: recoveryMs,
    });

    // Full / late charge: spawn immediately (anim already near release).
    if (delayMs <= 16) {
      this.launchFireballProjectile(sessionId, player, def, now);
    }
    return true;
  }

  /** Spawn the fireball projectile after the release-frame delay. */
  private launchFireballProjectile(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    if (!cast || cast.abilityId !== def.id) return;
    if (cast.fireballLaunchAt == null) return;
    cast.fireballLaunchAt = undefined;

    const yawBefore = player.yaw;
    player.yaw = cast.yaw;
    this.fireEffect(sessionId, player, def, now);
    player.yaw = yawBefore;
  }

  /** Scale fireball blast from charge; flight collision stays compact.
   * Repositions spawn to the caster's right (matches charge VFX). */
  private stampFireballProjectile(
    sim: {
      damage: number;
      hitRadius: number;
      wallRadius: number;
      explodeDamage: number;
      explodeRadius: number;
      armingIn: number;
      x: number;
      z: number;
      vx: number;
      vz: number;
    },
    charge01 = 1,
  ) {
    const t = Math.max(0, Math.min(1, charge01));
    // Contact damage off — blast carries the hit.
    sim.damage = 0;
    // Match the charged ball size (radiusMin→Max). Explode/burn size is larger
    // and must not be used here — it spawn-detonated on walls / melee.
    sim.hitRadius = fireballLerp(
      FIREBALL_CAST.radiusMin,
      FIREBALL_CAST.radiusMax,
      t,
    );
    sim.wallRadius = Math.max(
      FIREBALL_CAST.flightWallRadius,
      sim.hitRadius * 0.85,
    );
    sim.explodeDamage = fireballLerp(
      FIREBALL_CAST.damageMin,
      FIREBALL_CAST.damageMax,
      t,
    );
    sim.explodeRadius = fireballLerp(
      FIREBALL_CAST.burnRadiusMin,
      FIREBALL_CAST.burnRadiusMax,
      t,
    );
    this.applyTalentProjectileRadii(sim.ownerId, sim);
    sim.armingIn = FIREBALL_CAST.spawnArmingMs / 1000;

    // createProjectile placed us forward by spawnOffset — rewrite to casting-hand side.
    const speed = Math.hypot(sim.vx, sim.vz) || 1;
    const fx = sim.vx / speed;
    const fz = sim.vz / speed;
    const rx = fz;
    const rz = -fx;
    const ox = sim.x - fx * FIREBALL_CAST.spawnOffset;
    const oz = sim.z - fz * FIREBALL_CAST.spawnOffset;
    sim.x = ox + fx * FIREBALL_CAST.handPush + rx * FIREBALL_CAST.handSide;
    sim.z = oz + fz * FIREBALL_CAST.handPush + rz * FIREBALL_CAST.handSide;
  }

  private scheduleFireballBurn(
    ownerId: string,
    abilityId: string,
    x: number,
    z: number,
    radius: number,
    now: number,
  ) {
    const durationMs = Math.max(
      800,
      ABILITIES[abilityId]?.zoneDurationMs ?? FIREBALL_CAST.burnDurationMs,
    );
    const tickMs = Math.max(
      120,
      ABILITIES[abilityId]?.tickMs ?? FIREBALL_CAST.burnTickMs,
    );
    this.pendingFireballBurns.push({
      ownerId,
      abilityId,
      x,
      z,
      radius,
      nextTickAt: now,
      expiresAt: now + durationMs,
      tickMs,
    });
  }

  private advancePendingFireballBurns(now: number) {
    if (this.pendingFireballBurns.length === 0) return;
    const remain: PendingFireballBurn[] = [];
    const bodies = this.collectBodies();
    for (const zone of this.pendingFireballBurns) {
      if (now >= zone.expiresAt) continue;
      const def = ABILITIES[zone.abilityId];
      while (zone.nextTickAt <= now && zone.nextTickAt < zone.expiresAt) {
        for (const body of bodies) {
          if (!this.canHurt(zone.ownerId, body.id)) continue;
          if (body.vulnerable === false) continue;
          if (body.hp <= 0) continue;
          if (
            !circlesOverlap(
              zone.x,
              zone.z,
              zone.radius,
              body.x,
              body.z,
              hitRadiusOf(body),
            )
          ) {
            continue;
          }
          this.applyOutgoingStatusApps(
            body.id,
            def?.applyOnHit ?? [{ statusId: "burning", chance: 1 }],
            zone.ownerId,
            now,
          );
        }
        zone.nextTickAt += zone.tickMs;
      }
      if (now < zone.expiresAt) remain.push(zone);
    }
    this.pendingFireballBurns = remain;
  }

  /** Instant travel + portal FX at from/to. */
  private applyInstantBlink(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
    distance: number,
    cooldownMs?: number,
  ) {
    const from = { x: player.x, z: player.z };
    const off = dashOffset(player.yaw, Math.max(0, distance));
    const clamped = this.sweepPlayerPos(sessionId, from, {
      x: player.x + off.x,
      z: player.z + off.z,
    });
    player.x = clamped.x;
    player.z = clamped.z;

    const iframeMs = def.iFrames?.durationMs ?? 100;
    this.blinkIframeUntil.set(sessionId, now + Math.max(40, iframeMs));

    this.fx({
      kind: "portal",
      abilityId: def.id,
      x: from.x,
      z: from.z,
      x2: clamped.x,
      z2: clamped.z,
      yaw: player.yaw,
      ownerId: sessionId,
      cooldownMs,
    });
  }

  tick(dt: number, now: number) {
    // Before anything that can deal damage this tick, so a hit is measured
    // against an allowance that has already accounted for the elapsed time.
    for (const limiter of this.energyLimiters.values()) limiter.refill(dt);
    this.advanceTravels(now);
    this.advanceKnockbacks(now);
    this.advanceCasts(now);
    this.advanceCombos(now);
    this.advancePendingSpikes(now);
    this.advancePendingArcBladeHits(now);
    this.advancePendingBloomingPaths(now);
    this.advancePendingTeleportSlamBlinks(now);
    this.advancePendingDelayedAoes(now);
    this.advancePendingSilenceSweeps(now);
    this.advancePendingFirewalls(now);
    this.advancePendingPoisonClouds(now);
    this.advancePendingHolyGrounds(now);
    this.advancePendingSlipstreams(dt, now);
    this.tickSoulRelays(now);
    this.advancePendingSoulRelayHeals(now);
    this.advancePendingRifts(now);
    this.advancePendingFireballBurns(now);
    this.advancePendingVolcanoes(now);
    this.advancePendingMagmaOrbs(now);
    this.advancePendingProtectionBubbles(now);
    this.advancePendingShrooms(now);
    this.advancePendingFrostMist(now);
    this.advancePendingGrooveHeal(now);
    this.advancePendingHealBeam(now);
    this.advancePendingLifeLeech(now);
    this.advancePendingArcThreads(now);
    this.advancePendingBarrier(now);
    this.advanceDecoys(dt, now);
    this.advanceOrbitingWisps(dt, now);
    this.advanceAstralChains(now);
    this.advanceSoulSevers(now);
    this.advanceSpiritForms(now);
    this.syncAllInvulnerable(now);
    this.statuses.tick(now);

    if (this.sims.size === 0) return;

    const bodies = this.collectBodies();
    const normalSims: ProjectileSim[] = [];
    const returningSims: ProjectileSim[] = [];
    for (const sim of this.sims.values()) {
      if (isReturningProjectileSim(sim)) returningSims.push(sim);
      else normalSims.push(sim);
    }
    const blockers = this.collectProjectileBlockColliders(now);
    const canHurt = (o: string, t: string) => this.canHurt(o, t);
    const canHeal = (o: string, t: string) => this.canHealTarget(o, t);
    const normalTick = tickProjectiles(
      normalSims,
      dt,
      bodies,
      canHurt,
      this.wallColliders,
      (abilityId) => {
        const delay = ABILITIES[abilityId]?.detonate?.delayMs ?? 0;
        return delay > 0 ? delay / 1000 : 0;
      },
      blockers,
      this.circleColliders,
      this.boxColliders,
      canHeal,
    );
    // Signature differs from tickProjectiles (no detonate delay callback).
    const returningTick = tickReturningProjectiles(
      returningSims,
      dt,
      bodies,
      canHurt,
      this.wallColliders,
      blockers,
      this.circleColliders,
      this.boxColliders,
    );
    const removedIds = [...normalTick.removedIds, ...returningTick.removedIds];
    const hits = [...normalTick.hits, ...returningTick.hits];
    const slows = [...normalTick.slows, ...returningTick.slows];
    const explodes = [...normalTick.explodes, ...returningTick.explodes];
    const wallHits = [...normalTick.wallHits, ...returningTick.wallHits];

    for (const hit of hits) {
      // Aura ticks: damage only (slows applied separately). Contact: damage + applyOnHit.
      const def = ABILITIES[hit.abilityId];
      if (abilityEffectKind(def) === "soulMark") {
        this.applySoulMarkHit(hit.targetId, hit.damage, hit.ownerId, hit.abilityId, now);
        continue;
      }
      if (abilityEffectKind(def) === "soulSever") {
        this.applySoulSeverHit(hit.targetId, hit.damage, hit.ownerId, hit.abilityId, now);
        continue;
      }
      if (abilityEffectKind(def) === "astralChain") {
        this.applyAstralChainHit(hit.targetId, hit.damage, hit.ownerId, hit.abilityId, now);
        continue;
      }
      if (abilityEffectKind(def) === "runicShard") {
        const dealt = this.applyRawDamage(
          hit.targetId,
          hit.damage,
          hit.ownerId,
          hit.abilityId,
        );
        const sim = this.sims.get(hit.projectileId);
        if (dealt > 0 && sim?.isRunicFragment) {
          this.applyRunicShardChill(hit.targetId, hit.ownerId, now);
        }
        if (dealt > 0) this.trySoulRelayTrigger(hit.ownerId, hit.abilityId, dealt);
        continue;
      }
      if (abilityEffectKind(def) === "bloomingPath") {
        // Corridor zone owns healing — tip contact does not pulse-heal.
        continue;
      }
      if (def?.aura) {
        this.applyRawDamage(hit.targetId, hit.damage, hit.ownerId, hit.abilityId);
      } else {
        this.applyDamage(hit.targetId, hit.damage, hit.ownerId, hit.abilityId, now);
      }
      if (def?.pull && def.pull > 0) {
        if (def.leapToTarget) {
          this.applySelfLeap(
            hit.ownerId,
            hit.targetId,
            def.pull,
            def.pullMs ?? 280,
            now,
            def.pullStopDistance,
          );
        } else {
          this.applyPull(
            hit.ownerId,
            hit.targetId,
            def.pull,
            def.pullMs ?? 280,
            now,
            def.pullStopDistance,
          );
        }
      }
    }
    for (const slow of slows) {
      const def = ABILITIES[slow.abilityId];
      if (def?.applyAuraSlow?.length) {
        this.applyOutgoingStatusApps(
          slow.targetId,
          def.applyAuraSlow,
          slow.ownerId,
          now,
        );
      }
    }
    for (const blast of explodes) {
      // Detonate blast — raw AoE (not direct / does not trigger Counter).
      // Match Ice Lance plant heights: body stick vs dirt plant.
      const blastY = blast.mode === "stuck" ? 1.05 : 0.28;
      this.fx({
        kind: "aoe",
        abilityId: blast.abilityId,
        x: blast.x,
        z: blast.z,
        y: blastY,
        radius: blast.radius,
        ownerId: blast.ownerId,
      });
      const blastHits = resolveInstantHits(
        { x: blast.x, z: blast.z },
        blast.radius,
        blast.damage,
        blast.ownerId,
        bodies,
        (o, t) => this.canHurt(o, t),
      );
      for (const hit of blastHits) {
        this.applyRawDamage(hit.targetId, hit.damage, blast.ownerId, blast.abilityId, {
          triggersCounter: false,
        });
        const blastDef = ABILITIES[blast.abilityId];
        if (blastDef?.applyOnHit?.length) {
          this.applyOutgoingStatusApps(
            hit.targetId,
            blastDef.applyOnHit,
            blast.ownerId,
            now,
          );
        }
      }
      if (abilityEffectKind(ABILITIES[blast.abilityId]) === "fireball") {
        this.scheduleFireballBurn(
          blast.ownerId,
          blast.abilityId,
          blast.x,
          blast.z,
          blast.radius,
          now,
        );
      }
    }
    for (const id of removedIds) {
      const sim = this.sims.get(id);
      if (sim && abilityEffectKind(ABILITIES[sim.abilityId]) === "bloomingPath") {
        this.finalizeBloomingPathZone(id, sim.x, sim.z, now);
        // Linger trail after tip despawns (life end or wall).
        this.fx({
          kind: "aoe",
          abilityId: sim.abilityId,
          x: sim.x,
          z: sim.z,
          x2: sim.spawnX ?? sim.x,
          z2: sim.spawnZ ?? sim.z,
          y: 0.08,
          ownerId: sim.ownerId,
          variant: 1,
          radius: sim.hitRadius,
        });
      }
      this.sims.delete(id);
      this.room.state.projectiles.delete(id);
    }
    for (const wall of wallHits) {
      if (abilityEffectKind(ABILITIES[wall.abilityId]) === "bloomingPath") {
        // Vine linger FX already spawned from removedIds — skip wall fizzle.
        const bubbleId = wall.blockBubbleId;
        if (bubbleId?.startsWith("handShield_")) {
          this.fireHandShieldRetaliate(bubbleId.slice("handShield_".length), now);
        }
        continue;
      }
      if (!wall.detonatedOnBlock) {
        this.fx({
          kind: "hit",
          abilityId: wall.abilityId,
          x: wall.x,
          z: wall.z,
          y: 0.55,
          ownerId: wall.ownerId,
          damage: 0,
          variant: COMBAT_FX_VARIANT_WALL_HIT,
        });
      }
      const bubbleId = wall.blockBubbleId;
      if (bubbleId?.startsWith("handShield_")) {
        this.fireHandShieldRetaliate(bubbleId.slice("handShield_".length), now);
      }
    }
    for (const [id, sim] of this.sims) {
      const st = this.room.state.projectiles.get(id);
      if (!st) continue;
      st.x = sim.x;
      st.z = sim.z;
      st.vx = sim.vx;
      st.vz = sim.vz;
      st.mode = sim.mode;
      st.stuckTargetId = sim.stuckTargetId ?? "";
    }
  }

  private advanceKnockbacks(now: number) {
    for (const [id, kb] of this.knockbacks) {
      const dur = Math.max(1, kb.endAt - kb.startAt);
      const linear = Math.min(1, Math.max(0, (now - kb.startAt) / dur));
      // Ease-out so the shove hits hard then settles.
      const t = 1 - (1 - linear) * (1 - linear);
      const ideal = {
        x: kb.fromX + (kb.toX - kb.fromX) * t,
        z: kb.fromZ + (kb.toZ - kb.fromZ) * t,
      };
      const clamped = this.sweepPlayerPos(
        id,
        { x: kb.fromX, z: kb.fromZ },
        ideal,
      );

      if (kb.kind === "player") {
        const player = this.room.state.players.get(id);
        if (!player) {
          this.knockbacks.delete(id);
          continue;
        }
        player.x = clamped.x;
        player.z = clamped.z;
        if (now >= kb.endAt && typeof kb.faceYaw === "number") {
          player.yaw = kb.faceYaw;
        }
      } else {
        const target = this.room.state.targets.get(id);
        if (!target || target.kind === PROP_TARGET_KIND) {
          this.knockbacks.delete(id);
          continue;
        }
        target.x = clamped.x;
        target.z = clamped.z;
        if (now >= kb.endAt && typeof kb.faceYaw === "number") {
          target.yaw = kb.faceYaw;
        }
      }

      if (now >= kb.endAt) this.knockbacks.delete(id);
    }
  }

  private advanceTravels(now: number) {
    for (const [sessionId, travel] of this.travels) {
      const player = this.room.state.players.get(sessionId);
      if (!player) {
        this.travels.delete(sessionId);
        continue;
      }

      // Soft-target Space leaps: retarget destination toward live unit.
      if (travel.followTargetId && travel.stopDistance != null) {
        const dest = this.pointNearBody(
          travel.followTargetId,
          { x: travel.fromX, z: travel.fromZ },
          travel.stopDistance,
        );
        if (dest) {
          const dx = dest.x - travel.fromX;
          const dz = dest.z - travel.fromZ;
          const len = Math.hypot(dx, dz);
          if (len > 1e-4) {
            travel.yaw = Math.atan2(dx, dz);
            const clamped = this.sweepPlayerPos(
              sessionId,
              { x: travel.fromX, z: travel.fromZ },
              dest,
            );
            travel.distance = Math.hypot(
              clamped.x - travel.fromX,
              clamped.z - travel.fromZ,
            );
          }
        }
      }

      const dur = Math.max(1, travel.endAt - travel.startAt);
      const linear = Math.min(1, Math.max(0, (now - travel.startAt) / dur));
      const def = ABILITIES[travel.abilityId];
      const progress = def ? travelProgress01(def, linear) : linear;
      const pos = sampleTravel(
        { x: travel.fromX, z: travel.fromZ },
        travel.yaw,
        travel.distance,
        progress,
      );
      const next = travel.ignoreCollision
        ? pos
        : this.sweepPlayerPos(sessionId, { x: travel.fromX, z: travel.fromZ }, pos);
      const prevX = travel.lastX ?? travel.fromX;
      const prevZ = travel.lastZ ?? travel.fromZ;
      player.x = next.x;
      player.z = next.z;
      travel.lastX = next.x;
      travel.lastZ = next.z;

      if (def?.travel?.hitAlongPath) {
        this.applyTravelPathHits(sessionId, travel, def, prevX, prevZ, next.x, next.z, now);
      }
      if (travel.spaceArrive === "bulwarkCharge") {
        this.applyBulwarkPathShoves(sessionId, travel, prevX, prevZ, next.x, next.z, now);
      }

      if (now >= travel.endAt) {
        const pending = travel.pendingLandingEffect;
        const abilityId = travel.abilityId;
        const spaceArrive = travel.spaceArrive;
        const followTargetId = travel.followTargetId;
        this.travels.delete(sessionId);
        if (abilityId === "spiritForm") {
          this.finishSpiritReturn(sessionId);
        }
        if (spaceArrive === "verdantLeap") {
          this.finishVerdantLeap(sessionId, followTargetId, now);
        } else if (spaceArrive === "bulwarkCharge") {
          this.finishBulwarkCharge(sessionId, now);
        } else if (spaceArrive === "predatorStep") {
          this.finishPredatorStep(sessionId, now);
        }
        if (pending) {
          const landDef = ABILITIES[abilityId];
          if (landDef) this.resolveLandingEffect(sessionId, player, landDef, now);
        }
      }
    }
  }

  /**
   * Blood Rush — nick + bleed any unit the dash segment overlaps (once per cast).
   */
  private applyTravelPathHits(
    sessionId: string,
    travel: ActiveTravel,
    def: (typeof ABILITIES)[string],
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    now: number,
  ) {
    if (!travel.pathHitIds) travel.pathHitIds = new Set();
    const hitR = def.radius ?? 0.75;
    const damage = def.damage ?? 0;
    const bodies = this.collectBodies();
    // Sample midpoints along the segment so fast dashes don't skip thin targets.
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / Math.max(0.25, hitR * 0.85)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = fromX + dx * t;
      const cz = fromZ + dz * t;
      const hits = resolveInstantHits(
        { x: cx, z: cz },
        hitR,
        damage,
        sessionId,
        bodies,
        (o, tid) => this.canHurt(o, tid),
      );
      for (const hit of hits) {
        if (travel.pathHitIds.has(hit.targetId)) continue;
        travel.pathHitIds.add(hit.targetId);
        let dmg = hit.damage;
        const thresh = def.executeBelowHpFrac;
        if (typeof thresh === "number" && thresh > 0) {
          const vitals = this.readVitals(hit.targetId);
          if (vitals && vitals.maxHp > 0 && vitals.hp / vitals.maxHp <= thresh) {
            dmg = Math.max(dmg, vitals.hp);
          }
        }
        this.applyDamage(hit.targetId, dmg, sessionId, def.id, now);
        this.fx({
          kind: "hit",
          abilityId: def.id,
          x: cx,
          z: cz,
          ownerId: sessionId,
          targetId: hit.targetId,
          damage: dmg,
        });
      }
    }
  }

  /**
   * Bulwark Charge — shoulder enemies / dummies aside (no damage) once per target.
   * Lateral shove relative to charge facing; centered targets pick a default side.
   */
  private applyBulwarkPathShoves(
    sessionId: string,
    travel: ActiveTravel,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    now: number,
  ) {
    if (!travel.pathHitIds) travel.pathHitIds = new Set();
    const hitR = BULWARK_CHARGE_CAST.shoveRadius;
    const bodies = this.collectBodies();
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / Math.max(0.25, hitR * 0.85)));
    const fx = Math.sin(travel.yaw);
    const fz = Math.cos(travel.yaw);
    // Perpendicular right relative to charge yaw.
    const rx = fz;
    const rz = -fx;

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = fromX + dx * t;
      const cz = fromZ + dz * t;
      const hits = resolveInstantHits(
        { x: cx, z: cz },
        hitR,
        0,
        sessionId,
        bodies,
        (o, tid) => this.canHurt(o, tid),
      );
      for (const hit of hits) {
        if (travel.pathHitIds.has(hit.targetId)) continue;
        travel.pathHitIds.add(hit.targetId);
        const body = this.bodyPos(hit.targetId);
        if (!body) continue;
        const ox = body.x - cx;
        const oz = body.z - cz;
        let side = Math.sign(ox * rx + oz * rz);
        if (side === 0) {
          // Dead-center: prefer the side that clears the charge lane farther.
          side = 1;
        }
        this.applyLateralKnockback(
          hit.targetId,
          rx * side,
          rz * side,
          BULWARK_CHARGE_CAST.shoveDistance,
          BULWARK_CHARGE_CAST.shoveMs,
          now,
        );
      }
    }
  }

  /** Current HP / max for players or practice targets. */
  private readVitals(targetId: string): { hp: number; maxHp: number } | null {
    const player = this.room.state.players.get(targetId);
    if (player) return { hp: player.hp, maxHp: Math.max(1, player.maxHp) };
    const target = this.room.state.targets.get(targetId);
    if (target) return { hp: target.hp, maxHp: Math.max(1, target.maxHp) };
    return null;
  }

  private advanceCasts(now: number) {
    for (const [sessionId, cast] of this.casts) {
      const player = this.room.state.players.get(sessionId);
      if (!player || player.disconnected || player.hp <= 0) {
        this.endComboEarly(sessionId, cast.abilityId, cast.effectFired, now);
        this.clearPendingFrostMist(sessionId);
        this.clearPendingGrooveHeal(sessionId);
        this.clearPendingHealBeam(sessionId);
        this.clearPendingLifeLeech(sessionId);
        this.clearPendingArcThread(sessionId, "break");
        if (player) this.clearCastState(sessionId, player);
        else {
          this.casts.delete(sessionId);
          this.travels.delete(sessionId);
        }
        continue;
      }

      // Fireball: deferred spawn until release-frame after early confirm.
      if (
        cast.fireballLaunchAt != null &&
        now >= cast.fireballLaunchAt &&
        abilityEffectKind(ABILITIES[cast.abilityId]) === "fireball"
      ) {
        const def = ABILITIES[cast.abilityId];
        if (def) this.launchFireballProjectile(sessionId, player, def, now);
      }

      // Stun / silence: hard-cancel even interruptible:false channels.
      if (!this.statuses.canCast(sessionId)) {
        this.interruptCast(sessionId);
        continue;
      }

      // Aim tracks through windup and air so Leap Slam follows the mouse.
      if (cast.phase === "anticipation" || cast.phase === "cast" || cast.phase === "impact") {
        cast.yaw = player.yaw;
      }

      // Confirm-on-release timeout while channeling (before phase ends).
      if (cast.phase === "impact" && !cast.effectFired) {
        const defEarly = ABILITIES[cast.abilityId];
        if (defEarly?.confirmOnRelease) {
          const anchor = cast.channelAnchorAt ?? cast.castStartedAt;
          const chargeMs = defEarly.channelChargeMs ?? 1000;
          const graceMs = defEarly.channelCapGraceMs ?? 1000;
          if (now - anchor >= chargeMs + graceMs) {
            if (abilityEffectKind(defEarly) === "fireball") {
              this.confirmFireball(
                sessionId,
                player,
                defEarly,
                cast,
                now - anchor,
                now,
              );
            } else {
              this.tryCancelCast(sessionId, player, now);
            }
            continue;
          }
        }
      }

      if (now < cast.phaseEndsAt) continue;

      const def = ABILITIES[cast.abilityId];
      if (!def) {
        this.clearCastState(sessionId, player);
        continue;
      }

      const next = nextCastPhase(def, cast.phase);
      if (!next) {
        this.openComboContinueWindow(sessionId, def, now);
        this.clearCastState(sessionId, player);
        this.phaseFx(sessionId, player, def.id, "idle", now);
        continue;
      }

      // Confirm-on-release: impact ended without confirm.
      // Portal cancels (no CD); fireball auto-launches at full charge.
      if (
        def.confirmOnRelease &&
        cast.phase === "impact" &&
        !cast.effectFired
      ) {
        if (abilityEffectKind(def) === "fireball") {
          const anchor = cast.channelAnchorAt ?? cast.castStartedAt;
          this.confirmFireball(
            sessionId,
            player,
            def,
            cast,
            Math.max(0, now - anchor),
            now,
          );
        } else {
          this.tryCancelCast(sessionId, player, now);
        }
        continue;
      }

      if (next === "impact" && !cast.effectFired) {
        if (def.confirmOnRelease) {
          // Enter channel — wait for confirmCast / grace (auto-fire for fireball).
          this.enterPhase(sessionId, player, def, next, now, cast.castStartedAt, {
            comboHit: this.comboHitFor(sessionId, def.id),
          });
          const live = this.casts.get(sessionId);
          if (live) live.channelAnchorAt = now;
        } else if (def.holdChannel) {
          // Start the hold effect; CD waits until release / interrupt.
          const yawBefore = player.yaw;
          player.yaw = cast.yaw;
          this.fireEffect(sessionId, player, def, now);
          player.yaw = yawBefore;
          this.enterPhase(sessionId, player, def, next, now, cast.castStartedAt, {
            comboHit: this.comboHitFor(sessionId, def.id),
          });
          const live = this.casts.get(sessionId);
          if (live) live.effectFired = true;
        } else {
          const yawBefore = player.yaw;
          player.yaw = cast.yaw;
          const committed = this.fireEffect(sessionId, player, def, now);
          player.yaw = yawBefore;
          const cooldownMs = committed
            ? this.onEffectResolved(sessionId, def, now)
            : undefined;
          const liveCast = this.casts.get(sessionId);
          this.enterPhase(sessionId, player, def, next, now, cast.castStartedAt, {
            cooldownMs,
            comboHit: this.comboHitFor(sessionId, def.id),
            durationMs: liveCast?.verdantSoloImpactMs,
          });
          const live = this.casts.get(sessionId);
          if (live) live.effectFired = true;
        }
      } else {
        // Hold-channel safety timeout: stamp CD when the max hold expires.
        if (def.holdChannel && cast.effectFired && cast.phase === "impact") {
          const cooldownMs = this.startCooldown(sessionId, def.id, now);
          this.clearPendingLifeLeech(sessionId);
          this.enterPhase(sessionId, player, def, next, now, cast.castStartedAt, {
            cooldownMs,
          });
        } else {
          this.enterPhase(sessionId, player, def, next, now, cast.castStartedAt);
        }
        // Spore Shrooms: mesh pops at cast start (spawn frame); arms at impact.
        if (next === "cast" && abilityEffectKind(def) === "shrooms") {
          this.scheduleShroom(
            sessionId,
            this.playerBody(sessionId, player),
            def,
            now,
            false,
          );
        }
      }
    }
  }

  private advanceCombos(now: number) {
    for (const [sessionId, combo] of this.combos) {
      if (combo.continueUntil <= 0 || now < combo.continueUntil) continue;
      const casting = this.casts.get(sessionId);
      if (casting?.abilityId === combo.abilityId) continue;
      if (combo.hitsDone <= 0) {
        this.combos.delete(sessionId);
        continue;
      }
      const def = ABILITIES[combo.abilityId];
      if (!def) {
        this.combos.delete(sessionId);
        continue;
      }
      const cooldownMs = this.startCooldown(sessionId, def.id, now);
      this.combos.delete(sessionId);
      const player = this.room.state.players.get(sessionId);
      if (player) {
        this.phaseFx(sessionId, player, def.id, "idle", now, { cooldownMs });
      }
    }
  }

  private enterPhase(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    phase: CastPhaseId,
    now: number,
    castStartedAt: number,
    fxExtra?: {
      cooldownMs?: number;
      comboHit?: number;
      moveX?: number;
      moveZ?: number;
      aimX?: number;
      aimZ?: number;
      /** Override phase length (Fireball early-throw recovery). */
      durationMs?: number;
    },
  ) {
    let duration = Math.max(
      16,
      fxExtra?.durationMs ?? phaseDurationMs(def, phase),
    );
    if ((phase === "anticipation" || phase === "cast") && fxExtra?.durationMs == null) {
      const antMul = this.statuses.getAnticipationMul(sessionId);
      if (antMul !== 1) {
        duration = Math.max(16, duration * antMul);
      }
    }

    const prev = this.casts.get(sessionId);
    const cast: ActiveCast = {
      abilityId: def.id,
      phase,
      phaseEndsAt: now + duration,
      castStartedAt,
      channelAnchorAt: prev?.channelAnchorAt,
      yaw: prev?.yaw ?? player.yaw,
      effectFired: prev?.effectFired ?? false,
      moveX: fxExtra?.moveX ?? prev?.moveX ?? 0,
      moveZ: fxExtra?.moveZ ?? prev?.moveZ ?? 0,
      aimX: fxExtra?.aimX ?? prev?.aimX,
      aimZ: fxExtra?.aimZ ?? prev?.aimZ,
      originX: prev?.originX ?? player.x,
      originZ: prev?.originZ ?? player.z,
      fireballCharge01: prev?.fireballCharge01,
      fireballLaunchAt: prev?.fireballLaunchAt,
    };
    this.casts.set(sessionId, cast);

    if (phase === "impact" && def.confirmOnRelease && cast.channelAnchorAt == null) {
      cast.channelAnchorAt = now;
    }

    player.castAbilityId = def.id;
    player.castPhase = phase;
    player.castPhaseEndsAt = cast.phaseEndsAt;
    if (phase === "anticipation" || (castStartedAt === now && phase !== "recovery")) {
      player.castLockUntil = now + totalCastDurationMs(def);
    }

    const magmaMeet =
      def.id === "magmaOrbs"
        ? resolveMagmaOrbsMeetRange(
            { x: player.x, z: player.z },
            cast.aimX != null && cast.aimZ != null
              ? { x: cast.aimX, z: cast.aimZ }
              : null,
          )
        : undefined;
    let magmaCollide: { x: number; z: number } | undefined;
    if (magmaMeet != null) {
      cast.magmaMeetRange = magmaMeet;
      cast.magmaMeetYaw = cast.yaw ?? player.yaw;
      magmaCollide = pointInFront(
        { x: player.x, z: player.z },
        cast.magmaMeetYaw,
        magmaMeet,
      );
    }
    this.phaseFx(sessionId, player, def.id, phase, cast.phaseEndsAt, {
      ...fxExtra,
      comboHit: player.castComboHit || fxExtra?.comboHit,
      // Cursor-clamped meet range + collide xz so observers track live aim.
      radius: magmaMeet,
      x2: magmaCollide?.x,
      z2: magmaCollide?.z,
      yaw: magmaMeet != null ? cast.magmaMeetYaw : undefined,
    });
  }

  private clearCastState(
    sessionId: string,
    player: PlayerState,
    opts?: { /** Frost Mist multi-tick: end cast pose but keep Counter/Revenge window. */ keepStanceArmed?: boolean },
  ) {
    const cast = this.casts.get(sessionId);
    if (!opts?.keepStanceArmed) {
      if (cast?.abilityId === "counter") {
        this.statuses.remove(sessionId, "counterArmed");
        this.counterMistRiposted.delete(sessionId);
      }
      if (cast?.abilityId === "revenge") {
        this.statuses.remove(sessionId, "revengeArmed");
        this.revengeMistBlinked.delete(sessionId);
      }
    }
    if (cast?.abilityId === "handShield") {
      this.statuses.remove(sessionId, "handShielding");
    }
    this.casts.delete(sessionId);
    // Space charge leaps (Bulwark / Verdant / Predator / Rebound recoil) outlive the
    // cast phases — do not cancel their travel when recovery ends.
    const liveTravel = this.travels.get(sessionId);
    if (!liveTravel?.spaceArrive && liveTravel?.abilityId !== "rebound") {
      this.travels.delete(sessionId);
    }
    player.castAbilityId = "";
    player.castPhase = "";
    player.castPhaseEndsAt = 0;
    player.castLockUntil = 0;
    player.castComboHit = 0;
    player.invulnerable = false;
  }

  /** Stamp 1-based swing index for combo abilities (anim / VFX sync). */
  private beginComboHitIndex(sessionId: string, player: PlayerState, def: AbilityDef) {
    if (!isComboAbility(def)) {
      player.castComboHit = 0;
      return;
    }
    const combo = this.combos.get(sessionId);
    const done = combo?.abilityId === def.id ? combo.hitsDone : 0;
    player.castComboHit = done + 1;
  }

  /**
   * Bespoke effectKind → schedule/commit. Add new kinds here (one entry) instead
   * of extending the old fireEffect if/else ladder.
   */
  private _effectKindFireHandlers: EffectKindFireHandlers | null = null;
  private effectKindFireHandlers(): EffectKindFireHandlers {
    if (this._effectKindFireHandlers) return this._effectKindFireHandlers;
    this._effectKindFireHandlers = {
      spikeWave: (a) => this.scheduleSpikeWave(a.sessionId, a.ownerBody, a.def, a.now),
      silenceSweep: (a) =>
        this.scheduleSilenceSweep(a.sessionId, a.ownerBody, a.def, a.now),
      firewall: (a) => this.scheduleFirewall(a.sessionId, a.ownerBody, a.def, a.now),
      poisonCloud: (a) =>
        this.schedulePoisonCloud(a.sessionId, a.ownerBody, a.def, a.now),
      smokeBomb: (a) => this.scheduleSmokeBomb(a.sessionId, a.ownerBody, a.def, a.now),
      holyGround: (a) =>
        this.scheduleHolyGround(a.sessionId, a.ownerBody, a.def, a.now),
      slipstream: (a) =>
        this.scheduleSlipstream(a.sessionId, a.ownerBody, a.def, a.now),
      riftFissure: (a) =>
        this.scheduleRiftFissure(a.sessionId, a.ownerBody, a.def, a.now),
      volcano: (a) => this.scheduleVolcano(a.sessionId, a.ownerBody, a.def, a.now),
      protectionBubble: (a) =>
        this.scheduleProtectionBubble(a.sessionId, a.ownerBody, a.def, a.now),
      shrooms: (a) => this.armShrooms(a.sessionId, a.now),
      spiritForm: (a) =>
        this.commitSpiritForm(a.sessionId, a.player, a.def, a.now),
      orbitingWisp: (a) =>
        this.commitOrbitingWisp(a.sessionId, a.player, a.def, a.now),
      magmaOrbs: (a) => this.scheduleMagmaOrbs(a.sessionId, a.ownerBody, a.def, a.now),
      coneChannel: (a) => this.scheduleFrostMist(a.sessionId, a.def, a.now),
      healBeam: (a) => this.scheduleHealBeam(a.sessionId, a.def, a.now),
      lifeLeech: (a) => this.scheduleLifeLeech(a.sessionId, a.def, a.now),
      arcThread: (a) => this.scheduleArcThread(a.sessionId, a.player, a.def, a.now),
      soulRelay: (a) => {
        this.lastFireCommitted = this.fireSoulRelay(
          a.sessionId,
          a.player,
          a.def,
          a.now,
        );
      },
      pulseHeal: (a) => {
        const center = { x: a.player.x, z: a.player.z };
        const radius = a.def.radius ?? 7;
        this.fx({
          kind: "aoe",
          abilityId: a.def.id,
          x: center.x,
          z: center.z,
          radius,
          ownerId: a.sessionId,
        });
        this.scheduleGrooveHeal(a.sessionId, a.def, a.now);
      },
      arcBlade: (a) => this.scheduleArcBlade(a.sessionId, a.player, a.def, a.now),
      verdantLeap: (a) => this.commitVerdantLeap(a.sessionId, a.player, a.def, a.now),
      bulwarkCharge: (a) => this.commitBulwarkCharge(a.sessionId, a.player, a.def, a.now),
      predatorStep: (a) => this.commitPredatorStep(a.sessionId, a.player, a.def, a.now),
      rebound: (a) => this.commitRebound(a.sessionId, a.player, a.def, a.now),
      teleportSlam: (a) => this.commitTeleportSlam(a.sessionId, a.player, a.def, a.now),
    };
    return this._effectKindFireHandlers;
  }

  private fireEffect(sessionId: string, player: PlayerState, def: AbilityDef, now: number): boolean {
    this.lastFireCommitted = true;
    const ownerBody = this.playerBody(sessionId, player);
    const travel = resolveTravel(def);
    const deferHit = travel.mode === "translate" && travel.effectOnArrive === true;
    const kind = abilityEffectKind(def);

    // Travel can attach to any shape (dash default; leap slam, charges, etc.)
    let travelLanding: Vec2 | null = null;
    if (travel.mode === "instant") {
      const dist = travelDistance(def);
      const off = dashOffset(player.yaw, dist);
      const from = { x: player.x, z: player.z };
      const clamped = this.sweepPlayerPos(sessionId, from, {
        x: player.x + off.x,
        z: player.z + off.z,
      });
      player.x = clamped.x;
      player.z = clamped.z;
      travelLanding = clamped;
    } else if (travel.mode === "translate") {
      const dist = travelDistance(def);
      const dur = travelDurationMs(def);
      const from = { x: player.x, z: player.z };
      const ideal = sampleTravel(from, player.yaw, dist, 1);
      const clamped = this.sweepPlayerPos(sessionId, from, ideal);
      const actualDist = length2(clamped.x - from.x, clamped.z - from.z);
      // Shorten range (and duration) when a wall/solid cuts the path.
      const scale = dist > 1e-6 ? Math.min(1, actualDist / dist) : 0;
      const travelDist = dist * scale;
      const travelDur = Math.max(16, dur * Math.max(0.05, scale));
      const takeoffDelay = travelTakeoffDelayMs(def);
      travelLanding = clamped;
      this.travels.set(sessionId, {
        abilityId: def.id,
        fromX: player.x,
        fromZ: player.z,
        yaw: player.yaw,
        distance: travelDist,
        startAt: now + takeoffDelay,
        endAt: now + takeoffDelay + travelDur,
        pendingLandingEffect: deferHit && (def.shape === "aoe" || def.shape === "melee"),
        lastX: player.x,
        lastZ: player.z,
        pathHitIds: travel.hitAlongPath ? new Set() : undefined,
      });
      if (travel.hitAlongPath) {
        this.fx({
          kind: "dash",
          abilityId: def.id,
          x: player.x,
          z: player.z,
          yaw: player.yaw,
          ownerId: sessionId,
        });
      }
    }

    if (kind === "decoy") {
      // Clone + cloak already committed at cast begin (see commitDecoyCast).
      return this.lastFireCommitted;
    }

    const fireArgs: EffectKindFireArgs = {
      sessionId,
      player,
      ownerBody,
      def,
      now,
    };
    const bespoke = runEffectKindFire(
      kind,
      deferHit,
      this.effectKindFireHandlers(),
      fireArgs,
    );

    if (bespoke) {
      // Bespoke effectKind owns the fire path (or defers to travel landing).
    } else if (def.shape === "projectile") {
      if (this.sims.size < COMBAT.maxProjectiles) {
        const id = `p_${this.nextId++}`;
        const isReturning = abilityEffectKind(def) === "returningProjectile";
        const isRunic = abilityEffectKind(def) === "runicShard";
        if (
          isReturning &&
          this.activeProjectileCount(sessionId, def.id) >=
            (def.returningProjectile?.maxActivePerCaster ?? 1)
        ) {
          return this.lastFireCommitted;
        }
        if (
          isRunic &&
          this.hasRunicShardVolley(sessionId)
        ) {
          return this.lastFireCommitted;
        }
        const sim = isReturning
          ? createReturningProjectile(id, ownerBody, def)
          : createProjectile(id, ownerBody, def);
        if (sim) {
          if (abilityEffectKind(def) === "fireball") {
            const live = this.casts.get(sessionId);
            this.stampFireballProjectile(sim, live?.fireballCharge01 ?? 1);
          } else {
            this.applyTalentProjectileRadii(sessionId, sim);
          }
          if (isRunic) {
            sim.shatterChargesRemaining = def.runicShard?.shatterCharges ?? 2;
            // Hold-LMB must not shatter on the same press that threw the shard.
            sim.shatterReadyAt = now + (def.runicShard?.shatterArmingMs ?? 320);
          }
          this.stampProjectileBubblePass(sim, now);
          this.sims.set(id, sim);
          if (abilityEffectKind(def) === "bloomingPath") {
            this.beginBloomingPathZone(id, sim, def, now);
          }
          const st = new ProjectileState();
          st.id = id;
          st.ownerSessionId = sessionId;
          st.abilityId = def.id;
          st.x = sim.x;
          st.z = sim.z;
          st.vx = sim.vx;
          st.vz = sim.vz;
          st.radius = sim.hitRadius;
          st.slowRadius = sim.slowRadius;
          st.mode = sim.mode;
          st.stuckTargetId = sim.stuckTargetId ?? "";
          this.room.state.projectiles.set(id, st);
        }
      }
    } else if (def.shape === "melee" && !deferHit) {
      const center = travelLanding ?? meleeCenter(ownerBody, def);
      const radius = def.radius ?? def.range;
      const combo = this.combos.get(sessionId);
      const comboHit =
        isComboAbility(def) && (!combo || combo.abilityId === def.id)
          ? (combo?.hitsDone ?? 0) + 1
          : undefined;
      this.fx({
        kind: "melee",
        abilityId: def.id,
        x: center.x,
        z: center.z,
        radius,
        ownerId: sessionId,
        comboHit,
      });
      const meleeDmg =
        comboHit != null ? abilityComboHitDamage(def, comboHit) : def.damage;
      this.applyInstant(center, radius, meleeDmg, sessionId, def.id, now);
    } else if (def.shape === "aoe" && !deferHit) {
      let center = travelLanding ?? { x: player.x, z: player.z };
      // Ground-targeted AoE (range > 0): place at clamped aim, not at feet.
      if (!travelLanding && def.range > 0) {
        const cast = this.casts.get(sessionId);
        const aim =
          cast?.aimX != null && cast?.aimZ != null
            ? { x: cast.aimX, z: cast.aimZ }
            : undefined;
        const aimed = clampGroundAim(
          { x: player.x, z: player.z, yaw: cast?.yaw ?? player.yaw },
          aim,
          def.range,
        );
        center = clampTargetBeforeWalls(
          { x: player.x, z: player.z },
          aimed,
          0.35,
          this.wallColliders,
          this.circleColliders,
          this.boxColliders,
        );
      }
      const radius = this.talentRadius(sessionId, def.id, def.radius ?? 3);
      this.fx({
        kind: "aoe",
        abilityId: def.id,
        x: center.x,
        z: center.z,
        radius,
        ownerId: sessionId,
      });
      const delayMs = Math.max(0, def.delayedImpactMs ?? 0);
      if (delayMs > 0) {
        // Place telegraph only — damage resolves later (Crushing Sigil, etc.).
        this.pendingDelayedAoes.push({
          explodeAt: now + delayMs,
          x: center.x,
          z: center.z,
          radius,
          damage: def.damage,
          ownerId: sessionId,
          abilityId: def.id,
        });
      } else {
        this.applyInstant(center, radius, def.damage, sessionId, def.id, now);
      }
    }
    // dash / buff / deferred landing: travel-only here (+ optional self statuses)

    if (!this.lastFireCommitted) {
      return false;
    }

    if (def.id === "barrier") {
      this.finalizeBarrierCast(sessionId, now);
    } else if (def.id === "handShield") {
      this.statuses.apply(sessionId, "handShielding", sessionId, now, {
        durationMs: HAND_SHIELD_ARMED_MS,
      });
    } else {
      this.statuses.applyApplications(sessionId, def.applyOnSelf, sessionId, now);
    }

    this.tryProcProtectiveInstinct(sessionId, player, def.id, now);
    this.tryAdvanceFifthCadence(sessionId, def.id, now);
    return true;
  }

  /**
   * Start Barrier absorb at cast begin and ramp stacks through windup.
   * Mid-cast damage only consumes what has been granted so far.
   */
  private commitBarrierCast(sessionId: string, def: AbilityDef, now: number) {
    const windup =
      phaseDurationMs(def, "anticipation") + phaseDurationMs(def, "cast");
    const impactAt = now + Math.max(16, windup);
    const target = BARRIER_CAST.shieldStacks;
    const durationMs = BARRIER_CAST.shieldDurationMs;
    this.pendingBarrier.set(sessionId, {
      ownerId: sessionId,
      castStartedAt: now,
      impactAt,
      granted: 0,
      target,
      durationMs,
      finalized: false,
    });
    this.advancePendingBarrier(now);
  }

  private finalizeBarrierCast(sessionId: string, now: number) {
    const pending = this.pendingBarrier.get(sessionId);
    if (!pending || pending.finalized) return;
    this.grantBarrierProgress(pending, 1, now);
    this.statuses.apply(sessionId, "barrier", sessionId, now, {
      durationMs: pending.durationMs,
      stacks: this.statuses.getStacks(sessionId, "barrier"),
      setStacks: true,
    });
    pending.finalized = true;
    this.pendingBarrier.delete(sessionId);
  }

  /** Root + glow for the full counter window (1.2s from cast start). */
  private commitCounterCast(sessionId: string, now: number) {
    this.counterMistRiposted.delete(sessionId);
    this.statuses.apply(sessionId, "counterArmed", sessionId, now, {
      durationMs: 1200,
    });
  }

  /** Root + red glow for the Revenge window (1.2s from cast start). */
  private commitRevengeCast(sessionId: string, now: number) {
    this.revengeMistBlinked.delete(sessionId);
    this.statuses.apply(sessionId, "revengeArmed", sessionId, now, {
      durationMs: 1200,
    });
  }

  private grantBarrierProgress(pending: PendingBarrier, progress01: number, now: number) {
    const p = Math.max(0, Math.min(1, progress01));
    const want = Math.floor(pending.target * p + 1e-6);
    const add = want - pending.granted;
    if (add <= 0) return;
    const current = this.statuses.getStacks(pending.ownerId, "barrier");
    this.statuses.apply(pending.ownerId, "barrier", pending.ownerId, now, {
      durationMs: Math.max(pending.durationMs, pending.impactAt - now + pending.durationMs),
      stacks: current + add,
      setStacks: true,
    });
    pending.granted = want;
  }

  private advancePendingBarrier(now: number) {
    if (this.pendingBarrier.size === 0) return;
    for (const [sessionId, pending] of [...this.pendingBarrier.entries()]) {
      if (pending.finalized) {
        this.pendingBarrier.delete(sessionId);
        continue;
      }
      const cast = this.casts.get(sessionId);
      if (!cast || cast.abilityId !== "barrier") {
        // Cast cleared unexpectedly — keep whatever shield was built.
        this.statuses.apply(sessionId, "barrier", sessionId, now, {
          durationMs: pending.durationMs,
          stacks: this.statuses.getStacks(sessionId, "barrier"),
          setStacks: true,
        });
        this.pendingBarrier.delete(sessionId);
        continue;
      }
      const span = Math.max(1, pending.impactAt - pending.castStartedAt);
      const progress = Math.max(0, Math.min(1, (now - pending.castStartedAt) / span));
      this.grantBarrierProgress(pending, progress, now);
    }
  }

  /**
   * Spawn the drifting clone and apply cloak on cast start — before crouch anim —
   * so observers see the decoy first and miss that a spell was cast.
   */
  private commitDecoyCast(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    if (!cast || cast.effectFired) return;
    this.spawnDecoy(sessionId, player, now);
    this.statuses.applyApplications(sessionId, def.applyOnSelf, sessionId, now);
    const cooldownMs = this.onEffectResolved(sessionId, def, now);
    cast.effectFired = true;
    if (cooldownMs != null) {
      this.phaseFx(sessionId, player, def.id, cast.phase, cast.phaseEndsAt, {
        cooldownMs,
      });
    }
  }

  private spawnDecoy(sessionId: string, player: PlayerState, now: number) {
    this.clearOwnedDecoys(sessionId);
    const cast = this.casts.get(sessionId);
    const aimX = cast?.aimX;
    const aimZ = cast?.aimZ;
    const hasAim =
      aimX != null &&
      aimZ != null &&
      Number.isFinite(aimX) &&
      Number.isFinite(aimZ);
    const targetX = hasAim ? aimX : player.x;
    const targetZ = hasAim ? aimZ : player.z;
    const toAim = normalize2(targetX - player.x, targetZ - player.z);
    const dist = Math.hypot(targetX - player.x, targetZ - player.z);
    const drifting = dist > DECOY_ARRIVE_M && length2(toAim.x, toAim.z) > 1e-4;
    const id = `decoy_${this.nextId++}`;
    const d = new DecoyState();
    d.id = id;
    d.ownerSessionId = sessionId;
    d.x = player.x;
    d.z = player.z;
    d.yaw = player.yaw;
    d.targetX = targetX;
    d.targetZ = targetZ;
    d.vx = drifting ? toAim.x * DECOY_SPEED : 0;
    d.vz = drifting ? toAim.z * DECOY_SPEED : 0;
    d.color = player.color || STARTER_COLORS[0]!;
    d.pattern = player.pattern || DEFAULT_COSMETIC_PATTERN;
    d.patternColor = player.patternColor || DEFAULT_COSMETIC_PATTERN_COLOR;
    d.maxHp = Math.max(1, player.maxHp || 100);
    d.hp = Math.max(1, Math.min(d.maxHp, player.hp > 0 ? player.hp : d.maxHp));
    d.expiresAt = now + DECOY_LIFE_MS;
    this.room.state.decoys.set(id, d);
  }

  private advanceDecoys(dt: number, now: number) {
    const expired: string[] = [];
    this.room.state.decoys.forEach((d, id) => {
      if (now >= d.expiresAt || !this.statuses.has(d.ownerSessionId, "cloaked")) {
        expired.push(id);
        return;
      }
      if (Math.abs(d.vx) < 1e-6 && Math.abs(d.vz) < 1e-6) return;
      const toTarget = Math.hypot(d.targetX - d.x, d.targetZ - d.z);
      if (toTarget <= DECOY_ARRIVE_M) {
        d.vx = 0;
        d.vz = 0;
        return;
      }
      const from = { x: d.x, z: d.z };
      const step = Math.min(DECOY_SPEED * dt, Math.max(0, toTarget - DECOY_ARRIVE_M));
      const dir = normalize2(d.targetX - d.x, d.targetZ - d.z);
      const desired = { x: d.x + dir.x * step, z: d.z + dir.z * step };
      const next = sweepTravel(from, desired, COLLISION.playerRadius, this.staticColliders);
      // Stop if a wall fully blocked the step.
      if (length2(next.x - from.x, next.z - from.z) < 1e-5) {
        d.vx = 0;
        d.vz = 0;
      } else {
        d.x = next.x;
        d.z = next.z;
        d.vx = dir.x * DECOY_SPEED;
        d.vz = dir.z * DECOY_SPEED;
        if (Math.hypot(d.targetX - d.x, d.targetZ - d.z) <= DECOY_ARRIVE_M) {
          d.vx = 0;
          d.vz = 0;
        }
        // Keep release-time facing — do not turn into the walk direction.
      }
    });
    for (const id of expired) this.room.state.decoys.delete(id);
  }

  /** Melee/AoE resolve when `travel.effectOnArrive` lands. */
  private resolveLandingEffect(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
  ) {
    const ownerBody = this.playerBody(sessionId, player);
    if (def.shape === "melee") {
      const center = meleeCenter(ownerBody, def);
      const radius = def.radius ?? def.range;
      const combo = this.combos.get(sessionId);
      const comboHit =
        isComboAbility(def) && (!combo || combo.abilityId === def.id)
          ? (combo?.hitsDone ?? 0) + 1
          : undefined;
      this.fx({
        kind: "melee",
        abilityId: def.id,
        x: center.x,
        z: center.z,
        radius,
        ownerId: sessionId,
        comboHit,
      });
      const meleeDmg =
        comboHit != null ? abilityComboHitDamage(def, comboHit) : def.damage;
      this.applyInstant(center, radius, meleeDmg, sessionId, def.id, now);
      return;
    }
    if (def.shape === "aoe") {
      // Jump Slam: hands hit the ground in front of the caster.
      const slamReach = def.id === "smash" ? 1.05 : 0;
      const yaw = this.casts.get(sessionId)?.yaw ?? player.yaw;
      const center =
        slamReach > 0
          ? pointInFront(ownerBody, yaw, slamReach)
          : { x: player.x, z: player.z };
      const radius = def.radius ?? 3;
      this.fx({
        kind: "aoe",
        abilityId: def.id,
        x: center.x,
        z: center.z,
        radius,
        ownerId: sessionId,
      });
      this.applyInstant(center, radius, def.damage, sessionId, def.id, now);
    }
  }

  private scheduleSpikeWave(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
  ) {
    const pts = spikeLinePoints(ownerBody, def);
    const stagger = Math.max(16, def.spikeStaggerMs ?? 32);
    const radius = this.talentRadius(sessionId, def.id, def.radius ?? 0.55);
    const hitIds = new Set<string>();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      this.pendingSpikes.push({
        fireAt: now + i * stagger,
        x: p.x,
        z: p.z,
        radius,
        damage: def.damage,
        ownerId: sessionId,
        abilityId: def.id,
        hitIds,
      });
    }
  }

  private scheduleArcBlade(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
  ) {
    const radius = this.talentRadius(
      sessionId,
      def.id,
      def.radius ?? ARC_BLADE_CAST.radius,
    );
    const hits = Math.max(1, def.hitCount ?? ARC_BLADE_CAST.hitCount);
    const interval = Math.max(16, def.hitIntervalMs ?? ARC_BLADE_CAST.hitIntervalMs);
    // Bridged cast owns the sweep VFX; fire-time AoE is ignored client-side.
    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: player.x,
      z: player.z,
      radius,
      ownerId: sessionId,
    });
    this.applyInstant(
      { x: player.x, z: player.z },
      radius,
      arcBladeHitDamage(0),
      sessionId,
      def.id,
      now,
    );
    for (let i = 1; i < hits; i++) {
      this.pendingArcBladeHits.push({
        fireAt: now + i * interval,
        ownerId: sessionId,
        abilityId: def.id,
        radius,
        hitIndex: i,
      });
    }
  }

  private scheduleSilenceSweep(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
  ) {
    const sweepMs = Math.max(120, def.sweepMs ?? 280);
    const coneHalf = def.coneHalfAngle ?? 0.85;
    const bladeHalf = def.sweepBladeHalfAngle ?? 0.22;
    const range = def.range;
    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: ownerBody.x,
      z: ownerBody.z,
      radius: range,
      yaw: ownerBody.yaw,
      ownerId: sessionId,
    });
    this.pendingSilenceSweeps.push({
      ownerId: sessionId,
      abilityId: def.id,
      x: ownerBody.x,
      z: ownerBody.z,
      yaw: ownerBody.yaw,
      range,
      coneHalfAngle: coneHalf,
      bladeHalfAngle: bladeHalf,
      startAt: now,
      expiresAt: now + sweepMs,
      hitIds: new Set(),
    });
  }

  private scheduleFirewall(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
  ) {
    const wall = firewallWallPoints(ownerBody, def);
    const durationMs = Math.max(800, def.zoneDurationMs ?? 4500);
    const tickMs = Math.max(120, def.tickMs ?? 400);
    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: wall.mid.x,
      z: wall.mid.z,
      radius: wall.halfLength,
      yaw: wall.yaw,
      ownerId: sessionId,
    });
    this.pendingFirewalls.push({
      ownerId: sessionId,
      abilityId: def.id,
      points: wall.points,
      radius: this.talentRadius(sessionId, def.id, def.radius ?? 0.9),
      damage: def.damage,
      nextTickAt: now,
      expiresAt: now + durationMs,
      tickMs,
    });
  }

  private advancePendingFirewalls(now: number) {
    if (this.pendingFirewalls.length === 0) return;
    const remain: PendingFirewall[] = [];
    const bodies = this.collectBodies();
    for (const zone of this.pendingFirewalls) {
      if (now >= zone.expiresAt) continue;
      while (zone.nextTickAt <= now && zone.nextTickAt < zone.expiresAt) {
        const hitIds = new Set<string>();
        for (const p of zone.points) {
          const hits = resolveInstantHits(
            p,
            zone.radius,
            zone.damage,
            zone.ownerId,
            bodies,
            (o, t) => this.canHurt(o, t),
          );
          for (const hit of hits) {
            if (hitIds.has(hit.targetId)) continue;
            hitIds.add(hit.targetId);
            this.applyDamage(hit.targetId, hit.damage, zone.ownerId, zone.abilityId, now, {
              directSpell: false,
            });
          }
        }
        zone.nextTickAt += zone.tickMs;
      }
      if (now < zone.expiresAt) remain.push(zone);
    }
    this.pendingFirewalls = remain;
  }

  private schedulePoisonCloud(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    const aim =
      cast?.aimX != null && cast?.aimZ != null
        ? { x: cast.aimX, z: cast.aimZ }
        : undefined;
    const range = def.range > 0 ? def.range : POISON_CLOUD_CAST.range;
    const aimed = clampGroundAim(ownerBody, aim, range);
    const pos = clampTargetBeforeWalls(
      { x: ownerBody.x, z: ownerBody.z },
      aimed,
      0.35,
      this.wallColliders,
      this.circleColliders,
      this.boxColliders,
    );
    const radius = this.talentRadius(
      sessionId,
      def.id,
      Math.max(0.8, def.radius ?? POISON_CLOUD_CAST.radius),
    );
    const durationMs = Math.max(800, def.zoneDurationMs ?? POISON_CLOUD_CAST.zoneDurationMs);
    const tickMs = Math.max(120, def.tickMs ?? POISON_CLOUD_CAST.tickMs);

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: pos.x,
      z: pos.z,
      x2: ownerBody.x,
      z2: ownerBody.z,
      radius,
      yaw: cast?.yaw ?? ownerBody.yaw,
      ownerId: sessionId,
    });

    this.pendingPoisonClouds.push({
      ownerId: sessionId,
      abilityId: def.id,
      x: pos.x,
      z: pos.z,
      radius,
      nextTickAt: now,
      expiresAt: now + durationMs,
      tickMs,
    });
  }

  /** Self-centered grey smoke + cloak at release (frame 28). Reuses poison-cloud tick loop. */
  private scheduleSmokeBomb(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    const pos = { x: ownerBody.x, z: ownerBody.z };
    const radius = Math.max(1.2, def.radius ?? SMOKE_BOMB_CAST.radius);
    const durationMs = Math.max(800, def.zoneDurationMs ?? SMOKE_BOMB_CAST.zoneDurationMs);
    const tickMs = Math.max(120, def.tickMs ?? SMOKE_BOMB_CAST.tickMs);

    this.statuses.applyApplications(
      sessionId,
      [{ statusId: "cloaked", durationMs, chance: 1 }],
      sessionId,
      now,
    );

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: pos.x,
      z: pos.z,
      x2: pos.x,
      z2: pos.z,
      radius,
      yaw: cast?.yaw ?? ownerBody.yaw,
      ownerId: sessionId,
    });

    this.pendingPoisonClouds.push({
      ownerId: sessionId,
      abilityId: def.id,
      x: pos.x,
      z: pos.z,
      radius,
      nextTickAt: now,
      expiresAt: now + durationMs,
      tickMs,
    });
  }

  private advancePendingPoisonClouds(now: number) {
    if (this.pendingPoisonClouds.length === 0) return;
    const remain: PendingPoisonCloud[] = [];
    const bodies = this.collectBodies();
    for (const zone of this.pendingPoisonClouds) {
      const isSmoke = abilityEffectKind(ABILITIES[zone.abilityId]) === "smokeBomb";
      if (now >= zone.expiresAt) {
        if (isSmoke) this.revealCloak(zone.ownerId);
        continue;
      }
      const def = ABILITIES[zone.abilityId];
      while (zone.nextTickAt <= now && zone.nextTickAt < zone.expiresAt) {
        for (const body of bodies) {
          if (!this.canHurt(zone.ownerId, body.id)) continue;
          if (body.vulnerable === false) continue;
          if (body.hp <= 0) continue;
          if (
            !circlesOverlap(
              zone.x,
              zone.z,
              zone.radius,
              body.x,
              body.z,
              hitRadiusOf(body),
            )
          ) {
            continue;
          }
          this.applyOutgoingStatusApps(
            body.id,
            def?.applyOnHit ?? [
              { statusId: "poisoned", chance: 1 },
              { statusId: "poisonMiasma", chance: 1 },
            ],
            zone.ownerId,
            now,
          );
        }
        zone.nextTickAt += zone.tickMs;
      }

      // Smoke Bomb: cloak lasts only while the caster stays inside the live cloud.
      if (isSmoke) {
        const owner = bodies.find((b) => b.id === zone.ownerId);
        const inCloud =
          owner != null &&
          owner.hp > 0 &&
          circlesOverlap(
            zone.x,
            zone.z,
            zone.radius,
            owner.x,
            owner.z,
            COMBAT.playerHitRadius,
          );
        if (inCloud) {
          const remainMs = Math.max(120, zone.expiresAt - now);
          this.statuses.applyApplications(
            zone.ownerId,
            [{ statusId: "cloaked", durationMs: remainMs, chance: 1 }],
            zone.ownerId,
            now,
          );
        } else {
          this.revealCloak(zone.ownerId);
        }
      }

      if (now < zone.expiresAt) remain.push(zone);
    }
    this.pendingPoisonClouds = remain;
  }

  /** Self-centered holy circle — ally buff while standing inside. */
  private scheduleHolyGround(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    const pos = { x: ownerBody.x, z: ownerBody.z };
    const radius = Math.max(1.2, def.radius ?? HOLY_GROUND_CAST.radius);
    const durationMs = Math.max(800, def.zoneDurationMs ?? HOLY_GROUND_CAST.zoneDurationMs);

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: pos.x,
      z: pos.z,
      x2: pos.x,
      z2: pos.z,
      radius,
      yaw: cast?.yaw ?? ownerBody.yaw,
      ownerId: sessionId,
    });

    this.pendingHolyGrounds.push({
      ownerId: sessionId,
      abilityId: def.id,
      x: pos.x,
      z: pos.z,
      radius,
      expiresAt: now + durationMs,
    });
  }

  private advancePendingHolyGrounds(now: number) {
    if (this.pendingHolyGrounds.length === 0 && this.holyBlessedBodyIds.size === 0) {
      return;
    }
    const bodies = this.collectBodies();
    const remain: PendingHolyGround[] = [];
    const blessed = new Set<string>();

    for (const zone of this.pendingHolyGrounds) {
      if (now >= zone.expiresAt) continue;
      const remainMs = Math.max(180, zone.expiresAt - now);
      for (const body of bodies) {
        if (body.hp <= 0) continue;
        if (!this.canHealTarget(zone.ownerId, body.id, { allowSelf: true })) continue;
        if (
          !circlesOverlap(
            zone.x,
            zone.z,
            zone.radius,
            body.x,
            body.z,
            hitRadiusOf(body),
          )
        ) {
          continue;
        }
        blessed.add(body.id);
        this.statuses.applyApplications(
          body.id,
          [{ statusId: "holyBlessed", durationMs: remainMs, chance: 1 }],
          zone.ownerId,
          now,
        );
      }
      remain.push(zone);
    }

    for (const id of this.holyBlessedBodyIds) {
      if (blessed.has(id)) continue;
      this.statuses.remove(id, "holyBlessed");
    }
    this.holyBlessedBodyIds = blessed;
    this.pendingHolyGrounds = remain;
  }

  /** Directional wind lane from caster toward aim — haste inside, Tailwind on exit. */
  private scheduleSlipstream(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    const yaw = cast?.yaw ?? ownerBody.yaw;
    const length = Math.max(1, SLIPSTREAM_CAST.length);
    const halfWidth = Math.max(
      0.25,
      def.radius ?? SLIPSTREAM_CAST.halfWidth,
    );
    const durationMs = Math.max(
      800,
      def.zoneDurationMs ?? SLIPSTREAM_CAST.zoneDurationMs,
    );
    const origin = { x: ownerBody.x, z: ownerBody.z };
    const lane = slipstreamLaneFromCast(origin, yaw, length, halfWidth);

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: lane.origin.x,
      z: lane.origin.z,
      x2: lane.end.x,
      z2: lane.end.z,
      radius: halfWidth,
      yaw,
      ownerId: sessionId,
    });

    this.pendingSlipstreams.push({
      ownerId: sessionId,
      abilityId: def.id,
      originX: lane.origin.x,
      originZ: lane.origin.z,
      yaw,
      length: lane.length,
      halfWidth: lane.halfWidth,
      expiresAt: now + durationMs,
      insideAccumMs: 0,
      wasInside: false,
      hasGrantedTailwind: false,
    });
  }

  private grantSlipstreamTailwind(
    zone: PendingSlipstream,
    playerX: number,
    playerZ: number,
    now: number,
  ) {
    if (zone.hasGrantedTailwind) return;
    if (zone.insideAccumMs < SLIPSTREAM_CAST.qualifyMs) return;
    zone.hasGrantedTailwind = true;
    this.statuses.applyApplications(
      zone.ownerId,
      [
        {
          statusId: "slipstreamHaste",
          durationMs: 3000,
          chance: 1,
        },
      ],
      zone.ownerId,
      now,
    );
    this.fx({
      kind: "aoe",
      abilityId: "slipstream",
      x: playerX,
      z: playerZ,
      y: 1.05,
      ownerId: zone.ownerId,
      variant: 1,
    });
  }

  private advancePendingSlipstreams(dt: number, now: number) {
    if (this.pendingSlipstreams.length === 0 && this.slipstreamHasteBodyIds.size === 0) {
      return;
    }
    const remain: PendingSlipstream[] = [];
    const hasted = new Set<string>();
    const dtMs = Math.max(0, dt * 1000);

    for (const zone of this.pendingSlipstreams) {
      const expired = now >= zone.expiresAt;
      const owner = this.room.state.players.get(zone.ownerId);
      const alive =
        owner && !owner.disconnected && typeof owner.hp === "number" && owner.hp > 0;

      if (!alive) {
        if (this.statuses.has(zone.ownerId, "slipstreamHaste")) {
          this.statuses.remove(zone.ownerId, "slipstreamHaste");
        }
        continue;
      }

      const inLane = pointInSlipstreamLane(
        {
          originX: zone.originX,
          originZ: zone.originZ,
          yaw: zone.yaw,
          length: zone.length,
          halfWidth: zone.halfWidth,
        },
        { x: owner.x, z: owner.z },
      );
      const inside = !expired && inLane;

      if (inside) {
        zone.insideAccumMs += dtMs;
        zone.wasInside = true;
        hasted.add(zone.ownerId);
        // Only refresh the short 600ms haste if we haven't already granted the full 3s version
        if (!zone.hasGrantedTailwind) {
          this.statuses.applyApplications(
            zone.ownerId,
            [{ statusId: "slipstreamHaste", durationMs: 600, chance: 1 }],
            zone.ownerId,
            now,
          );
        }
      } else if (zone.wasInside) {
        this.grantSlipstreamTailwind(zone, owner.x, owner.z, now);
        zone.wasInside = false;
      }

      if (expired) {
        if (inLane) {
          this.grantSlipstreamTailwind(zone, owner.x, owner.z, now);
        }
        continue;
      }

      remain.push(zone);
    }

    this.slipstreamHasteBodyIds = hasted;
    this.pendingSlipstreams = remain;
  }

  // ─── Soul Relay ──────────────────────────────────────────────────

  /** Alive healable body (player or practice dummy) for Soul Relay. */
  private soulRelayBody(targetId: string): { x: number; z: number; hp: number } | null {
    const player = this.room.state.players.get(targetId);
    if (player) {
      if (player.disconnected || player.hp <= 0) return null;
      return { x: player.x, z: player.z, hp: player.hp };
    }
    const dummy = this.room.state.targets.get(targetId);
    if (dummy && dummy.hp > 0) return { x: dummy.x, z: dummy.z, hp: dummy.hp };
    return null;
  }

  /**
   * Fire Soul Relay: bind the healable closest to aim (self included).
   * Ally / dummy out of range and nearer the cursor than you → refuse (range feedback).
   * Otherwise cast on the closest in-range pick (often self when aiming near your feet).
   */
  /** @returns false when the cast was refused (e.g. out of range) — no cooldown. */
  private fireSoulRelay(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
  ): boolean {
    const healAmount = def.heal ?? SOUL_RELAY_CAST.initialHeal;
    const relayDur = SOUL_RELAY_CAST.relayDurationMs;
    const range = Math.max(1, def.range > 0 ? def.range : SOUL_RELAY_CAST.range);

    const cast = this.casts.get(sessionId);
    const aim =
      cast?.aimX != null &&
      cast?.aimZ != null &&
      Number.isFinite(cast.aimX) &&
      Number.isFinite(cast.aimZ)
        ? { x: cast.aimX, z: cast.aimZ }
        : null;

    const pick = this.findSoulRelayAimTarget(sessionId, player, range, aim);
    if (pick && pick.id !== sessionId && !pick.inRange) {
      // Aimed at someone too far — refuse self-cast so range is readable.
      this.fx({
        kind: "aoe",
        abilityId: def.id,
        x: player.x,
        z: player.z,
        ownerId: sessionId,
        radius: range,
        variant: 3, // out-of-range feedback
      });
      return false;
    }

    const targetId = pick?.id ?? sessionId;
    const isSelf = targetId === sessionId;
    const target = this.soulRelayBody(targetId);
    if (!target) return false;

    if (!isSelf) {
      const dist = Math.hypot(target.x - player.x, target.z - player.z);
      const speed = def.speed ?? SOUL_RELAY_CAST.speed;
      const travelMs = Math.max(50, Math.round((dist / speed) * 1000));

      this.fx({
        kind: "aoe",
        abilityId: def.id,
        x: player.x,
        z: player.z,
        ownerId: sessionId,
        targetId,
        x2: target.x,
        z2: target.z,
        variant: 1,
      });

      this.pendingSoulRelayHeals.push({
        casterId: sessionId,
        targetId,
        healAmount,
        relayDur,
        resolveAt: now + travelMs,
      });
    } else {
      this.applyHealAmount(sessionId, healAmount, sessionId, def.id);
      this.applySoulRelayLink(sessionId, sessionId, now, relayDur);
      this.fx({
        kind: "aoe",
        abilityId: def.id,
        x: player.x,
        z: player.z,
        ownerId: sessionId,
        variant: 0,
      });
    }
    return true;
  }

  /**
   * Soft-target Soul Relay: pick the healable closest to the ground aim,
   * including the caster. Allies must sit in the forward cone to compete.
   */
  private findSoulRelayAimTarget(
    casterId: string,
    caster: PlayerState,
    range: number,
    aim: { x: number; z: number } | null,
  ): { id: string; inRange: boolean } | null {
    const fx = Math.sin(caster.yaw);
    const fz = Math.cos(caster.yaw);
    const aimX = aim?.x ?? caster.x;
    const aimZ = aim?.z ?? caster.z;

    let bestId: string | null = null;
    let bestAimDist = Infinity;
    let bestCasterDist = 0;

    const consider = (id: string, x: number, z: number, requireCone: boolean) => {
      const dx = x - caster.x;
      const dz = z - caster.z;
      const casterDist = Math.hypot(dx, dz);
      if (requireCone) {
        if (casterDist < 0.01) return;
        const dot = (dx * fx + dz * fz) / casterDist;
        // ~60° forward cone
        if (dot < 0.5) return;
      }
      const aimDist = Math.hypot(x - aimX, z - aimZ);
      if (
        aimDist < bestAimDist - 1e-4 ||
        (Math.abs(aimDist - bestAimDist) <= 1e-4 && casterDist < bestCasterDist)
      ) {
        bestAimDist = aimDist;
        bestId = id;
        bestCasterDist = casterDist;
      }
    };

    // Caster always competes — aiming near your feet self-casts.
    consider(casterId, caster.x, caster.z, false);

    for (const [id, p] of this.room.state.players) {
      if (id === casterId) continue;
      if (p.disconnected || p.hp <= 0 || p.role === "spectator" || p.roundDead) continue;
      if (!this.canHealTarget(casterId, id)) continue;
      consider(id, p.x, p.z, true);
    }
    for (const [id, t] of this.room.state.targets) {
      if (t.hp <= 0) continue;
      if (!this.canHealTarget(casterId, id)) continue;
      consider(id, t.x, t.z, true);
    }

    if (!bestId) return null;
    return { id: bestId, inRange: bestCasterDist <= range };
  }

  /**
   * Create the relay link: status on target + server state.
   * Replaces any existing relay for this caster.
   */
  private applySoulRelayLink(
    casterId: string,
    linkedTargetId: string,
    now: number,
    durationMs: number,
  ) {
    // Remove old relay
    const old = this.activeSoulRelays.get(casterId);
    if (old) {
      this.statuses.remove(old.linkedTargetId, "soulRelayLinked");
    }

    this.activeSoulRelays.set(casterId, {
      casterId,
      linkedTargetId,
      startedAt: now,
      endsAt: now + durationMs,
    });

    this.statuses.apply(linkedTargetId, "soulRelayLinked", casterId, now, {
      durationMs,
    });
  }

  /**
   * Called when a caster with an active relay deals direct damage.
   * Consumes the relay and heals the linked target for the damage dealt.
   */
  private trySoulRelayTrigger(
    attackerSessionId: string,
    abilityId: string,
    damageDealt: number,
  ): boolean {
    const relay = this.activeSoulRelays.get(attackerSessionId);
    if (!relay) return false;

    const now = Date.now();
    if (now >= relay.endsAt) {
      this.clearSoulRelay(attackerSessionId);
      return false;
    }

    // Don't trigger from Soul Relay's own projectile
    if (abilityId === "soulRelay") return false;
    if (!(damageDealt > 0)) return false;

    const target =
      this.room.state.players.get(relay.linkedTargetId) ??
      this.room.state.targets.get(relay.linkedTargetId);
    if (!target || ("disconnected" in target && target.disconnected) || target.hp <= 0) {
      this.clearSoulRelay(attackerSessionId);
      return false;
    }

    const heal = Math.max(
      SOUL_RELAY_CAST.relayHealMin,
      Math.round(damageDealt * SOUL_RELAY_CAST.relayHealMul),
    );
    this.applyHealAmount(relay.linkedTargetId, heal, attackerSessionId, "soulRelay");

    this.fx({
      kind: "aoe",
      abilityId: "soulRelay",
      x: target.x,
      z: target.z,
      ownerId: attackerSessionId,
      targetId: relay.linkedTargetId,
      variant: 2,
    });

    this.clearSoulRelay(attackerSessionId);
    return true;
  }

  /** Remove relay state + status cleanly. */
  private clearSoulRelay(casterId: string) {
    const relay = this.activeSoulRelays.get(casterId);
    if (!relay) return;
    this.statuses.remove(relay.linkedTargetId, "soulRelayLinked");
    this.activeSoulRelays.delete(casterId);
  }

  /** Tick: expire stale relays + clean up on death/disconnect. */
  private tickSoulRelays(now: number) {
    for (const [casterId, relay] of this.activeSoulRelays) {
      if (now >= relay.endsAt) {
        this.clearSoulRelay(casterId);
        continue;
      }
      const caster = this.room.state.players.get(casterId);
      if (!caster || caster.disconnected || caster.hp <= 0) {
        this.clearSoulRelay(casterId);
        continue;
      }
      if (!this.soulRelayBody(relay.linkedTargetId)) {
        this.clearSoulRelay(casterId);
      }
    }
  }

  /** Resolve ally-cast Soul Relay heals after projectile travel. */
  private advancePendingSoulRelayHeals(now: number) {
    if (this.pendingSoulRelayHeals.length === 0) return;
    const remain: typeof this.pendingSoulRelayHeals = [];
    for (const pending of this.pendingSoulRelayHeals) {
      if (now < pending.resolveAt) {
        remain.push(pending);
        continue;
      }
      const target = this.soulRelayBody(pending.targetId);
      if (!target) continue;
      const caster = this.room.state.players.get(pending.casterId);
      if (!caster || caster.disconnected || caster.hp <= 0) continue;
      this.applyHealAmount(
        pending.targetId,
        pending.healAmount,
        pending.casterId,
        "soulRelay",
      );
      this.applySoulRelayLink(
        pending.casterId,
        pending.targetId,
        now,
        pending.relayDur,
      );
      this.fx({
        kind: "aoe",
        abilityId: "soulRelay",
        x: target.x,
        z: target.z,
        ownerId: pending.casterId,
        targetId: pending.targetId,
        variant: 0,
      });
    }
    this.pendingSoulRelayHeals = remain;
  }

  /** True while this session is mid-cast on Rift Fissure (any phase). */
  private isCastingRiftFissure(sessionId: string): boolean {
    const cast = this.casts.get(sessionId);
    return Boolean(cast && cast.abilityId === "riftFissure");
  }

  /** Plant portal A (arm window) or B (link pair) in front of the caster. */
  private scheduleRiftFissure(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
  ) {
    const pending = this.pendingRifts.get(sessionId);
    // If the second cast was started in the arm window, always finish as B —
    // even when the arm timer elapsed during the cast animation.
    if (pending && !pending.portalBId) {
      this.plantRiftPortalB(sessionId, ownerBody, def, pending, now);
      return;
    }
    // Fresh pair — clear any leftover portals from this owner.
    this.clearOwnerRifts(sessionId);
    this.plantRiftPortalA(sessionId, ownerBody, def, now);
  }

  private plantRiftPortalA(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
  ) {
    const pos = this.findRiftPlantPos(sessionId, ownerBody);
    const radius = Math.max(0.35, def.radius ?? RIFT_FISSURE_CAST.mouthRadius);
    const armEndsAt = now + RIFT_FISSURE_CAST.armMs;
    const id = `rift_${this.nextId++}`;

    const st = new RiftPortalState();
    st.id = id;
    st.ownerSessionId = sessionId;
    st.pairId = "";
    st.index = 0;
    st.x = pos.x;
    st.z = pos.z;
    st.yaw = ownerBody.yaw;
    st.radius = radius;
    st.phase = "arming";
    st.armEndsAt = armEndsAt;
    // Pair lifetime starts only when B is planted — not during the arm window.
    st.expiresAt = 0;
    this.room.state.riftPortals.set(id, st);

    this.pendingRifts.set(sessionId, {
      portalAId: id,
      portalBId: null,
      armEndsAt,
      expiresAt: 0,
      travelerCd: new Map(),
    });
  }

  private plantRiftPortalB(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    pending: {
      portalAId: string;
      portalBId: string | null;
      armEndsAt: number;
      expiresAt: number;
      travelerCd: Map<string, number>;
    },
    now: number,
  ) {
    const pos = this.findRiftPlantPos(sessionId, ownerBody);
    const radius = Math.max(0.35, def.radius ?? RIFT_FISSURE_CAST.mouthRadius);
    const expiresAt = now + (def.zoneDurationMs ?? RIFT_FISSURE_CAST.pairDurationMs);
    const id = `rift_${this.nextId++}`;

    const st = new RiftPortalState();
    st.id = id;
    st.ownerSessionId = sessionId;
    st.pairId = pending.portalAId;
    st.index = 1;
    st.x = pos.x;
    st.z = pos.z;
    st.yaw = ownerBody.yaw;
    st.radius = radius;
    st.phase = "open";
    st.armEndsAt = 0;
    st.expiresAt = expiresAt;
    this.room.state.riftPortals.set(id, st);

    const a = this.room.state.riftPortals.get(pending.portalAId);
    if (a) {
      a.pairId = id;
      a.phase = "open";
      a.armEndsAt = 0;
      a.expiresAt = expiresAt;
    }

    pending.portalBId = id;
    pending.expiresAt = expiresAt;
  }

  /**
   * Prefer cursor ground aim (clamped to max place range); if blocked / occupied,
   * fan out to side / closer candidates along the aim ray and facing.
   */
  private findRiftPlantPos(sessionId: string, ownerBody: CombatBody): Vec2 {
    const yaw = ownerBody.yaw;
    const origin = { x: ownerBody.x, z: ownerBody.z };
    const cast = this.casts.get(sessionId);
    const aim =
      cast?.aimX != null && cast?.aimZ != null
        ? { x: cast.aimX, z: cast.aimZ }
        : undefined;
    const maxRange = RIFT_FISSURE_CAST.maxPlaceRange;
    const preferred = clampGroundAim(ownerBody, aim, maxRange);
    const side = 1.4;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const toAimX = preferred.x - origin.x;
    const toAimZ = preferred.z - origin.z;
    const aimDist = Math.hypot(toAimX, toAimZ);
    const ax = aimDist > 1e-4 ? toAimX / aimDist : fx;
    const az = aimDist > 1e-4 ? toAimZ / aimDist : fz;
    const placeDist = aimDist > 1e-4 ? aimDist : RIFT_FISSURE_CAST.placeForward;

    const candidates: Vec2[] = [
      preferred,
      { x: origin.x + ax * placeDist + rx * side, z: origin.z + az * placeDist + rz * side },
      { x: origin.x + ax * placeDist - rx * side, z: origin.z + az * placeDist - rz * side },
      { x: origin.x + ax * (placeDist * 0.55), z: origin.z + az * (placeDist * 0.55) },
      {
        x: origin.x + ax * (placeDist * 0.55) + rx * side,
        z: origin.z + az * (placeDist * 0.55) + rz * side,
      },
      {
        x: origin.x + ax * (placeDist * 0.55) - rx * side,
        z: origin.z + az * (placeDist * 0.55) - rz * side,
      },
      { x: origin.x + ax * 1.2, z: origin.z + az * 1.2 },
      { x: origin.x + fx * RIFT_FISSURE_CAST.placeForward, z: origin.z + fz * RIFT_FISSURE_CAST.placeForward },
      { x: origin.x + rx * side, z: origin.z + rz * side },
      { x: origin.x - rx * side, z: origin.z - rz * side },
    ];

    const mouthR = RIFT_FISSURE_CAST.mouthRadius;
    for (const ideal of candidates) {
      const swept = this.sweepPlayerPos(sessionId, origin, ideal);
      if (this.riftPosOverlapsEnemy(sessionId, swept, mouthR)) continue;
      return swept;
    }
    // Last resort — clamp beside the caster.
    return this.clampPlayerPos(sessionId, {
      x: origin.x + ax * 1.1,
      z: origin.z + az * 1.1,
    });
  }

  private riftPosOverlapsEnemy(ownerId: string, pos: Vec2, radius: number): boolean {
    for (const body of this.collectBodies()) {
      if (body.hp <= 0) continue;
      if (!this.canHurt(ownerId, body.id)) continue;
      if (
        circlesOverlap(
          pos.x,
          pos.z,
          radius,
          body.x,
          body.z,
          hitRadiusOf(body),
        )
      ) {
        return true;
      }
    }
    return false;
  }

  private clearOwnerRifts(sessionId: string) {
    const pending = this.pendingRifts.get(sessionId);
    if (pending) {
      this.room.state.riftPortals.delete(pending.portalAId);
      if (pending.portalBId) this.room.state.riftPortals.delete(pending.portalBId);
      this.pendingRifts.delete(sessionId);
    }
    // Sweep any orphans for this owner.
    const drop: string[] = [];
    this.room.state.riftPortals.forEach((p, id) => {
      if (p.ownerSessionId === sessionId) drop.push(id);
    });
    for (const id of drop) this.room.state.riftPortals.delete(id);
  }

  private advancePendingRifts(now: number) {
    if (this.pendingRifts.size === 0) return;
    for (const [ownerId, pending] of [...this.pendingRifts]) {
      // Arm window expired without B — drop A (CD already started on plant).
      // Hold A while the owner is casting the second plant so a last-second
      // cast cannot despawn A and resolve as a free fresh portal A.
      if (
        !pending.portalBId &&
        now >= pending.armEndsAt &&
        !this.isCastingRiftFissure(ownerId)
      ) {
        this.room.state.riftPortals.delete(pending.portalAId);
        this.pendingRifts.delete(ownerId);
        continue;
      }
      // Pair lifetime ended.
      if (pending.portalBId && now >= pending.expiresAt) {
        this.room.state.riftPortals.delete(pending.portalAId);
        this.room.state.riftPortals.delete(pending.portalBId);
        this.pendingRifts.delete(ownerId);
        continue;
      }
      if (!pending.portalBId) continue;

      const a = this.room.state.riftPortals.get(pending.portalAId);
      const b = this.room.state.riftPortals.get(pending.portalBId);
      if (!a || !b) {
        this.clearOwnerRifts(ownerId);
        continue;
      }
      this.tryRiftTravels(ownerId, pending, a, b, now);
    }
  }

  /**
   * Face-only enter volume: thin oriented slab + bias so left/right edge scrapes
   * do not count (must approach through the portal front/back).
   */
  private riftMouthContains(
    portal: RiftPortalState,
    x: number,
    z: number,
    bodyRadius = COMBAT.playerHitRadius,
  ): boolean {
    const radius = Math.max(0.35, portal.radius);
    const yaw = portal.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const dx = x - portal.x;
    const dz = z - portal.z;
    const alongFwd = dx * fx + dz * fz;
    const alongSide = dx * rx + dz * rz;
    const sideHalf = radius * RIFT_FISSURE_CAST.enterSideHalf + bodyRadius * 0.35;
    const depthHalf = radius * RIFT_FISSURE_CAST.enterDepthHalf + bodyRadius * 0.35;
    if (Math.abs(alongSide) > sideHalf) return false;
    if (Math.abs(alongFwd) > depthHalf) return false;
    // Reject side-dominated contact (walking into the oval's left/right edge).
    if (Math.abs(alongFwd) < Math.abs(alongSide) * RIFT_FISSURE_CAST.enterFaceBias) {
      return false;
    }
    return true;
  }

  private tryRiftTravels(
    ownerId: string,
    pending: {
      portalAId: string;
      portalBId: string | null;
      armEndsAt: number;
      expiresAt: number;
      travelerCd: Map<string, number>;
    },
    a: RiftPortalState,
    b: RiftPortalState,
    now: number,
  ) {
    for (const body of this.collectBodies()) {
      if (body.hp <= 0) continue;
      // Players only (allies + enemies + owner); skip practice dummies.
      if (!this.room.state.players.has(body.id)) continue;
      const cdUntil = pending.travelerCd.get(body.id) ?? 0;
      if (cdUntil > now) continue;

      const inA = this.riftMouthContains(a, body.x, body.z);
      const inB = this.riftMouthContains(b, body.x, body.z);
      if (inA === inB) continue; // neither, or both (rare) — skip

      const entry = inA ? a : b;
      const exit = inA ? b : a;
      const player = this.room.state.players.get(body.id);
      if (!player) continue;
      const fromX = player.x;
      const fromZ = player.z;
      // Portal forward (yaw) = Front; opposite = Back.
      // Enter Front → exit Back (and vice versa), along each mouth's own facing.
      const enterFace = this.riftMouthFace(entry, fromX, fromZ);
      const landed = this.riftExitPos(body.id, entry, exit, fromX, fromZ, enterFace);
      // Refuse travel if no safe landing (wall/OOB) or still in exit mouth.
      if (!landed || this.riftMouthContains(exit, landed.x, landed.z)) {
        continue;
      }
      player.x = landed.x;
      player.z = landed.z;
      // Keep traveler yaw (do not reorient).
      // Shove further out along the exit face so you can't immediately walk back through.
      const shoveTo = this.riftExitShoveTo(body.id, exit, landed, enterFace);
      this.knockbacks.set(body.id, {
        targetId: body.id,
        kind: "player",
        fromX: landed.x,
        fromZ: landed.z,
        toX: shoveTo.x,
        toZ: shoveTo.z,
        startAt: now,
        endAt: now + RIFT_FISSURE_CAST.exitShoveMs,
      });
      this.travels.delete(body.id);
      pending.travelerCd.set(
        body.id,
        now +
          Math.max(
            RIFT_FISSURE_CAST.travelerCooldownMs,
            RIFT_FISSURE_CAST.exitShoveMs + 250,
          ),
      );
      this.fx({
        kind: "portal",
        abilityId: "riftFissure",
        x: fromX,
        z: fromZ,
        x2: shoveTo.x,
        z2: shoveTo.z,
        yaw: player.yaw,
        ownerId: ownerId,
        phaseEndsAt: now + RIFT_FISSURE_CAST.exitShoveMs,
        radius: RIFT_FISSURE_CAST.exitShove,
      });
    }
  }

  /**
   * Which labelled face the traveler is on.
   * Plant yaw forward = Front (+alongFwd); opposite = Back.
   */
  private riftMouthFace(
    portal: RiftPortalState,
    x: number,
    z: number,
  ): "front" | "back" {
    const fx = Math.sin(portal.yaw);
    const fz = Math.cos(portal.yaw);
    const alongFwd = (x - portal.x) * fx + (z - portal.z) * fz;
    return alongFwd >= 0 ? "front" : "back";
  }

  /**
   * Exit face is the other label: enter Front → leave through Back.
   * Sign is along exit portal forward (+ = Front half-space).
   */
  private riftExitFaceSign(enterFace: "front" | "back"): number {
    return enterFace === "front" ? -1 : 1;
  }

  /** Destination of the post-teleport shove along the exit face outward. */
  private riftExitShoveTo(
    travelerId: string,
    exit: RiftPortalState,
    landed: Vec2,
    enterFace: "front" | "back",
  ): Vec2 {
    const sign = this.riftExitFaceSign(enterFace);
    const fx = Math.sin(exit.yaw);
    const fz = Math.cos(exit.yaw);
    const ideal = {
      x: landed.x + fx * sign * RIFT_FISSURE_CAST.exitShove,
      z: landed.z + fz * sign * RIFT_FISSURE_CAST.exitShove,
    };
    return this.sweepPlayerPos(travelerId, landed, ideal);
  }

  /**
   * Land on the linked face of the exit mouth (Front↔Back), preserving lateral
   * offset in each portal's local frame. When the face line is blocked (wall),
   * fall back to side offsets like Revenge — never clamp through geometry/OOB.
   */
  private riftExitPos(
    travelerId: string,
    entry: RiftPortalState,
    exit: RiftPortalState,
    fromX: number,
    fromZ: number,
    enterFace: "front" | "back",
  ): Vec2 | null {
    const minClear = exit.radius + COMBAT.playerHitRadius + 0.12;
    const push = Math.max(RIFT_FISSURE_CAST.exitPush, minClear);
    const origin = { x: exit.x, z: exit.z };

    const erx = Math.cos(entry.yaw);
    const erz = -Math.sin(entry.yaw);
    const alongSide = (fromX - entry.x) * erx + (fromZ - entry.z) * erz;

    const xfx = Math.sin(exit.yaw);
    const xfz = Math.cos(exit.yaw);
    const xrx = Math.cos(exit.yaw);
    const xrz = -Math.sin(exit.yaw);
    const throughSign = this.riftExitFaceSign(enterFace);

    const candidates: Vec2[] = [];
    // Prefer intended face + lateral preserve, then stepped outward distances.
    for (const d of [push, push * 0.75, push * 0.55, push + 0.35, push + 0.7]) {
      candidates.push({
        x: exit.x + xfx * throughSign * d + xrx * alongSide,
        z: exit.z + xfz * throughSign * d + xrz * alongSide,
      });
      candidates.push({
        x: exit.x + xfx * throughSign * d,
        z: exit.z + xfz * throughSign * d,
      });
    }
    // Side offsets when the face line is jammed against a wall.
    for (const d of [push * 0.85, push * 0.55, push * 0.4]) {
      for (const side of [-1, 1]) {
        const lat = alongSide + side * (COMBAT.playerHitRadius * 1.15);
        candidates.push({
          x: exit.x + xfx * throughSign * d + xrx * lat,
          z: exit.z + xfz * throughSign * d + xrz * lat,
        });
        candidates.push({
          x: exit.x + xfx * throughSign * d + xrx * side * (COMBAT.playerHitRadius * 1.4),
          z: exit.z + xfz * throughSign * d + xrz * side * (COMBAT.playerHitRadius * 1.4),
        });
      }
    }

    for (const ideal of candidates) {
      const swept = this.sweepPlayerPos(travelerId, origin, ideal);
      const next = this.clampPlayerPos(travelerId, swept);
      const dist = Math.hypot(next.x - origin.x, next.z - origin.z);
      if (dist + 0.05 < minClear) continue;
      if (this.riftMouthContains(exit, next.x, next.z)) continue;
      const alongExitFwd = (next.x - exit.x) * xfx + (next.z - exit.z) * xfz;
      if (alongExitFwd * throughSign < minClear * 0.55) continue;
      // Reject if clamp barely moved toward ideal (stuck / through-wall failure).
      const toIdeal = Math.hypot(ideal.x - next.x, ideal.z - next.z);
      const fromIdeal = Math.hypot(ideal.x - origin.x, ideal.z - origin.z);
      if (toIdeal + 0.05 >= fromIdeal && dist < minClear + 0.2) continue;
      return next;
    }
    return null;
  }

  /**
   * Magma Orbs — at launch (impact), freeze flight path, burn on contact in air.
   * Each orb stops independently on walls. One arrival = half blast; both = full.
   */
  private scheduleMagmaOrbs(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    const yaw = cast?.yaw ?? ownerBody.yaw;
    const aim =
      cast?.aimX != null && cast?.aimZ != null
        ? { x: cast.aimX, z: cast.aimZ }
        : null;
    const meetRange = resolveMagmaOrbsMeetRange(ownerBody, aim);
    const path = buildMagmaOrbsFlightPath(ownerBody, yaw, meetRange);
    const blastRadius = this.talentRadius(
      sessionId,
      def.id,
      Math.max(0.8, def.radius ?? MAGMA_ORBS_CAST.blastRadius),
    );
    const flightMs = Math.max(16, phaseDurationMs(def, "impact"));
    const explodeAt = now + flightMs;
    const flightHitRadius = MAGMA_ORBS_CAST.flightHitRadius;
    const maxT = magmaOrbsMaxFlightTs(
      path,
      this.wallColliders,
      flightHitRadius,
      this.circleColliders,
      this.boxColliders,
    );
    const passBubbleIds = this.protectionBubblePassIds(
      [path.left0, path.right0, { x: ownerBody.x, z: ownerBody.z }],
      now,
      flightHitRadius,
    );

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: path.collide.x,
      z: path.collide.z,
      x2: ownerBody.x,
      z2: ownerBody.z,
      // Blast radius for impact; meet range also encoded via collide point.
      radius: blastRadius,
      yaw,
      ownerId: sessionId,
      variant: 1,
      phaseEndsAt: explodeAt,
    });

    this.pendingMagmaOrbs.push({
      ownerId: sessionId,
      abilityId: def.id,
      x: path.collide.x,
      z: path.collide.z,
      radius: blastRadius,
      damage: def.damage,
      launchAt: now,
      explodeAt,
      path,
      flightHitRadius,
      leftMaxT: maxT.left,
      rightMaxT: maxT.right,
      passBubbleIds,
      pathHitIds: new Set(),
    });
  }

  private advancePendingMagmaOrbs(now: number) {
    if (this.pendingMagmaOrbs.length === 0) return;
    const remain: PendingMagmaOrbs[] = [];
    const bodies = this.collectBodies();
    for (const orb of this.pendingMagmaOrbs) {
      if (now < orb.explodeAt) {
        const span = Math.max(1, orb.explodeAt - orb.launchAt);
        const linear = Math.max(0, Math.min(1, (now - orb.launchAt) / span));
        const t = magmaOrbsFlightT(linear);
        let leftAlive = t <= orb.leftMaxT + 1e-4;
        let rightAlive = t <= orb.rightMaxT + 1e-4;
        if (!leftAlive && !rightAlive) {
          remain.push(orb);
          continue;
        }
        const { left, right } = sampleMagmaOrbsFlight(orb.path, t);
        const prevSample = sampleMagmaOrbsFlight(
          orb.path,
          magmaOrbsFlightT(Math.max(0, linear - 0.04)),
        );
        const bubbles = this.collectProjectileBlockColliders(now);
        for (const b of bubbles) {
          if (b.id && orb.passBubbleIds.has(b.id)) continue;
          if (
            leftAlive &&
            projectileEntersProtectionBubble(
              prevSample.left.x,
              prevSample.left.z,
              left.x,
              left.z,
              orb.flightHitRadius,
              b,
            )
          ) {
            orb.leftMaxT = Math.min(orb.leftMaxT, t);
            leftAlive = false;
            if (b.id?.startsWith("handShield_")) {
              this.fireHandShieldRetaliate(b.id.slice("handShield_".length), now);
            }
          }
          if (
            rightAlive &&
            projectileEntersProtectionBubble(
              prevSample.right.x,
              prevSample.right.z,
              right.x,
              right.z,
              orb.flightHitRadius,
              b,
            )
          ) {
            orb.rightMaxT = Math.min(orb.rightMaxT, t);
            rightAlive = false;
            if (b.id?.startsWith("handShield_")) {
              this.fireHandShieldRetaliate(b.id.slice("handShield_".length), now);
            }
          }
        }
        if (!leftAlive && !rightAlive) {
          remain.push(orb);
          continue;
        }
        const def = ABILITIES[orb.abilityId];
        const burn = def?.applyOnHit;
        for (const body of bodies) {
          if (orb.pathHitIds.has(body.id)) continue;
          if (!this.canHurt(orb.ownerId, body.id)) continue;
          const hit =
            (leftAlive &&
              circlesOverlap(
                left.x,
                left.z,
                orb.flightHitRadius,
                body.x,
                body.z,
                hitRadiusOf(body),
              )) ||
            (rightAlive &&
              circlesOverlap(
                right.x,
                right.z,
                orb.flightHitRadius,
                body.x,
                body.z,
                hitRadiusOf(body),
              ));
          if (!hit) continue;
          orb.pathHitIds.add(body.id);
          if (burn?.length) {
            this.applyOutgoingStatusApps(body.id, burn, orb.ownerId, now);
          }
        }
        remain.push(orb);
        continue;
      }

      // Full meet blast if both arrive; half radius/damage if only one clears walls.
      const leftArrives = orb.leftMaxT >= 1 - 1e-4;
      const rightArrives = orb.rightMaxT >= 1 - 1e-4;
      const arriveCount = (leftArrives ? 1 : 0) + (rightArrives ? 1 : 0);
      if (arriveCount === 0) continue;

      const mul = arriveCount === 2 ? 1 : 0.5;
      const blastR = orb.radius * mul;
      const blastDmg = Math.max(1, Math.round(orb.damage * mul));

      const hits = resolveInstantHits(
        { x: orb.x, z: orb.z },
        blastR,
        blastDmg,
        orb.ownerId,
        bodies,
        (o, t) => this.canHurt(o, t),
      );
      for (const hit of hits) {
        this.applyDamage(hit.targetId, hit.damage, orb.ownerId, orb.abilityId, now, {
          directSpell: false,
        });
      }
      this.fx({
        kind: "aoe",
        abilityId: orb.abilityId,
        x: orb.x,
        z: orb.z,
        radius: blastR,
        ownerId: orb.ownerId,
        variant: 2,
      });
    }
    this.pendingMagmaOrbs = remain;
  }

  private scheduleProtectionBubble(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    const x = cast?.originX ?? ownerBody.x;
    const z = cast?.originZ ?? ownerBody.z;
    const radius = Math.max(1.5, def.radius ?? PROTECTION_BUBBLE_CAST.radius);
    const formMs = PROTECTION_BUBBLE_CAST.formMs;
    const durationMs = Math.max(500, def.zoneDurationMs ?? PROTECTION_BUBBLE_CAST.zoneDurationMs);
    const fadeMs = PROTECTION_BUBBLE_CAST.fadeMs;
    const formEndsAt = now + formMs;
    const activeEndsAt = formEndsAt + durationMs;
    const despawnAt = activeEndsAt + fadeMs;
    const id = `bubble_${this.nextId++}`;

    const st = new ProtectionBubbleState();
    st.id = id;
    st.ownerSessionId = sessionId;
    st.x = x;
    st.z = z;
    st.radius = radius;
    st.phase = "forming";
    st.formEndsAt = formEndsAt;
    st.activeEndsAt = activeEndsAt;
    st.expiresAt = despawnAt;
    this.room.state.protectionBubbles.set(id, st);

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x,
      z,
      radius,
      yaw: ownerBody.yaw,
      ownerId: sessionId,
      variant: 0,
      phaseEndsAt: despawnAt,
    });

    this.pendingProtectionBubbles.push({
      id,
      ownerId: sessionId,
      abilityId: def.id,
      x,
      z,
      radius,
      spawnedAt: now,
      formEndsAt,
      activeEndsAt,
      despawnAt,
      phase: "forming",
      nextShieldAt: formEndsAt,
      shieldGranted: 0,
    });
  }

  private protectionBubbleLiveRadius(zone: PendingProtectionBubble, now: number): number {
    if (now >= zone.despawnAt) return 0;
    if (now < zone.formEndsAt) {
      const span = Math.max(1, zone.formEndsAt - zone.spawnedAt);
      const u = Math.max(0, Math.min(1, (now - zone.spawnedAt) / span));
      const e = 1 - (1 - u) * (1 - u);
      return zone.radius * Math.max(0.12, e);
    }
    if (now >= zone.activeEndsAt) {
      const span = Math.max(1, zone.despawnAt - zone.activeEndsAt);
      const u = Math.max(0, Math.min(1, (now - zone.activeEndsAt) / span));
      return zone.radius * Math.max(0, 1 - u * u);
    }
    return zone.radius;
  }

  private collectProtectionBubbleColliders(now: number): ProtectionBubbleCollider[] {
    const out: ProtectionBubbleCollider[] = [];
    for (const zone of this.pendingProtectionBubbles) {
      const r = this.protectionBubbleLiveRadius(zone, now);
      if (r < 0.2) continue;
      out.push({ id: zone.id, x: zone.x, z: zone.z, radius: r });
    }
    return out;
  }

  /**
   * Hand Shield — disc ahead of the caster while handShielding is active
   * (channel hold + Block End recovery). Status-driven so recovery still blocks.
   */
  private collectHandShieldColliders(): ProtectionBubbleCollider[] {
    const out: ProtectionBubbleCollider[] = [];
    this.room.state.players.forEach((player, sessionId) => {
      if (player.hp <= 0 || player.disconnected) return;
      if (!this.statuses.has(sessionId, "handShielding")) return;
      const center = pointInFront(
        { x: player.x, z: player.z },
        player.yaw,
        HAND_SHIELD_CAST.shieldForward,
      );
      out.push({
        id: `handShield_${sessionId}`,
        x: center.x,
        z: center.z,
        radius: HAND_SHIELD_CAST.shieldRadius,
      });
    });
    return out;
  }

  /** Protection bubbles + active Hand Shields (projectile shatter colliders). */
  private collectProjectileBlockColliders(now: number): ProtectionBubbleCollider[] {
    return [
      ...this.collectProtectionBubbleColliders(now),
      ...this.collectHandShieldColliders(),
    ];
  }

  /** Bubbles that contain any of the given points (spawn-inside pass-through). */
  private protectionBubblePassIds(
    points: readonly Vec2[],
    now: number,
    pad = 0.15,
  ): Set<string> {
    const ids = new Set<string>();
    for (const b of this.collectProtectionBubbleColliders(now)) {
      if (!b.id) continue;
      for (const p of points) {
        if (pointInProtectionBubble(p.x, p.z, b, pad)) {
          ids.add(b.id);
          break;
        }
      }
    }
    return ids;
  }

  private stampProjectileBubblePass(sim: ProjectileSim, now: number) {
    const ids = this.protectionBubblePassIds([{ x: sim.x, z: sim.z }], now, sim.wallRadius);
    for (const id of ids) sim.passBubbleIds.add(id);
  }

  private advancePendingProtectionBubbles(now: number) {
    if (this.pendingProtectionBubbles.length === 0) return;
    const remain: PendingProtectionBubble[] = [];
    const tickMs = PROTECTION_BUBBLE_CAST.shieldTickMs;
    const perTick = PROTECTION_BUBBLE_CAST.shieldPerTick;
    const cap = PROTECTION_BUBBLE_CAST.shieldCap;
    for (const zone of this.pendingProtectionBubbles) {
      const st = this.room.state.protectionBubbles.get(zone.id);
      if (now >= zone.despawnAt) {
        this.room.state.protectionBubbles.delete(zone.id);
        continue;
      }
      if (zone.phase === "forming" && now >= zone.formEndsAt) {
        zone.phase = "active";
        if (st) st.phase = "active";
        if (zone.nextShieldAt < zone.formEndsAt) zone.nextShieldAt = zone.formEndsAt;
      }
      if (zone.phase === "active" && now >= zone.activeEndsAt) {
        zone.phase = "fading";
        if (st) st.phase = "fading";
      }
      if (zone.phase === "active") {
        while (zone.nextShieldAt <= now) {
          const add = perTick;
          const durationMs = Math.max(500, zone.activeEndsAt - now + 500);
          const recipients: string[] = [];
          const owner = this.room.state.players.get(zone.ownerId);
          if (owner) {
            const odx = owner.x - zone.x;
            const odz = owner.z - zone.z;
            if (odx * odx + odz * odz <= zone.radius * zone.radius) {
              recipients.push(zone.ownerId);
            }
          }
          this.room.state.players.forEach((p, id) => {
            if (id === zone.ownerId) return;
            if (p.disconnected || p.invulnerable) return;
            // Ally = cannot hurt each other (same team / hub friendly).
            if (this.canHurt(zone.ownerId, id)) return;
            const dx = p.x - zone.x;
            const dz = p.z - zone.z;
            if (dx * dx + dz * dz > zone.radius * zone.radius) return;
            recipients.push(id);
          });
          for (const targetId of recipients) {
            const current = this.statuses.getStacks(targetId, "bubbleShield");
            if (current >= cap) continue;
            this.statuses.apply(targetId, "bubbleShield", zone.ownerId, now, {
              durationMs,
              stacks: Math.min(cap, current + add),
              setStacks: true,
            });
          }
          zone.shieldGranted = Math.min(cap, zone.shieldGranted + add);
          zone.nextShieldAt += tickMs;
          if (zone.nextShieldAt > zone.activeEndsAt) break;
        }
      }
      remain.push(zone);
    }
    this.pendingProtectionBubbles = remain;
  }

  private scheduleShroom(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
    armed = true,
  ) {
    // One plant per cast — don't double-spawn if cast phase re-enters.
    if (this.pendingShrooms.some((z) => z.ownerId === sessionId && !z.armed && !z.sinking)) {
      return;
    }

    // Cap living plants; oldest sinks into the ground.
    this.enforceShroomLimit(sessionId, now);

    const cast = this.casts.get(sessionId);
    const aim =
      cast?.aimX != null && cast?.aimZ != null
        ? { x: cast.aimX, z: cast.aimZ }
        : undefined;
    const pos = clampGroundAim(
      ownerBody,
      aim,
      def.range > 0 ? def.range : SHROOM_CAST.range,
    );
    const triggerRadius = this.talentRadius(
      sessionId,
      def.id,
      Math.max(0.35, def.radius ?? SHROOM_CAST.triggerRadius),
    );
    const blastRadius = this.talentRadius(sessionId, def.id, SHROOM_CAST.blastRadius);
    const id = `shroom_${this.nextId++}`;
    const variant = this.nextId % 2;
    const expiresAt = now + Math.max(3000, def.zoneDurationMs ?? SHROOM_CAST.maxLifeMs);

    const st = new ShroomState();
    st.id = id;
    st.ownerSessionId = sessionId;
    st.x = pos.x;
    st.z = pos.z;
    st.yaw = ownerBody.yaw;
    st.triggerRadius = triggerRadius;
    st.blastRadius = blastRadius;
    st.stage = 1;
    st.variant = variant;
    st.armed = armed;
    st.phase = "alive";
    st.expiresAt = expiresAt;
    this.room.state.shrooms.set(id, st);

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: pos.x,
      z: pos.z,
      radius: triggerRadius,
      yaw: ownerBody.yaw,
      ownerId: sessionId,
      variant: 0,
      phaseEndsAt: expiresAt,
    });

    this.pendingShrooms.push({
      id,
      ownerId: sessionId,
      abilityId: def.id,
      x: pos.x,
      z: pos.z,
      yaw: ownerBody.yaw,
      triggerRadius,
      blastRadius,
      damage: def.damage,
      plantedAt: now,
      stage2At: now + SHROOM_CAST.stage2Ms,
      stage3At: now + SHROOM_CAST.stage3Ms,
      expiresAt,
      stage: 1,
      variant,
      armed,
      sinking: false,
      sinkEndsAt: 0,
    });
  }

  /** Keep at most `maxActive` living plants per owner (FIFO sink). */
  private enforceShroomLimit(ownerId: string, now: number) {
    const max = Math.max(1, SHROOM_CAST.maxActive);
    const living = this.pendingShrooms.filter(
      (z) => z.ownerId === ownerId && !z.sinking,
    );
    while (living.length >= max) {
      const oldest = living.shift();
      if (!oldest) break;
      this.beginShroomSink(oldest, now);
    }
  }

  private beginShroomSink(zone: PendingShroom, now: number) {
    if (zone.sinking) return;
    zone.sinking = true;
    zone.armed = false;
    zone.sinkEndsAt = now + SHROOM_CAST.sinkMs;
    const st = this.room.state.shrooms.get(zone.id);
    if (st) {
      st.phase = "sinking";
      st.armed = false;
    }
  }

  /** Cast impact: allow step triggers on the plant spawned at cast start. */
  private armShrooms(sessionId: string, now: number) {
    let armedAny = false;
    for (const zone of this.pendingShrooms) {
      if (zone.ownerId !== sessionId || zone.armed || zone.sinking) continue;
      zone.armed = true;
      const st = this.room.state.shrooms.get(zone.id);
      if (st) st.armed = true;
      armedAny = true;
    }
    // Fallback if plant never spawned (e.g. cast skipped anticipation→cast).
    if (!armedAny) {
      const player = this.room.state.players.get(sessionId);
      const def = ABILITIES.shrooms;
      if (player && def) {
        this.scheduleShroom(sessionId, this.playerBody(sessionId, player), def, now, true);
      }
    }
  }

  /** Cancel / interrupt before arm — remove the visual-only plant. */
  private clearUnarmedShrooms(ownerId: string) {
    if (this.pendingShrooms.length === 0) return;
    const remain: PendingShroom[] = [];
    for (const zone of this.pendingShrooms) {
      if (zone.ownerId === ownerId && !zone.armed && !zone.sinking) {
        this.room.state.shrooms.delete(zone.id);
        continue;
      }
      remain.push(zone);
    }
    this.pendingShrooms = remain;
  }

  /** Allies (same team / hub), self, and practice dummies for shroom heal burst. */
  private canShroomHealTarget(casterId: string, targetId: string): boolean {
    return this.canHealTarget(casterId, targetId, { allowSelf: true });
  }

  private triggerShroom(
    zone: PendingShroom,
    kind: "ally" | "enemy",
    triggerTargetId: string,
    now: number,
  ) {
    const bodies = this.collectBodies();
    this.fx({
      kind: "aoe",
      abilityId: zone.abilityId,
      x: zone.x,
      z: zone.z,
      // Ally heal is single-target; poison still uses the blast cloud.
      radius: kind === "ally" ? zone.triggerRadius : zone.blastRadius,
      ownerId: zone.ownerId,
      variant: kind === "ally" ? 1 : 2,
    });

    if (kind === "ally") {
      if (this.canShroomHealTarget(zone.ownerId, triggerTargetId)) {
        this.statuses.applyApplications(
          triggerTargetId,
          [{ statusId: "rejuvenated", chance: 1, stacks: zone.stage }],
          zone.ownerId,
          now,
        );
      }
    } else {
      const poisonR = SHROOM_CAST.poisonRadius;
      for (const body of bodies) {
        if (!this.canHurt(zone.ownerId, body.id)) continue;
        if (
          !circlesOverlap(
            zone.x,
            zone.z,
            poisonR,
            body.x,
            body.z,
            hitRadiusOf(body),
          )
        ) {
          continue;
        }
        // Burst contact can proc Counter / Revenge even when explode damage is 0.
        if (this.tryProcCounterOrRevenge(body.id, zone.ownerId, zone.abilityId, now)) {
          continue;
        }
        this.applyOutgoingStatusApps(
          body.id,
          [{ statusId: "poisoned", chance: 1 }],
          zone.ownerId,
          now,
        );
      }
    }

    this.room.state.shrooms.delete(zone.id);
  }

  private advancePendingShrooms(now: number) {
    if (this.pendingShrooms.length === 0) return;
    const remain: PendingShroom[] = [];
    const bodies = this.collectBodies();

    for (const zone of this.pendingShrooms) {
      const st = this.room.state.shrooms.get(zone.id);

      if (zone.sinking) {
        if (now >= zone.sinkEndsAt) {
          this.room.state.shrooms.delete(zone.id);
          continue;
        }
        remain.push(zone);
        continue;
      }

      if (now >= zone.expiresAt) {
        this.beginShroomSink(zone, now);
        remain.push(zone);
        continue;
      }

      if (zone.stage < 2 && now >= zone.stage2At) {
        zone.stage = 2;
        if (st) st.stage = 2;
      }
      if (zone.stage < 3 && now >= zone.stage3At) {
        zone.stage = 3;
        if (st) st.stage = 3;
      }

      if (!zone.armed) {
        remain.push(zone);
        continue;
      }

      let triggered: "ally" | "enemy" | null = null;
      let triggerTargetId: string | null = null;
      for (const body of bodies) {
        if (
          !circlesOverlap(
            zone.x,
            zone.z,
            zone.triggerRadius,
            body.x,
            body.z,
            hitRadiusOf(body),
          )
        ) {
          continue;
        }
        if (this.canHurt(zone.ownerId, body.id)) {
          triggered = "enemy";
          triggerTargetId = body.id;
          break;
        }
        if (this.canShroomHealTarget(zone.ownerId, body.id)) {
          triggered = "ally";
          triggerTargetId = body.id;
          break;
        }
      }

      if (triggered && triggerTargetId) {
        this.triggerShroom(zone, triggered, triggerTargetId, now);
        continue;
      }
      remain.push(zone);
    }

    this.pendingShrooms = remain;
  }

  private scheduleVolcano(
    sessionId: string,
    ownerBody: CombatBody,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    const aim =
      cast?.aimX != null && cast?.aimZ != null
        ? { x: cast.aimX, z: cast.aimZ }
        : undefined;
    const aimed = clampGroundAim(ownerBody, aim, def.range > 0 ? def.range : 10);
    const pos = clampTargetBeforeWalls(
      { x: ownerBody.x, z: ownerBody.z },
      aimed,
      0.35,
      this.wallColliders,
      this.circleColliders,
      this.boxColliders,
    );
    const collideRadius = this.talentRadius(
      sessionId,
      def.id,
      Math.max(0.5, def.radius ?? VOLCANO_CAST.collideRadius),
    );
    const blastRadius = this.talentRadius(sessionId, def.id, VOLCANO_CAST.rockBlastRadius);
    const durationMs = Math.max(1000, def.zoneDurationMs ?? VOLCANO_CAST.zoneDurationMs);
    const rockIntervalMs = Math.max(120, def.tickMs ?? VOLCANO_CAST.rockIntervalMs);
    const telegraphMs = VOLCANO_CAST.telegraphMs;
    const riseMs = VOLCANO_CAST.riseMs;
    const sinkMs = VOLCANO_CAST.sinkMs;
    const activeAt = now + riseMs;
    const activeEndsAt = activeAt + durationMs;
    const despawnAt = activeEndsAt + sinkMs;
    const id = `volcano_${this.nextId++}`;

    const st = new VolcanoState();
    st.id = id;
    st.ownerSessionId = sessionId;
    st.x = pos.x;
    st.z = pos.z;
    st.yaw = ownerBody.yaw;
    st.radius = collideRadius;
    st.phase = "rising";
    st.expiresAt = despawnAt;
    this.room.state.volcanoes.set(id, st);

    this.separateBodiesFromVolcano(pos, collideRadius);

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: pos.x,
      z: pos.z,
      radius: collideRadius,
      yaw: ownerBody.yaw,
      ownerId: sessionId,
      variant: 0,
    });

    this.pendingVolcanoes.push({
      id,
      ownerId: sessionId,
      abilityId: def.id,
      x: pos.x,
      z: pos.z,
      yaw: ownerBody.yaw,
      collideRadius,
      blastRadius,
      damage: def.damage,
      activeAt,
      activeEndsAt,
      despawnAt,
      nextRockAt: activeAt,
      rockIntervalMs,
      nextContactTickAt: now,
      contactTickMs: VOLCANO_CAST.contactTickMs,
      telegraphMs,
      ringMin: VOLCANO_CAST.rockRingMin,
      ringMax: VOLCANO_CAST.rockRingMax,
      seed: (Math.floor(pos.x * 1000) ^ Math.floor(pos.z * 1000) ^ now) >>> 0,
      rocks: [],
      phase: "rising",
    });
  }

  /** Push overlapping players/targets out of the volcano footprint (no knockback impulse). */
  private separateBodiesFromVolcano(center: Vec2, volcanoRadius: number) {
    const need = volcanoRadius + COLLISION.playerRadius + COLLISION.skin;
    const volcanoCol = {
      id: "volcano_spawn",
      shape: "circle" as const,
      x: center.x,
      z: center.z,
      radius: volcanoRadius,
    };

    this.room.state.players.forEach((p, id) => {
      if (p.disconnected || p.hp <= 0 || p.roundDead) return;
      const dist = Math.hypot(p.x - center.x, p.z - center.z);
      if (dist >= need - 1e-4) return;
      const pushed = resolveCollisions(
        { x: p.x, z: p.z },
        COLLISION.playerRadius,
        this.staticColliders,
        [
          volcanoCol,
          ...unitCollidersExcept(
            this.room.state.players.entries(),
            this.room.state.targets.entries(),
            id,
            p.id,
          ),
          ...volcanoColliders(this.room.state.volcanoes.entries()),
        ],
      );
      p.x = pushed.x;
      p.z = pushed.z;
    });

    this.room.state.targets.forEach((t) => {
      if (t.hp <= 0) return;
      // Map props stay at authored placement (mesh + static collider).
      if (t.kind === PROP_TARGET_KIND) return;
      const dist = Math.hypot(t.x - center.x, t.z - center.z);
      const dummyNeed = volcanoRadius + COLLISION.dummyRadius + COLLISION.skin;
      if (dist >= dummyNeed - 1e-4) return;
      const pushed = resolveCollisions(
        { x: t.x, z: t.z },
        COLLISION.dummyRadius,
        this.staticColliders,
        [volcanoCol, ...volcanoColliders(this.room.state.volcanoes.entries())],
      );
      t.x = pushed.x;
      t.z = pushed.z;
    });
  }

  private advancePendingVolcanoes(now: number) {
    if (this.pendingVolcanoes.length === 0) return;
    const remain: PendingVolcano[] = [];
    const bodies = this.collectBodies();

    for (const zone of this.pendingVolcanoes) {
      const st = this.room.state.volcanoes.get(zone.id);

      // Pressed against the cone: refresh burning (no contact damage).
      while (zone.nextContactTickAt <= now && zone.nextContactTickAt < zone.despawnAt) {
        const burn = ABILITIES[zone.abilityId]?.applyOnHit;
        if (burn?.length) {
          for (const body of bodies) {
            if (!this.canHurt(zone.ownerId, body.id)) continue;
            if (
              !circlesOverlap(
                zone.x,
                zone.z,
                zone.collideRadius,
                body.x,
                body.z,
                hitRadiusOf(body),
              )
            ) {
              continue;
            }
            this.applyOutgoingStatusApps(body.id, burn, zone.ownerId, now);
          }
        }
        zone.nextContactTickAt += zone.contactTickMs;
      }

      if (zone.phase === "rising" && now >= zone.activeAt) {
        zone.phase = "active";
        if (st) st.phase = "active";
      }

      if (zone.phase === "active") {
        while (zone.nextRockAt <= now && zone.nextRockAt < zone.activeEndsAt) {
          const rock = this.rollVolcanoRock(zone, zone.nextRockAt);
          zone.rocks.push(rock);
          zone.nextRockAt += zone.rockIntervalMs;
        }

        for (const rock of zone.rocks) {
          if (!rock.telegraphed && now >= rock.telegraphAt) {
            rock.telegraphed = true;
            this.fx({
              kind: "aoe",
              abilityId: zone.abilityId,
              x: rock.x,
              z: rock.z,
              x2: zone.x,
              z2: zone.z,
              radius: zone.blastRadius,
              ownerId: zone.ownerId,
              variant: 1,
              phaseEndsAt: rock.landAt,
            });
          }
          if (!rock.landed && now >= rock.landAt) {
            rock.landed = true;
            const hits = resolveInstantHits(
              { x: rock.x, z: rock.z },
              zone.blastRadius,
              zone.damage,
              zone.ownerId,
              bodies,
              (o, t) => this.canHurt(o, t),
            );
            for (const hit of hits) {
              this.applyDamage(hit.targetId, hit.damage, zone.ownerId, zone.abilityId, now, {
              directSpell: false,
            });
            }
            this.fx({
              kind: "aoe",
              abilityId: zone.abilityId,
              x: rock.x,
              z: rock.z,
              radius: zone.blastRadius,
              ownerId: zone.ownerId,
              variant: 2,
            });
          }
        }

        if (now >= zone.activeEndsAt) {
          zone.phase = "sinking";
          if (st) st.phase = "sinking";
        }
      }

      if (now >= zone.despawnAt) {
        this.room.state.volcanoes.delete(zone.id);
        continue;
      }
      remain.push(zone);
    }

    this.pendingVolcanoes = remain;
  }

  private rollVolcanoRock(zone: PendingVolcano, telegraphAt: number): PendingVolcanoRock {
    // xorshift-ish from seed + rock count
    zone.seed = (Math.imul(zone.seed, 1664525) + 1013904223) >>> 0;
    const u1 = (zone.seed >>> 0) / 4294967296;
    zone.seed = (Math.imul(zone.seed, 1664525) + 1013904223) >>> 0;
    const u2 = (zone.seed >>> 0) / 4294967296;
    const ang = u1 * Math.PI * 2;
    const dist = zone.ringMin + u2 * (zone.ringMax - zone.ringMin);
    return {
      x: zone.x + Math.sin(ang) * dist,
      z: zone.z + Math.cos(ang) * dist,
      telegraphAt,
      landAt: telegraphAt + zone.telegraphMs,
      telegraphed: false,
      landed: false,
    };
  }

  private scheduleFrostMist(sessionId: string, def: AbilityDef, now: number) {
    const ticks = Math.max(1, Math.floor(def.mistTicks ?? 14));
    const tickMs = Math.max(80, def.tickMs ?? 250);
    const growMs = Math.max(120, def.mistGrowMs ?? 180);
    const endRange = this.talentRadius(sessionId, def.id, Math.max(2, def.range));
    const startRange = Math.min(endRange, def.mistStartRange ?? endRange * 0.3);
    const halfEnd = def.coneHalfAngle ?? 0.7;
    this.pendingFrostMist.push({
      ownerId: sessionId,
      abilityId: def.id,
      startedAt: now,
      nextTickAt: now,
      tickIndex: 0,
      ticksTotal: ticks,
      tickMs,
      growMs,
      damage: def.damage,
      startRange,
      endRange,
      halfAngleStart: Math.max(0.2, halfEnd * 0.35),
      halfAngleEnd: halfEnd,
    });
  }

  private clearPendingFrostMist(ownerId: string) {
    if (this.pendingFrostMist.length === 0) return;
    this.pendingFrostMist = this.pendingFrostMist.filter((m) => m.ownerId !== ownerId);
  }

  private scheduleGrooveHeal(sessionId: string, def: AbilityDef, now: number) {
    this.clearPendingGrooveHeal(sessionId);
    const ticks = Math.max(1, Math.floor(def.healTicks ?? 1));
    const tickMs = Math.max(80, def.tickMs ?? 333);
    const channelMs = ticks * tickMs;
    this.statuses.apply(sessionId, "grooveGuard", sessionId, now, {
      durationMs: channelMs + 200,
    });
    this.pendingGrooveHeal.push({
      ownerId: sessionId,
      abilityId: def.id,
      nextTickAt: now,
      tickIndex: 0,
      ticksTotal: ticks,
      tickMs,
      heal: def.heal ?? 0,
      radius: def.radius ?? 7,
    });
  }

  private clearPendingGrooveHeal(ownerId: string) {
    this.statuses.remove(ownerId, "grooveGuard");
    if (this.pendingGrooveHeal.length === 0) return;
    this.pendingGrooveHeal = this.pendingGrooveHeal.filter((g) => g.ownerId !== ownerId);
  }

  private scheduleHealBeam(sessionId: string, def: AbilityDef, now: number) {
    this.clearPendingHealBeam(sessionId);
    const ticks = Math.max(1, Math.floor(def.healTicks ?? HEAL_BEAM_CAST.healTicks));
    const tickMs = Math.max(80, def.tickMs ?? HEAL_BEAM_CAST.healTickMs);
    this.pendingHealBeam.push({
      ownerId: sessionId,
      abilityId: def.id,
      nextTickAt: now,
      tickIndex: 0,
      ticksTotal: ticks,
      tickMs,
      heal: def.heal ?? HEAL_BEAM_CAST.healPerTick,
      range: Math.max(2, def.range),
      halfAngle: def.coneHalfAngle ?? HEAL_BEAM_CAST.beamHalfAngle,
    });
  }

  private clearPendingHealBeam(ownerId: string) {
    if (this.pendingHealBeam.length === 0) return;
    this.pendingHealBeam = this.pendingHealBeam.filter((b) => b.ownerId !== ownerId);
  }

  private scheduleLifeLeech(sessionId: string, def: AbilityDef, now: number) {
    this.clearPendingLifeLeech(sessionId);
    const hold = def.holdChannel === true;
    const ticks = hold
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, Math.floor(def.healTicks ?? LIFE_LEECH_CAST.damageTicks));
    const tickMs = Math.max(80, def.tickMs ?? LIFE_LEECH_CAST.tickMs);
    this.pendingLifeLeech.push({
      ownerId: sessionId,
      abilityId: def.id,
      nextTickAt: now,
      tickIndex: 0,
      hold,
      ticksTotal: ticks,
      tickMs,
      damage: def.damage ?? LIFE_LEECH_CAST.damagePerTick,
      healFrac: LIFE_LEECH_CAST.healFrac,
      range: Math.max(2, def.range),
      halfAngle: def.coneHalfAngle ?? LIFE_LEECH_CAST.beamHalfAngle,
    });
  }

  private clearPendingLifeLeech(ownerId: string) {
    if (this.pendingLifeLeech.length === 0) return;
    this.pendingLifeLeech = this.pendingLifeLeech.filter((b) => b.ownerId !== ownerId);
  }

  private scheduleArcThread(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
  ) {
    this.clearPendingArcThread(sessionId, "silent");
    const origin = { x: player.x, z: player.z };
    const range = Math.max(2, def.range);
    const halfAngle = ARC_THREAD_CAST.acquireHalfAngle;
    const hit = resolveFirstRayHit(
      origin,
      player.yaw,
      range,
      halfAngle,
      sessionId,
      this.collectBodies(),
      (o, tid) => this.canHurt(o, tid),
      {
        walls: this.wallColliders,
        circles: this.circleColliders,
        boxes: this.boxColliders,
        softOcclude: true,
      },
    );

    // Lock tether end to impact phase end so discharge lands with anim recovery.
    const liveCast = this.casts.get(sessionId);
    const fallbackMs = Math.max(
      120,
      def.threadDurationMs ?? ARC_THREAD_CAST.threadDurationMs,
    );
    const endsAt =
      liveCast?.phase === "impact" && liveCast.phaseEndsAt > now
        ? liveCast.phaseEndsAt
        : now + fallbackMs;

    if (!hit) {
      const maxLen = coneRayMaxLength(
        origin,
        player.yaw,
        range,
        this.wallColliders,
        this.collectBodies(),
        sessionId,
        {
          circles: this.circleColliders,
          boxes: this.boxColliders,
        },
      );
      this.fx({
        kind: "aoe",
        abilityId: def.id,
        x: player.x,
        z: player.z,
        x2: origin.x + Math.sin(player.yaw) * maxLen,
        z2: origin.z + Math.cos(player.yaw) * maxLen,
        yaw: player.yaw,
        ownerId: sessionId,
        radius: range,
        comboHit: 1,
        phaseEndsAt: endsAt,
      });
      return;
    }

    // Initial contact — damage only. Slow/discharge statuses wait for completion.
    this.applyRawDamage(hit.targetId, def.damage, sessionId, def.id);
    const tolDeg =
      def.threadAimToleranceDegrees ?? ARC_THREAD_CAST.threadAimToleranceDegrees;
    this.pendingArcThreads.push({
      ownerId: sessionId,
      targetId: hit.targetId,
      abilityId: def.id,
      startedAt: now,
      endsAt,
      nextCheckAt: now + ARC_THREAD_CAST.validateMs,
      range,
      aimToleranceRad: (tolDeg * Math.PI) / 180,
      secondaryDamage: def.secondaryDamage ?? 0,
    });

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: player.x,
      z: player.z,
      yaw: player.yaw,
      ownerId: sessionId,
      targetId: hit.targetId,
      radius: range,
      comboHit: 1,
      /** Absolute end time — client VFX life matches impact phase. */
      phaseEndsAt: endsAt,
    });
  }

  private clearPendingArcThread(
    ownerId: string,
    reason: "break" | "silent" = "silent",
  ) {
    if (this.pendingArcThreads.length === 0) return;
    if (reason === "break") {
      for (const t of this.pendingArcThreads) {
        if (t.ownerId !== ownerId) continue;
        const owner = this.room.state.players.get(ownerId);
        this.fx({
          kind: "aoe",
          abilityId: t.abilityId,
          x: owner?.x ?? 0,
          z: owner?.z ?? 0,
          yaw: owner?.yaw,
          ownerId,
          targetId: t.targetId,
          variant: 2,
        });
      }
    }
    this.pendingArcThreads = this.pendingArcThreads.filter((t) => t.ownerId !== ownerId);
  }

  private advancePendingArcThreads(now: number) {
    if (this.pendingArcThreads.length === 0) return;
    const remain: PendingArcThread[] = [];
    for (const thread of this.pendingArcThreads) {
      const owner = this.room.state.players.get(thread.ownerId);
      if (!owner || owner.disconnected || owner.hp <= 0) continue;

      if (now >= thread.endsAt) {
        this.completeArcThread(thread, now);
        continue;
      }

      if (now < thread.nextCheckAt) {
        remain.push(thread);
        continue;
      }

      if (!this.arcThreadStillValid(thread, owner)) {
        this.fx({
          kind: "aoe",
          abilityId: thread.abilityId,
          x: owner.x,
          z: owner.z,
          yaw: owner.yaw,
          ownerId: thread.ownerId,
          targetId: thread.targetId,
          variant: 2,
        });
        continue;
      }

      thread.nextCheckAt = now + ARC_THREAD_CAST.validateMs;
      remain.push(thread);
    }
    this.pendingArcThreads = remain;
  }

  private arcThreadStillValid(
    thread: PendingArcThread,
    owner: PlayerState,
  ): boolean {
    const body = this.collectBodies().find((b) => b.id === thread.targetId);
    if (!body || body.hp <= 0) return false;

    const dx = body.x - owner.x;
    const dz = body.z - owner.z;
    const dist = Math.hypot(dx, dz);
    if (dist > thread.range + hitRadiusOf(body)) return false;

    const toYaw = dist > 1e-6 ? Math.atan2(dx, dz) : owner.yaw;
    let diff = toYaw - owner.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > thread.aimToleranceRad) return false;

    const rayYaw = dist > 1e-6 ? toYaw : owner.yaw;
    const maxLen = coneRayMaxLength(
      { x: owner.x, z: owner.z },
      rayYaw,
      thread.range,
      this.wallColliders,
      this.collectBodies(),
      thread.ownerId,
      {
        excludeId: thread.targetId,
        circles: this.circleColliders,
        boxes: this.boxColliders,
      },
    );
    if (dist > maxLen + hitRadiusOf(body)) return false;
    return true;
  }

  private completeArcThread(thread: PendingArcThread, now: number) {
    const owner = this.room.state.players.get(thread.ownerId);
    if (!owner || owner.disconnected || owner.hp <= 0) return;
    if (!this.arcThreadStillValid(thread, owner)) {
      this.fx({
        kind: "aoe",
        abilityId: thread.abilityId,
        x: owner.x,
        z: owner.z,
        yaw: owner.yaw,
        ownerId: thread.ownerId,
        targetId: thread.targetId,
        variant: 2,
      });
      return;
    }

    const def = ABILITIES[thread.abilityId];
    if (thread.secondaryDamage > 0) {
      // applyDamage also applies def.applyOnHit (slow) on successful discharge.
      this.applyDamage(
        thread.targetId,
        thread.secondaryDamage,
        thread.ownerId,
        thread.abilityId,
        now,
      );
    } else if (def?.applyOnHit?.length) {
      this.applyOutgoingStatusApps(
        thread.targetId,
        def.applyOnHit,
        thread.ownerId,
        now,
      );
    }

    this.fx({
      kind: "aoe",
      abilityId: thread.abilityId,
      x: owner.x,
      z: owner.z,
      yaw: owner.yaw,
      ownerId: thread.ownerId,
      targetId: thread.targetId,
      variant: 1,
    });
  }

  private advancePendingLifeLeech(now: number) {
    if (this.pendingLifeLeech.length === 0) return;
    const remain: PendingLifeLeech[] = [];
    for (const beam of this.pendingLifeLeech) {
      if (now < beam.nextTickAt) {
        remain.push(beam);
        continue;
      }
      const owner = this.room.state.players.get(beam.ownerId);
      if (!owner || owner.disconnected || owner.hp <= 0) continue;

      this.fx({
        kind: "aoe",
        abilityId: beam.abilityId,
        x: owner.x,
        z: owner.z,
        radius: beam.range,
        yaw: owner.yaw,
        ownerId: beam.ownerId,
        /** 1 = channel start (client spawns the continuous beam once). */
        comboHit: beam.tickIndex + 1,
      });

      this.applyLifeLeechTick(
        { x: owner.x, z: owner.z },
        owner.yaw,
        beam.range,
        beam.halfAngle,
        beam.damage,
        beam.healFrac,
        beam.ownerId,
        beam.abilityId,
      );

      beam.tickIndex += 1;
      if (beam.hold || beam.tickIndex < beam.ticksTotal) {
        beam.nextTickAt = now + beam.tickMs;
        remain.push(beam);
      }
    }
    this.pendingLifeLeech = remain;
  }

  /**
   * Damage enemies in a narrow facing cone; heal caster for a fraction of
   * post-resist damage (including shield absorb). Soft-occludes like Heal Beam.
   */
  private applyLifeLeechTick(
    origin: { x: number; z: number },
    yaw: number,
    range: number,
    halfAngle: number,
    damage: number,
    healFrac: number,
    casterId: string,
    abilityId: string,
  ) {
    if (!(damage > 0) || !(range > 0)) return;
    const hits = resolveConeHits(
      origin,
      yaw,
      range,
      halfAngle,
      damage,
      casterId,
      this.collectBodies(),
      (o, tid) => this.canHurt(o, tid),
      { walls: this.wallColliders, circles: this.circleColliders, boxes: this.boxColliders, softOcclude: true },
    );
    let totalDealt = 0;
    for (const hit of hits) {
      totalDealt += this.applyRawDamage(hit.targetId, hit.damage, casterId, abilityId);
    }
    if (!(totalDealt > 0) || !(healFrac > 0)) return;
    const heal = Math.max(0, Math.floor(totalDealt * healFrac));
    if (!(heal > 0)) return;
    // Derived from damage already rolled — no second crit.
    const caster = this.room.state.players.get(casterId);
    if (!caster || caster.disconnected || caster.hp <= 0) return;
    const before = caster.hp;
    caster.hp = Math.min(caster.maxHp, caster.hp + heal);
    const restored = caster.hp - before;
    const now = Date.now();
    this.tryProcOverflow(casterId, casterId, heal - restored, caster.maxHp, abilityId, now);
    if (restored > 0) {
      caster.statHealing += restored;
      // Bypasses applyHealAmount (the damage roll already happened), so the
      // energy credit has to be repeated here rather than inherited.
      this.grantEnergy(casterId, "healingDone", restored, abilityId);
      this.fx({
        kind: "hit",
        abilityId,
        x: caster.x,
        z: caster.z,
        damage: restored,
        ownerId: casterId,
        targetId: casterId,
      });
    }
  }

  private advancePendingHealBeam(now: number) {
    if (this.pendingHealBeam.length === 0) return;
    const remain: PendingHealBeam[] = [];
    for (const beam of this.pendingHealBeam) {
      if (now < beam.nextTickAt) {
        remain.push(beam);
        continue;
      }
      const owner = this.room.state.players.get(beam.ownerId);
      if (!owner || owner.disconnected || owner.hp <= 0) continue;

      this.fx({
        kind: "aoe",
        abilityId: beam.abilityId,
        x: owner.x,
        z: owner.z,
        radius: beam.range,
        yaw: owner.yaw,
        ownerId: beam.ownerId,
        /** 1 = channel start (client spawns the continuous beam once). */
        comboHit: beam.tickIndex + 1,
      });

      this.applyHealBeamTick(
        { x: owner.x, z: owner.z },
        owner.yaw,
        beam.range,
        beam.halfAngle,
        beam.heal,
        beam.ownerId,
        beam.abilityId,
      );

      beam.tickIndex += 1;
      if (beam.tickIndex < beam.ticksTotal) {
        beam.nextTickAt = now + beam.tickMs;
        remain.push(beam);
      }
    }
    this.pendingHealBeam = remain;
  }

  /**
   * Heal allies + practice dummies in a narrow facing cone (not enemies).
   * Walls and units soft-occlude like Frost Mist — beam does not pierce.
   */
  private applyHealBeamTick(
    origin: { x: number; z: number },
    yaw: number,
    range: number,
    halfAngle: number,
    amount: number,
    casterId: string,
    abilityId: string,
  ) {
    if (!(amount > 0) || !(range > 0)) return;
    const hits = resolveConeHits(
      origin,
      yaw,
      range,
      halfAngle,
      amount,
      casterId,
      this.collectBodies(),
      (o, tid) => this.canHealBeamTarget(o, tid),
      { walls: this.wallColliders, circles: this.circleColliders, boxes: this.boxColliders, softOcclude: true },
    );
    for (const hit of hits) {
      this.applyHealAmount(hit.targetId, amount, casterId, abilityId);
    }
  }

  /**
   * Allies (same team / hub) and practice dummies — never enemies.
   * Hub unteamed players remain healable.
   */
  private canHealTarget(casterId: string, targetId: string, opts?: { allowSelf?: boolean }): boolean {
    if (casterId === targetId) return Boolean(opts?.allowSelf);
    if (this.room.state.targets.has(targetId)) return true;
    const player = this.room.state.players.get(targetId);
    if (!player || player.disconnected || player.hp <= 0) return false;
    if (player.role === "spectator" || player.roundDead) return false;
    const caster = this.room.state.players.get(casterId);
    if (caster?.team && player.team && caster.team !== player.team) return false;
    return true;
  }

  private canHealBeamTarget(casterId: string, targetId: string): boolean {
    return this.canHealTarget(casterId, targetId);
  }

  private advancePendingGrooveHeal(now: number) {
    if (this.pendingGrooveHeal.length === 0) return;
    const remain: PendingGrooveHeal[] = [];
    for (const groove of this.pendingGrooveHeal) {
      if (now < groove.nextTickAt) {
        remain.push(groove);
        continue;
      }
      const owner = this.room.state.players.get(groove.ownerId);
      if (!owner || owner.disconnected || owner.hp <= 0) {
        this.statuses.remove(groove.ownerId, "grooveGuard");
        continue;
      }
      this.applyGrooveHealPulse(
        { x: owner.x, z: owner.z },
        groove.radius,
        groove.heal,
        groove.ownerId,
        groove.abilityId,
        now,
      );
      groove.tickIndex += 1;
      if (groove.tickIndex < groove.ticksTotal) {
        groove.nextTickAt = now + groove.tickMs;
        remain.push(groove);
      } else {
        this.statuses.remove(groove.ownerId, "grooveGuard");
      }
    }
    this.pendingGrooveHeal = remain;
  }

  private advancePendingDelayedAoes(now: number) {
    if (this.pendingDelayedAoes.length === 0) return;
    const remain: PendingDelayedAoe[] = [];
    for (const zone of this.pendingDelayedAoes) {
      if (now < zone.explodeAt) {
        remain.push(zone);
        continue;
      }
      // Single pulse — no second FX; place VFX owns the detonation timeline.
      this.applyInstant(
        { x: zone.x, z: zone.z },
        zone.radius,
        zone.damage,
        zone.ownerId,
        zone.abilityId,
        now,
      );
    }
    this.pendingDelayedAoes = remain;
  }

  private advancePendingSpikes(now: number) {
    if (this.pendingSpikes.length === 0) return;
    const remain: PendingSpike[] = [];
    for (const spike of this.pendingSpikes) {
      if (now < spike.fireAt) {
        remain.push(spike);
        continue;
      }
      this.fx({
        kind: "aoe",
        abilityId: spike.abilityId,
        x: spike.x,
        z: spike.z,
        radius: spike.radius,
        ownerId: spike.ownerId,
      });
      const hits = resolveInstantHits(
        { x: spike.x, z: spike.z },
        spike.radius,
        spike.damage,
        spike.ownerId,
        this.collectBodies(),
        (o, t) => this.canHurt(o, t),
      );
      for (const hit of hits) {
        if (spike.hitIds.has(hit.targetId)) continue;
        spike.hitIds.add(hit.targetId);
        this.applyDamage(hit.targetId, hit.damage, spike.ownerId, spike.abilityId, now);
      }
    }
    this.pendingSpikes = remain;
  }

  private advancePendingArcBladeHits(now: number) {
    if (this.pendingArcBladeHits.length === 0) return;
    const remain: PendingArcBladeHit[] = [];
    for (const hit of this.pendingArcBladeHits) {
      if (now < hit.fireAt) {
        remain.push(hit);
        continue;
      }
      const owner = this.room.state.players.get(hit.ownerId);
      if (!owner || owner.hp <= 0) continue;
      this.applyInstant(
        { x: owner.x, z: owner.z },
        hit.radius,
        arcBladeHitDamage(hit.hitIndex),
        hit.ownerId,
        hit.abilityId,
        now,
      );
    }
    this.pendingArcBladeHits = remain;
  }

  private beginBloomingPathZone(
    projectileId: string,
    sim: ProjectileSim,
    def: AbilityDef,
    now: number,
  ) {
    const originX = sim.spawnX ?? sim.x;
    const originZ = sim.spawnZ ?? sim.z;
    this.pendingBloomingPaths.push({
      ownerId: sim.ownerId,
      abilityId: sim.abilityId,
      projectileId,
      originX,
      originZ,
      tipX: sim.x,
      tipZ: sim.z,
      halfWidth: Math.max(0.25, def.radius ?? BLOOMING_PATH_CAST.radius),
      heal: def.heal ?? BLOOMING_PATH_CAST.heal,
      nextTickAt: now,
      tickMs: Math.max(120, def.tickMs ?? BLOOMING_PATH_CAST.healTickMs),
      expiresAt: null,
    });
  }

  private finalizeBloomingPathZone(
    projectileId: string,
    tipX: number,
    tipZ: number,
    now: number,
  ) {
    const linger = Math.max(
      400,
      ABILITIES.bloomingPath?.zoneDurationMs ?? BLOOMING_PATH_CAST.trailLingerMs,
    );
    for (const zone of this.pendingBloomingPaths) {
      if (zone.projectileId !== projectileId) continue;
      zone.projectileId = null;
      zone.tipX = tipX;
      zone.tipZ = tipZ;
      zone.expiresAt = now + linger;
    }
  }

  private advancePendingBloomingPaths(now: number) {
    if (this.pendingBloomingPaths.length === 0) return;
    const remain: PendingBloomingPath[] = [];
    const bodies = this.collectBodies();

    for (const zone of this.pendingBloomingPaths) {
      if (zone.projectileId) {
        const sim = this.sims.get(zone.projectileId);
        if (sim) {
          zone.tipX = sim.x;
          zone.tipZ = sim.z;
        }
      }

      const expired = zone.expiresAt != null && now >= zone.expiresAt;
      if (expired) continue;

      const dx = zone.tipX - zone.originX;
      const dz = zone.tipZ - zone.originZ;
      const length = Math.max(0.35, Math.hypot(dx, dz));
      const yaw = Math.atan2(dx, dz);

      while (zone.nextTickAt <= now && (zone.expiresAt == null || zone.nextTickAt < zone.expiresAt)) {
        for (const body of bodies) {
          if (!this.canHealTarget(zone.ownerId, body.id, { allowSelf: true })) continue;
          if (
            !pointInSlipstreamLane(
              {
                originX: zone.originX,
                originZ: zone.originZ,
                yaw,
                length,
                halfWidth: zone.halfWidth,
              },
              { x: body.x, z: body.z },
            )
          ) {
            continue;
          }
          this.applyHealAmount(body.id, zone.heal, zone.ownerId, zone.abilityId);
        }
        zone.nextTickAt += zone.tickMs;
      }

      remain.push(zone);
    }

    this.pendingBloomingPaths = remain;
  }

  /** Soft-target living ally or practice dummy (no self) closest to aim within range + forward cone. */
  private findAllyAimTarget(
    casterId: string,
    caster: PlayerState,
    range: number,
    aim: { x: number; z: number } | null,
  ): string | null {
    const pick = this.findVerdantLeapAimTarget(casterId, caster, range, aim);
    if (!pick?.inRange || pick.id === casterId) return null;
    return pick.id;
  }

  /**
   * Soft-target Verdant Leap — healable closest to aim, including the caster
   * (Soul Relay style). Self competing means aim-at-feet is solo cast, not a
   * false OOR lock on a far dummy. Ally/dummy OOR locks still refuse.
   */
  private findVerdantLeapAimTarget(
    casterId: string,
    caster: PlayerState,
    range: number,
    aim: { x: number; z: number } | null,
  ): { id: string; inRange: boolean } | null {
    const fx = Math.sin(caster.yaw);
    const fz = Math.cos(caster.yaw);
    const aimX = aim?.x ?? caster.x;
    const aimZ = aim?.z ?? caster.z;
    let bestId: string | null = null;
    let bestAimDist = Infinity;
    let bestCasterDist = 0;

    const consider = (id: string, x: number, z: number, requireCone: boolean) => {
      const dx = x - caster.x;
      const dz = z - caster.z;
      const casterDist = Math.hypot(dx, dz);
      if (requireCone) {
        if (casterDist < 0.05) return;
        const dot = (dx * fx + dz * fz) / casterDist;
        // ~60° forward cone (matches Soul Relay)
        if (dot < 0.5) return;
      }
      const aimDist = Math.hypot(x - aimX, z - aimZ);
      if (
        aimDist < bestAimDist - 1e-4 ||
        (Math.abs(aimDist - bestAimDist) <= 1e-4 && casterDist < bestCasterDist)
      ) {
        bestAimDist = aimDist;
        bestId = id;
        bestCasterDist = casterDist;
      }
    };

    // Caster always competes — aiming near your feet is solo cast, not OOR.
    consider(casterId, caster.x, caster.z, false);

    for (const [id, p] of this.room.state.players) {
      if (id === casterId) continue;
      if (p.disconnected || p.hp <= 0 || p.role === "spectator" || p.roundDead) continue;
      if (!this.canHealTarget(casterId, id)) continue;
      consider(id, p.x, p.z, true);
    }
    for (const [id, t] of this.room.state.targets) {
      if (t.hp <= 0) continue;
      if (!this.canHealTarget(casterId, id)) continue;
      consider(id, t.x, t.z, true);
    }

    if (!bestId) return null;
    return { id: bestId, inRange: bestCasterDist <= range + 0.05 };
  }

  /** Soft-target hurt-able enemy closest to aim within range + forward cone. */
  private findEnemyAimTarget(
    casterId: string,
    caster: PlayerState,
    range: number,
    aim: { x: number; z: number } | null,
  ): string | null {
    const fx = Math.sin(caster.yaw);
    const fz = Math.cos(caster.yaw);
    const aimX = aim?.x ?? caster.x + fx * range;
    const aimZ = aim?.z ?? caster.z + fz * range;
    let bestId: string | null = null;
    let bestAimDist = Infinity;
    let bestCasterDist = Infinity;

    const consider = (id: string, x: number, z: number) => {
      if (!this.canHurt(casterId, id)) return;
      const dx = x - caster.x;
      const dz = z - caster.z;
      const casterDist = Math.hypot(dx, dz);
      if (casterDist > range + 0.05 || casterDist < 0.05) return;
      const dot = (dx * fx + dz * fz) / casterDist;
      if (dot < 0.5) return;
      const aimDist = Math.hypot(x - aimX, z - aimZ);
      if (
        aimDist < bestAimDist - 1e-4 ||
        (Math.abs(aimDist - bestAimDist) <= 1e-4 && casterDist < bestCasterDist)
      ) {
        bestAimDist = aimDist;
        bestId = id;
        bestCasterDist = casterDist;
      }
    };

    for (const [id, p] of this.room.state.players) {
      if (id === casterId) continue;
      if (p.disconnected || p.hp <= 0 || p.role === "spectator" || p.roundDead) continue;
      consider(id, p.x, p.z);
    }
    for (const [id, t] of this.room.state.targets) {
      if (t.hp <= 0) continue;
      consider(id, t.x, t.z);
    }
    return bestId;
  }

  private bodyPos(id: string): { x: number; z: number } | null {
    const p = this.room.state.players.get(id);
    if (p && !p.disconnected && p.hp > 0) return { x: p.x, z: p.z };
    const t = this.room.state.targets.get(id);
    if (t && t.hp > 0) return { x: t.x, z: t.z };
    return null;
  }

  /**
   * Bulwark Charge frontal ward — block when the damage source sits in the
   * forward half-plane of the charger’s facing (±90°).
   */
  private bulwarkBlocksIncoming(targetId: string, attackerSessionId: string): boolean {
    if (!this.statuses.has(targetId, "bulwarkCharging")) return false;
    const defender = this.room.state.players.get(targetId);
    if (!defender || defender.hp <= 0) return false;
    const src = this.bodyPos(attackerSessionId);
    if (!src) return false;
    const half = BULWARK_CHARGE_CAST.blockHalfAngle;
    return Math.abs(angleFromFacing({ x: defender.x, z: defender.z }, defender.yaw, src)) <= half;
  }

  /** Point along from→target stopping `stopDistance` short of the target, wall-clamped. */
  private pointNearBody(
    targetId: string,
    from: { x: number; z: number },
    stopDistance: number,
  ): { x: number; z: number } | null {
    const body = this.bodyPos(targetId);
    if (!body) return null;
    const dx = body.x - from.x;
    const dz = body.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return { x: from.x, z: from.z };
    const travel = Math.max(0, len - Math.max(0.4, stopDistance));
    const ideal = {
      x: from.x + (dx / len) * travel,
      z: from.z + (dz / len) * travel,
    };
    return this.sweepPlayerPos("", from, ideal);
  }

  private scheduleDirectionalTravel(
    sessionId: string,
    abilityId: string,
    yaw: number,
    distance: number,
    durationMs: number,
    now: number,
    opts?: { spaceArrive?: ActiveTravel["spaceArrive"]; followTargetId?: string; stopDistance?: number },
  ) {
    const player = this.room.state.players.get(sessionId);
    if (!player) return;
    const from = { x: player.x, z: player.z };
    const ideal = sampleTravel(from, yaw, Math.max(0, distance), 1);
    const clamped = this.sweepPlayerPos(sessionId, from, ideal);
    const actual = Math.hypot(clamped.x - from.x, clamped.z - from.z);
    const scale = distance > 1e-6 ? Math.min(1, actual / distance) : 0;
    const travelDist = distance * scale;
    const travelDur = Math.max(16, durationMs * Math.max(0.05, scale || 1));
    this.travels.delete(sessionId);
    this.travels.set(sessionId, {
      abilityId,
      fromX: from.x,
      fromZ: from.z,
      yaw,
      distance: travelDist,
      startAt: now,
      endAt: now + travelDur,
      lastX: from.x,
      lastZ: from.z,
      spaceArrive: opts?.spaceArrive,
      followTargetId: opts?.followTargetId,
      stopDistance: opts?.stopDistance,
      pathHitIds: opts?.spaceArrive === "bulwarkCharge" ? new Set() : undefined,
    });
    this.fx({
      kind: "dash",
      abilityId,
      x: from.x,
      z: from.z,
      x2: clamped.x,
      z2: clamped.z,
      yaw,
      ownerId: sessionId,
      phaseEndsAt: now + travelDur,
    });
  }

  private schedulePointTravel(
    sessionId: string,
    abilityId: string,
    to: { x: number; z: number },
    durationMs: number,
    now: number,
    opts?: { spaceArrive?: ActiveTravel["spaceArrive"]; followTargetId?: string; stopDistance?: number },
  ) {
    const player = this.room.state.players.get(sessionId);
    if (!player) return;
    const from = { x: player.x, z: player.z };
    const clamped = this.sweepPlayerPos(sessionId, from, to);
    const dx = clamped.x - from.x;
    const dz = clamped.z - from.z;
    const dist = Math.hypot(dx, dz);
    const yaw = dist > 1e-4 ? Math.atan2(dx, dz) : player.yaw;
    this.travels.delete(sessionId);
    this.travels.set(sessionId, {
      abilityId,
      fromX: from.x,
      fromZ: from.z,
      yaw,
      distance: dist,
      startAt: now,
      endAt: now + Math.max(16, durationMs),
      lastX: from.x,
      lastZ: from.z,
      spaceArrive: opts?.spaceArrive,
      followTargetId: opts?.followTargetId,
      stopDistance: opts?.stopDistance,
    });
    this.fx({
      kind: "dash",
      abilityId,
      x: from.x,
      z: from.z,
      x2: clamped.x,
      z2: clamped.z,
      yaw,
      ownerId: sessionId,
      phaseEndsAt: now + Math.max(16, durationMs),
    });
  }

  private commitVerdantLeap(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    const aim =
      cast?.aimX != null &&
      cast?.aimZ != null &&
      Number.isFinite(cast.aimX) &&
      Number.isFinite(cast.aimZ)
        ? { x: cast.aimX, z: cast.aimZ }
        : null;
    const range = def.range || VERDANT_LEAP_CAST.range;
    const pick = this.findVerdantLeapAimTarget(sessionId, player, range, aim);

    // Soft-locked ally/dummy out of range — refuse so the red ring is readable.
    if (pick && pick.id !== sessionId && !pick.inRange) {
      this.fx({
        kind: "aoe",
        abilityId: def.id,
        x: player.x,
        z: player.z,
        ownerId: sessionId,
        radius: range,
        variant: 3,
      });
      this.lastFireCommitted = false;
      return;
    }

    const allyId =
      pick && pick.id !== sessionId && pick.inRange ? pick.id : null;

    if (allyId) {
      const dest = this.pointNearBody(
        allyId,
        { x: player.x, z: player.z },
        VERDANT_LEAP_CAST.arrivalDistanceFromTarget,
      );
      if (!dest) {
        this.lastFireCommitted = false;
        return;
      }
      // Stamp so clients play crouch→sprint only for ally leaps (not solo heal).
      player.castComboHit = 1;
      this.schedulePointTravel(
        sessionId,
        def.id,
        dest,
        VERDANT_LEAP_CAST.travelDurationMs,
        now,
        {
          spaceArrive: "verdantLeap",
          followTargetId: allyId,
          stopDistance: VERDANT_LEAP_CAST.arrivalDistanceFromTarget,
        },
      );
      return;
    }

    // Solo fallback: no leap — self-heal + haste in place (keep walking).
    if (cast) cast.verdantSoloImpactMs = 90;
    this.finishVerdantLeap(sessionId, undefined, now);
  }

  private finishVerdantLeap(sessionId: string, allyId: string | undefined, now: number) {
    const duo = Boolean(allyId && this.canHealTarget(sessionId, allyId));
    const heal = ABILITIES.verdantLeap?.heal ?? VERDANT_LEAP_CAST.heal;
    this.applyHealAmount(sessionId, heal, sessionId, "verdantLeap");
    if (duo && allyId) {
      this.applyHealAmount(allyId, heal, sessionId, "verdantLeap");
    }
    const dur = VERDANT_LEAP_CAST.moveSpeedDurationMs;
    this.statuses.apply(sessionId, "verdantHaste", sessionId, now, { durationMs: dur });
    if (duo && allyId) {
      this.statuses.apply(allyId, "verdantHaste", sessionId, now, { durationMs: dur });
    }
    const player = this.room.state.players.get(sessionId);
    if (player) {
      this.fx({
        kind: "aoe",
        abilityId: "verdantLeap",
        x: player.x,
        z: player.z,
        ownerId: sessionId,
        variant: 1,
        radius: 1.2,
      });
    }
    if (duo && allyId) {
      const ally = this.bodyPos(allyId);
      if (ally) {
        this.fx({
          kind: "hit",
          abilityId: "verdantLeap",
          x: ally.x,
          z: ally.z,
          ownerId: sessionId,
          targetId: allyId,
          damage: heal,
          variant: 1,
        });
      }
    }
  }

  private commitBulwarkCharge(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    const yaw = cast?.yaw ?? player.yaw;
    const dist = BULWARK_CHARGE_CAST.distance;
    const dur = BULWARK_CHARGE_CAST.travelDurationMs;
    this.statuses.apply(sessionId, "bulwarkCharging", sessionId, now, {
      durationMs: dur + 80,
    });
    this.scheduleDirectionalTravel(sessionId, def.id, yaw, dist, dur, now, {
      spaceArrive: "bulwarkCharge",
    });
  }

  private finishBulwarkCharge(sessionId: string, now: number) {
    this.statuses.remove(sessionId, "bulwarkCharging");
    const shield = ABILITIES.bulwarkCharge?.shield ?? BULWARK_CHARGE_CAST.shield;
    const shieldDur =
      ABILITIES.bulwarkCharge?.shieldDurationMs ?? BULWARK_CHARGE_CAST.shieldDurationMs;
    this.statuses.apply(sessionId, "bulwarkShield", sessionId, now, {
      durationMs: shieldDur,
      stacks: shield,
      setStacks: true,
    });
  }

  private commitPredatorCloak(sessionId: string, now: number) {
    this.statuses.apply(sessionId, "cloaked", sessionId, now, {
      durationMs: PREDATOR_STEP_CAST.invisibilityDurationMs,
    });
    this.statuses.apply(sessionId, "predatorHaste", sessionId, now, {
      durationMs: PREDATOR_STEP_CAST.moveSpeedDurationMs,
    });
  }

  private commitPredatorStep(sessionId: string, _player: PlayerState, _def: AbilityDef, now: number) {
    // Refresh cloak/haste on impact (applied at cast begin; no travel).
    this.commitPredatorCloak(sessionId, now);
  }

  private finishPredatorStep(sessionId: string, now: number) {
    this.commitPredatorCloak(sessionId, now);
  }

  private commitRebound(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    const yaw = cast?.yaw ?? player.yaw;
    const origin = { x: player.x, z: player.z };
    const range = def.radius ?? REBOUND_CAST.coneRange;
    const half = def.coneHalfAngle ?? (REBOUND_CAST.coneAngleDeg * Math.PI) / 180 / 2;
    const damage = def.damage ?? REBOUND_CAST.damage;
    const push = def.knockback ?? REBOUND_CAST.enemyPushDistance;
    const pushMs = def.knockbackMs ?? REBOUND_CAST.displacementDurationMs;

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: origin.x,
      z: origin.z,
      yaw,
      radius: range,
      ownerId: sessionId,
    });

    for (const body of this.collectBodies()) {
      if (body.id === sessionId) continue;
      if (body.hp <= 0 || body.vulnerable === false) continue;
      if (!this.canHurt(sessionId, body.id)) continue;
      if (!inFacingCone(origin, yaw, range, half, body)) continue;
      this.applyDamage(body.id, damage, sessionId, def.id, now);
      this.applyKnockback(origin, body.id, push, pushMs, now);
    }

    const recoilYaw = yaw + Math.PI;
    this.scheduleDirectionalTravel(
      sessionId,
      def.id,
      recoilYaw,
      REBOUND_CAST.selfRecoilDistance,
      REBOUND_CAST.displacementDurationMs,
      now,
    );
  }

  private commitTeleportSlam(
    sessionId: string,
    player: PlayerState,
    def: AbilityDef,
    now: number,
  ) {
    const cast = this.casts.get(sessionId);
    const yaw = cast?.yaw ?? player.yaw;
    const center = { x: player.x, z: player.z };
    const radius = def.radius ?? TELEPORT_SLAM_CAST.slamRadius;
    const damage = def.damage ?? TELEPORT_SLAM_CAST.damage;

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: center.x,
      z: center.z,
      radius,
      ownerId: sessionId,
      variant: 0,
    });

    const hits = resolveInstantHits(
      center,
      radius,
      damage,
      sessionId,
      this.collectBodies(),
      (o, t) => this.canHurt(o, t),
    );
    for (const hit of hits) {
      this.applyDamage(hit.targetId, hit.damage, sessionId, def.id, now);
      this.statuses.applyApplications(
        hit.targetId,
        def.applyOnHit ?? [
          { statusId: "stunned", durationMs: TELEPORT_SLAM_CAST.stunMs, chance: 1 },
        ],
        sessionId,
        now,
      );
    }

    this.pendingTeleportSlamBlinks.push({
      fireAt: now + TELEPORT_SLAM_CAST.teleportDelayAfterImpactMs,
      ownerId: sessionId,
      abilityId: def.id,
      yaw,
      distance: TELEPORT_SLAM_CAST.teleportDistance,
    });
  }

  private advancePendingTeleportSlamBlinks(now: number) {
    if (this.pendingTeleportSlamBlinks.length === 0) return;
    const remain: PendingTeleportSlamBlink[] = [];
    for (const blink of this.pendingTeleportSlamBlinks) {
      if (now < blink.fireAt) {
        remain.push(blink);
        continue;
      }
      const player = this.room.state.players.get(blink.ownerId);
      if (!player || player.disconnected || player.hp <= 0) continue;
      const def = ABILITIES[blink.abilityId] ?? ABILITIES.teleportSlam;
      if (!def) continue;
      // Snap along stored aim yaw (not live facing) — slam already resolved.
      const from = { x: player.x, z: player.z };
      const off = dashOffset(blink.yaw, blink.distance);
      const clamped = this.sweepPlayerPos(blink.ownerId, from, {
        x: player.x + off.x,
        z: player.z + off.z,
      });
      player.x = clamped.x;
      player.z = clamped.z;
      this.fx({
        kind: "portal",
        abilityId: blink.abilityId,
        x: from.x,
        z: from.z,
        x2: clamped.x,
        z2: clamped.z,
        yaw: blink.yaw,
        ownerId: blink.ownerId,
      });
      // Soft shift rematerialize — no purple pop sphere.
    }
    this.pendingTeleportSlamBlinks = remain;
  }

  private advancePendingSilenceSweeps(now: number) {
    if (this.pendingSilenceSweeps.length === 0) return;
    const remain: PendingSilenceSweep[] = [];
    const bodies = this.collectBodies();
    for (const sweep of this.pendingSilenceSweeps) {
      if (now >= sweep.expiresAt) continue;
      const dur = Math.max(1, sweep.expiresAt - sweep.startAt);
      // Right (−half) → left (+half): angleFromFacing is positive to the left.
      const u = Math.min(1, Math.max(0, (now - sweep.startAt) / dur));
      const bladeYaw = sweep.yaw + sweep.coneHalfAngle * (2 * u - 1);
      const origin = { x: sweep.x, z: sweep.z };
      const def = ABILITIES[sweep.abilityId];
      const apps = def?.applyOnHit;
      if (!apps?.length) {
        remain.push(sweep);
        continue;
      }
      for (const body of bodies) {
        if (body.id === sweep.ownerId) continue;
        if (body.vulnerable === false) continue;
        if (body.hp <= 0) continue;
        if (!this.canHurt(sweep.ownerId, body.id)) continue;
        if (sweep.hitIds.has(body.id)) continue;
        if (!inFacingCone(origin, sweep.yaw, sweep.range, sweep.coneHalfAngle, body)) {
          continue;
        }
        if (!inFacingCone(origin, bladeYaw, sweep.range, sweep.bladeHalfAngle, body)) {
          continue;
        }
        // Extra guard: keep hits inside the authored frontal cone by facing angle.
        const ang = angleFromFacing(origin, sweep.yaw, body);
        if (Math.abs(ang) > sweep.coneHalfAngle + 0.2) continue;
        sweep.hitIds.add(body.id);
        this.applyOutgoingStatusApps(body.id, apps, sweep.ownerId, now);
      }
      remain.push(sweep);
    }
    this.pendingSilenceSweeps = remain;
  }

  private advancePendingFrostMist(now: number) {
    if (this.pendingFrostMist.length === 0) return;
    const remain: PendingFrostMist[] = [];
    for (const mist of this.pendingFrostMist) {
      if (now < mist.nextTickAt) {
        remain.push(mist);
        continue;
      }
      const owner = this.room.state.players.get(mist.ownerId);
      if (!owner || owner.hp <= 0) continue;

      // Linear grow so ground + storm advance evenly, then hold full cone.
      const t = Math.min(1, Math.max(0, (now - mist.startedAt) / mist.growMs));
      const length = mist.startRange + (mist.endRange - mist.startRange) * t;
      const halfAngle =
        mist.halfAngleStart + (mist.halfAngleEnd - mist.halfAngleStart) * t;

      this.fx({
        kind: "aoe",
        abilityId: mist.abilityId,
        x: owner.x,
        z: owner.z,
        radius: length,
        yaw: owner.yaw,
        ownerId: mist.ownerId,
        /** 1 = channel start (client spawns the continuous cone once). */
        comboHit: mist.tickIndex + 1,
      });

      const hits = resolveConeHits(
        { x: owner.x, z: owner.z },
        owner.yaw,
        length,
        halfAngle,
        mist.damage,
        mist.ownerId,
        this.collectBodies(),
        (o, tid) => this.canHurt(o, tid),
        { walls: this.wallColliders, circles: this.circleColliders, boxes: this.boxColliders, softOcclude: true },
      );
      for (const hit of hits) {
        // Mist is multi-tick — Counter/Revenge stay armed for the window so every tick denies.
        if (this.tryProcCounterOrRevenge(hit.targetId, mist.ownerId, mist.abilityId, now)) {
          continue;
        }
        this.applyRawDamage(hit.targetId, hit.damage, mist.ownerId, mist.abilityId, {
          triggersCounter: false,
        });
        const baseSlowPct = this.statuses.getSlowPercent(hit.targetId, "frostChill");
        const { stacks, totalSlowPct } = nextFrostChillStacks(
          baseSlowPct,
          this.statuses.getStacks(hit.targetId, "frostChill"),
        );
        if (stacks > 0) {
          this.statuses.apply(hit.targetId, "frostChill", mist.ownerId, now, {
            stacks,
            setStacks: true,
            durationMs: 2200,
          });
        }
        if (totalSlowPct >= 100) {
          this.statuses.apply(hit.targetId, "rooted", mist.ownerId, now, {
            durationMs: 1500,
          });
        }
      }

      mist.tickIndex += 1;
      if (mist.tickIndex < mist.ticksTotal) {
        mist.nextTickAt = now + mist.tickMs;
        remain.push(mist);
      }
    }
    this.pendingFrostMist = remain;
  }

  private applyInstant(
    center: { x: number; z: number },
    radius: number,
    damage: number,
    ownerId: string,
    abilityId: string,
    now: number,
  ) {
    const hits = resolveInstantHits(center, radius, damage, ownerId, this.collectBodies(), (o, t) =>
      this.canHurt(o, t),
    );
    const def = ABILITIES[abilityId];
    const knock = def?.knockback ?? 0;
    const knockMs = def?.knockbackMs ?? 220;
    const owner = this.room.state.players.get(ownerId);
    const from = owner ? { x: owner.x, z: owner.z } : center;
    for (const hit of hits) {
      if (
        def?.shape === "melee" &&
        this.meleeBlockedByHandShield(from, center, hit.targetId)
      ) {
        this.fireHandShieldRetaliate(hit.targetId, now);
        continue;
      }
      this.applyDamage(hit.targetId, hit.damage, ownerId, abilityId, now);
      if (knock > 0) this.applyKnockback(center, hit.targetId, knock, knockMs, now);
      const pull = def?.pull ?? 0;
      if (pull > 0) {
        this.applyPullToward(
          center,
          hit.targetId,
          pull,
          def?.pullMs ?? 280,
          now,
          def?.pullStopDistance,
        );
      }
    }
  }

  /** Front disc blocks melee the same way it shatters projectiles. */
  private meleeBlockedByHandShield(
    attackerPos: Vec2,
    hitCenter: Vec2,
    targetId: string,
  ): boolean {
    const target = this.room.state.players.get(targetId);
    if (!target || target.hp <= 0 || target.disconnected) return false;
    if (!this.statuses.has(targetId, "handShielding")) return false;
    const shieldCenter = pointInFront(
      { x: target.x, z: target.z },
      target.yaw,
      HAND_SHIELD_CAST.shieldForward,
    );
    const bubble: ProtectionBubbleCollider = {
      id: `handShield_${targetId}`,
      x: shieldCenter.x,
      z: shieldCenter.z,
      radius: HAND_SHIELD_CAST.shieldRadius,
    };
    if (
      projectileEntersProtectionBubble(
        attackerPos.x,
        attackerPos.z,
        target.x,
        target.z,
        COMBAT.playerHitRadius * 0.35,
        bubble,
      )
    ) {
      return true;
    }
    return projectileEntersProtectionBubble(
      hitCenter.x,
      hitCenter.z,
      target.x,
      target.z,
      0.05,
      bubble,
    );
  }

  /**
   * On successful projectile shatter / melee block — frontal damage cone
   * along shield facing with light knockback. Fires once per block event.
   */
  private fireHandShieldRetaliate(ownerId: string, now: number) {
    const owner = this.room.state.players.get(ownerId);
    if (!owner || owner.hp <= 0 || owner.disconnected) return;
    if (!this.statuses.has(ownerId, "handShielding")) return;

    const origin = { x: owner.x, z: owner.z };
    const range = HAND_SHIELD_CAST.retaliateRange;
    const halfAngle = HAND_SHIELD_CAST.retaliateConeHalfAngle;
    const damage = HAND_SHIELD_CAST.retaliateDamage;
    const knock = HAND_SHIELD_CAST.retaliateKnockback;
    const knockMs = HAND_SHIELD_CAST.retaliateKnockbackMs;

    this.fx({
      kind: "aoe",
      abilityId: "handShield",
      x: origin.x,
      z: origin.z,
      radius: range,
      yaw: owner.yaw,
      ownerId,
      variant: 1,
    });

    const hits = resolveConeHits(
      origin,
      owner.yaw,
      range,
      halfAngle,
      damage,
      ownerId,
      this.collectBodies(),
      (o, tid) => this.canHurt(o, tid),
    );
    for (const hit of hits) {
      this.applyRawDamage(hit.targetId, hit.damage, ownerId, "handShield", {
        triggersCounter: false,
      });
      if (knock > 0) {
        this.applyKnockback(origin, hit.targetId, knock, knockMs, now);
      }
    }
  }

  /**
   * Groove pulse: full heal to others in radius; caster gets half of the total
   * HP actually restored to others that tick. If nobody is healed, grant a
   * stacking absorb shield instead.
   */
  private applyGrooveHealPulse(
    center: { x: number; z: number },
    radius: number,
    amount: number,
    casterId: string,
    abilityId: string,
    now: number,
  ) {
    if (!(amount > 0) || !(radius > 0)) return;
    const soft = COLLISION.playerRadius;

    let healedOthers = 0;

    for (const [id, player] of this.room.state.players) {
      if (!this.canHealTarget(casterId, id)) continue;
      if (player.disconnected || player.hp <= 0) continue;
      const dist = Math.hypot(player.x - center.x, player.z - center.z);
      if (dist > radius + soft) continue;
      healedOthers += this.applyHealAmount(id, amount, casterId, abilityId);
    }

    for (const [id, target] of this.room.state.targets) {
      if (target.hp <= 0) continue;
      const dist = Math.hypot(target.x - center.x, target.z - center.z);
      if (dist > radius + soft) continue;
      healedOthers += this.applyHealAmount(id, amount, casterId, abilityId);
    }

    if (healedOthers <= 0) {
      const caster = this.room.state.players.get(casterId);
      if (!caster || caster.disconnected || caster.hp <= 0) return;
      this.statuses.apply(casterId, "grooveShield", casterId, now, {
        durationMs: GROOVE_CAST.soloShieldDurationMs,
        stacks: GROOVE_CAST.soloShieldPerTick,
      });
      this.fx({
        kind: "hit",
        abilityId,
        x: caster.x,
        z: caster.z,
        damage: GROOVE_CAST.soloShieldPerTick,
        ownerId: casterId,
        targetId: casterId,
      });
      return;
    }

    const selfHeal = Math.floor(healedOthers / 2);
    if (selfHeal <= 0) return;
    // Self refund is derived from HP already restored — no second crit roll.
    const caster = this.room.state.players.get(casterId);
    if (!caster || caster.disconnected || caster.hp <= 0) return;
    const before = caster.hp;
    caster.hp = Math.min(caster.maxHp, caster.hp + selfHeal);
    const healed = caster.hp - before;
    this.tryProcOverflow(casterId, casterId, selfHeal - healed, caster.maxHp, abilityId, now);
    if (healed > 0) {
      caster.statHealing += healed;
      // Bypasses applyHealAmount, same as the leech refund above.
      this.grantEnergy(casterId, "healingDone", healed, abilityId);
      this.fx({
        kind: "hit",
        abilityId,
        x: caster.x,
        z: caster.z,
        damage: healed,
        ownerId: casterId,
        targetId: casterId,
      });
    }
  }

  /** Authored map props: hitbox HP only — mesh and collider never move. */
  private isImmovableTarget(targetId: string): boolean {
    return this.room.state.targets.get(targetId)?.kind === PROP_TARGET_KIND;
  }

  /** Schedule a lateral shove along a unit direction (wall-clamped). */
  private applyLateralKnockback(
    targetId: string,
    dirX: number,
    dirZ: number,
    distance: number,
    durationMs: number,
    now: number,
  ) {
    if (this.isImmovableTarget(targetId)) return;
    if (this.statuses.has(targetId, "bulwarkCharging")) return;
    const dur = Math.max(80, durationMs);
    let len = Math.hypot(dirX, dirZ);
    if (len < 1e-4) {
      dirX = 1;
      dirZ = 0;
      len = 1;
    }
    const nx = dirX / len;
    const nz = dirZ / len;

    const player = this.room.state.players.get(targetId);
    if (player) {
      if (player.invulnerable) return;
      this.travels.delete(targetId);
      const from = { x: player.x, z: player.z };
      const ideal = { x: player.x + nx * distance, z: player.z + nz * distance };
      const clamped = this.sweepPlayerPos(targetId, from, ideal);
      this.knockbacks.set(targetId, {
        targetId,
        kind: "player",
        fromX: from.x,
        fromZ: from.z,
        toX: clamped.x,
        toZ: clamped.z,
        startAt: now,
        endAt: now + dur,
      });
      return;
    }

    const target = this.room.state.targets.get(targetId);
    if (!target) return;
    const from = { x: target.x, z: target.z };
    const ideal = { x: target.x + nx * distance, z: target.z + nz * distance };
    const clamped = this.sweepPlayerPos(targetId, from, ideal);
    this.knockbacks.set(targetId, {
      targetId,
      kind: "target",
      fromX: from.x,
      fromZ: from.z,
      toX: clamped.x,
      toZ: clamped.z,
      startAt: now,
      endAt: now + dur,
    });
  }

  /** Schedule a radial shove (translated over knockbackMs, not teleported). */
  private applyKnockback(
    center: { x: number; z: number },
    targetId: string,
    distance: number,
    durationMs: number,
    now: number,
  ) {
    if (this.isImmovableTarget(targetId)) return;
    if (this.statuses.has(targetId, "bulwarkCharging")) return;
    const dur = Math.max(80, durationMs);

    const player = this.room.state.players.get(targetId);
    if (player) {
      if (player.invulnerable) return;
      // Knockback wins over their own dash/leap travel.
      this.travels.delete(targetId);
      let dx = player.x - center.x;
      let dz = player.z - center.z;
      let len = Math.hypot(dx, dz);
      if (len < 1e-4) {
        dx = Math.sin(player.yaw);
        dz = Math.cos(player.yaw);
        len = 1;
      }
      const nx = dx / len;
      const nz = dz / len;
      const from = { x: player.x, z: player.z };
      const ideal = { x: player.x + nx * distance, z: player.z + nz * distance };
      const clamped = this.sweepPlayerPos(targetId, from, ideal);
      this.knockbacks.set(targetId, {
        targetId,
        kind: "player",
        fromX: from.x,
        fromZ: from.z,
        toX: clamped.x,
        toZ: clamped.z,
        startAt: now,
        endAt: now + dur,
      });
      return;
    }

    const target = this.room.state.targets.get(targetId);
    if (!target) return;
    let dx = target.x - center.x;
    let dz = target.z - center.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      dx = 1;
      dz = 0;
      len = 1;
    }
    const nx = dx / len;
    const nz = dz / len;
    const from = { x: target.x, z: target.z };
    const ideal = { x: target.x + nx * distance, z: target.z + nz * distance };
    const clamped = this.sweepPlayerPos(targetId, from, ideal);
    this.knockbacks.set(targetId, {
      targetId,
      kind: "target",
      fromX: from.x,
      fromZ: from.z,
      toX: clamped.x,
      toZ: clamped.z,
      startAt: now,
      endAt: now + dur,
    });
  }

  /**
   * Yank a target toward an origin (Gravity Well center, or Grasp caster).
   * Stops at `stopDistance` so bodies don't stack on the singularity / caster.
   */
  private applyPullToward(
    origin: { x: number; z: number },
    targetId: string,
    distance: number,
    durationMs: number,
    now: number,
    stopDistance = 1.2,
  ) {
    if (distance <= 0) return;
    if (this.isImmovableTarget(targetId)) return;
    if (this.statuses.has(targetId, "bulwarkCharging")) return;

    const minDist = Math.max(0.6, stopDistance);
    const dur = Math.max(80, durationMs);

    const schedule = (
      kind: "player" | "target",
      fromX: number,
      fromZ: number,
      invulnerable?: boolean,
    ) => {
      if (invulnerable) return;
      if (kind === "player") this.travels.delete(targetId);

      let dx = origin.x - fromX;
      let dz = origin.z - fromZ;
      let len = Math.hypot(dx, dz);
      if (len < 1e-4) return;
      if (len <= minDist + 0.05) return;

      const nx = dx / len;
      const nz = dz / len;
      const travel = Math.min(distance, Math.max(0, len - minDist));
      if (travel < 0.05) return;

      const from = { x: fromX, z: fromZ };
      const ideal = { x: fromX + nx * travel, z: fromZ + nz * travel };
      const clamped = this.sweepPlayerPos(targetId, from, ideal);
      this.knockbacks.set(targetId, {
        targetId,
        kind,
        fromX: from.x,
        fromZ: from.z,
        toX: clamped.x,
        toZ: clamped.z,
        startAt: now,
        endAt: now + dur,
      });
    };

    const player = this.room.state.players.get(targetId);
    if (player) {
      schedule("player", player.x, player.z, player.invulnerable);
      return;
    }
    const target = this.room.state.targets.get(targetId);
    if (target) {
      schedule("target", target.x, target.z);
    }
  }

  /**
   * Yank a target toward the owner (Grasp). Stops at `stopDistance` so they
   * don't occupy the caster.
   */
  private applyPull(
    ownerId: string,
    targetId: string,
    distance: number,
    durationMs: number,
    now: number,
    stopDistance = 1.2,
  ) {
    const owner = this.room.state.players.get(ownerId);
    if (!owner) return;
    this.applyPullToward(
      { x: owner.x, z: owner.z },
      targetId,
      distance,
      durationMs,
      now,
      stopDistance,
    );
  }

  /**
   * Leap the caster toward a hit target (Chain Jump). Stops at `stopDistance`
   * short of the target so they don't stack.
   */
  private applySelfLeap(
    ownerId: string,
    targetId: string,
    distance: number,
    durationMs: number,
    now: number,
    stopDistance = 1.2,
  ) {
    if (distance <= 0) return;
    const owner = this.room.state.players.get(ownerId);
    if (!owner || owner.invulnerable) return;

    let toX = 0;
    let toZ = 0;
    const player = this.room.state.players.get(targetId);
    if (player) {
      toX = player.x;
      toZ = player.z;
    } else {
      const target = this.room.state.targets.get(targetId);
      if (!target) return;
      toX = target.x;
      toZ = target.z;
    }

    const minDist = Math.max(0.6, stopDistance ?? 1.2);
    const dur = Math.max(80, durationMs);
    this.travels.delete(ownerId);

    let dx = toX - owner.x;
    let dz = toZ - owner.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    if (len <= minDist + 0.05) return;

    const nx = dx / len;
    const nz = dz / len;
    const travel = Math.max(0, len - minDist);
    if (travel < 0.05) return;

    const from = { x: owner.x, z: owner.z };
    const ideal = { x: owner.x + nx * travel, z: owner.z + nz * travel };
    const clamped = this.sweepPlayerPos(ownerId, from, ideal);
    this.knockbacks.set(ownerId, {
      targetId: ownerId,
      kind: "player",
      fromX: from.x,
      fromZ: from.z,
      toX: clamped.x,
      toZ: clamped.z,
      startAt: now,
      endAt: now + dur,
    });
  }

  private applyDamage(
    targetId: string,
    damage: number,
    attackerSessionId: string,
    abilityId: string,
    now = Date.now(),
    opts?: {
      /** Default true — set false for ground ticks / orb pulses. */
      directSpell?: boolean;
      /** Passed through to combat_fx hit (e.g. Arc Blade outer edge). */
      fxVariant?: number;
    },
  ) {
    const dealt = this.applyRawDamage(targetId, damage, attackerSessionId, abilityId, {
      fxVariant: opts?.fxVariant,
    });
    if (!dealt) return;
    if (opts?.directSpell !== false) {
      this.trySoulRelayTrigger(attackerSessionId, abilityId, dealt);
    }
    const def = ABILITIES[abilityId];
    if (def?.applyOnHit?.length) {
      this.applyOutgoingStatusApps(targetId, def.applyOnHit, attackerSessionId, now);
    }
  }

  /** +1 frostChill stack per shatter fragment hit (main crystal does not chill). */
  private applyRunicShardChill(targetId: string, sourceId: string, now: number) {
    const current = this.statuses.getStacks(targetId, "frostChill");
    const next = Math.min(FROST_CHILL_MAX_STACKS, current + 1);
    const mul = this.kits.get(sourceId)?.secondaryEffectMul ?? 1;
    const baseDur = getStatus("frostChill")?.durationMs ?? 2200;
    this.statuses.apply(targetId, "frostChill", sourceId, now, {
      stacks: next,
      setStacks: true,
      durationMs: Math.max(1, Math.round(baseDur * mul)),
    });
  }

  /**
   * Soul Mark projectile hit — stacks per caster; at max stacks the next hit
   * deals projectile damage + Soul Rupture and clears that caster's marks.
   */
  private applySoulMarkHit(
    targetId: string,
    damage: number,
    attackerSessionId: string,
    abilityId: string,
    now: number,
  ) {
    const def = ABILITIES[abilityId];
    if (!def) return;
    const maxStacks = def.soulMarkMaxStacks ?? 3;
    const durationMs = def.soulMarkDurationMs ?? 4000;
    const stacks = this.statuses.getStacks(targetId, "soulMarked", attackerSessionId);
    const fullyMarked = stacks >= maxStacks;

    if (fullyMarked) {
      const rupture = def.ruptureDamage ?? 0;
      const total = damage + rupture;
      const dealt = this.applyRawDamage(
        targetId,
        total,
        attackerSessionId,
        abilityId,
      );
      if (!dealt) return;

      this.trySoulRelayTrigger(attackerSessionId, abilityId, dealt);
      this.statuses.remove(targetId, "soulMarked", attackerSessionId);
      const host =
        this.room.state.players.get(targetId) ?? this.room.state.targets.get(targetId);
      this.fx({
        kind: "aoe",
        abilityId,
        x: host?.x ?? 0,
        z: host?.z ?? 0,
        y: this.combatFxTorsoY(targetId),
        radius: def.radius ?? 0.5,
        ownerId: attackerSessionId,
        targetId,
        variant: 1,
      });
      return;
    }

    const dealt = this.applyRawDamage(targetId, damage, attackerSessionId, abilityId);
    if (!dealt) return;

    this.trySoulRelayTrigger(attackerSessionId, abilityId, dealt);
    this.statuses.apply(targetId, "soulMarked", attackerSessionId, now, {
      durationMs,
      stacks: 1,
    });
  }

  /**
   * Soul Sever projectile hit — initial damage, then positional debt imprint.
   * Reapply from the same caster detonates the existing sever first.
   */
  private applySoulSeverHit(
    targetId: string,
    damage: number,
    attackerSessionId: string,
    abilityId: string,
    now: number,
  ) {
    const def = ABILITIES[abilityId] ?? ABILITIES.soulSever;
    if (!def) return;

    const existing: string[] = [];
    this.room.state.soulSevers.forEach((s, id) => {
      if (s.casterId === attackerSessionId && s.targetId === targetId) existing.push(id);
    });
    for (const id of existing) this.resolveSoulSever(id, now, true);

    const dealt = this.applyRawDamage(targetId, damage, attackerSessionId, abilityId);
    if (!(dealt > 0)) return;
    this.trySoulRelayTrigger(attackerSessionId, abilityId, dealt);

    const host =
      this.room.state.players.get(targetId) ?? this.room.state.targets.get(targetId);
    if (!host || host.hp <= 0) return;

    const durationMs = def.severDurationMs ?? SOUL_SEVER_CAST.severDurationMs;
    const id = `ssever_${this.nextId++}`;
    const st = new SoulSeverState();
    st.id = id;
    st.casterId = attackerSessionId;
    st.targetId = targetId;
    st.abilityId = def.id;
    st.originX = host.x;
    st.originZ = host.z;
    st.startedAt = now;
    st.endsAt = now + durationMs;
    this.room.state.soulSevers.set(id, st);

    this.statuses.apply(targetId, "soulSevered", attackerSessionId, now, {
      durationMs,
    });

    this.fx({
      kind: "aoe",
      abilityId: def.id,
      x: host.x,
      z: host.z,
      y: this.combatFxTorsoY(targetId),
      radius: 0.4,
      ownerId: attackerSessionId,
      targetId,
      variant: 0,
    });
  }

  private advanceSoulSevers(now: number) {
    if (this.room.state.soulSevers.size === 0) return;
    const toResolve: string[] = [];
    const toDrop: string[] = [];

    this.room.state.soulSevers.forEach((sever, id) => {
      const host =
        this.room.state.players.get(sever.targetId) ??
        this.room.state.targets.get(sever.targetId);
      if (!host || host.hp <= 0) {
        toDrop.push(id);
        return;
      }
      if (now >= sever.endsAt) toResolve.push(id);
    });

    for (const id of toDrop) this.clearSoulSever(id, true);
    for (const id of toResolve) this.resolveSoulSever(id, now, true);
  }

  /** Snap or clear a sever. `dealDamage` false when target died early. */
  private resolveSoulSever(id: string, now: number, dealDamage: boolean) {
    const sever = this.room.state.soulSevers.get(id);
    if (!sever) return;

    const host =
      this.room.state.players.get(sever.targetId) ??
      this.room.state.targets.get(sever.targetId);

    if (dealDamage && host && host.hp > 0) {
      const displacement = Math.hypot(host.x - sever.originX, host.z - sever.originZ);
      const dmg = soulSeverSnapDamage(displacement);
      const dealt = this.applyRawDamage(
        sever.targetId,
        dmg,
        sever.casterId,
        sever.abilityId,
      );
      if (dealt > 0) {
        this.trySoulRelayTrigger(sever.casterId, sever.abilityId, dealt);
      }
      const power01 = Math.max(
        0,
        Math.min(1, displacement / Math.max(1e-4, SOUL_SEVER_CAST.severMaxDistance)),
      );
      this.fx({
        kind: "aoe",
        abilityId: sever.abilityId,
        x: host.x,
        z: host.z,
        x2: sever.originX,
        z2: sever.originZ,
        y: this.combatFxTorsoY(sever.targetId),
        radius: 0.35 + power01 * 0.45,
        ownerId: sever.casterId,
        targetId: sever.targetId,
        variant: 1,
        damage: dmg,
      });
    }

    this.clearSoulSever(id, true);
  }

  private clearSoulSever(id: string, removeStatus: boolean) {
    const sever = this.room.state.soulSevers.get(id);
    if (!sever) return;
    if (removeStatus) {
      this.statuses.remove(sever.targetId, "soulSevered", sever.casterId);
    }
    this.room.state.soulSevers.delete(id);
  }

  /** Apply enemy debuffs with Intensified Elements potency when the source has the talent. */
  private applyOutgoingStatusApps(
    targetId: string,
    apps: Parameters<StatusSystem["applyApplications"]>[1],
    sourceId: string,
    now: number,
  ) {
    const mul = this.kits.get(sourceId)?.secondaryEffectMul ?? 1;
    this.statuses.applyApplications(targetId, apps, sourceId, now, {
      effectMul: mul,
    });
  }

  /**
   * Armed Counter / Revenge deny. Returns true when the hit was consumed
   * (no further damage / status from this contact).
   * Frost Mist is multi-tick: keep the stance armed for the full window so
   * every tick is denied; riposte buffs / Revenge blink apply once.
   */
  private tryProcCounterOrRevenge(
    targetId: string,
    attackerSessionId: string,
    abilityId: string,
    now: number,
  ): boolean {
    if (!this.room.state.players.has(targetId)) return false;
    if (!abilityTriggersCounter(ABILITIES[abilityId], abilityId)) return false;
    const mistChannel = abilityId === "frostMist";

    if (this.statuses.has(targetId, "counterArmed")) {
      if (mistChannel) {
        if (!this.counterMistRiposted.has(targetId)) {
          this.counterMistRiposted.add(targetId);
          this.applyCounterRiposteBuffs(targetId, now, true);
        }
      } else {
        this.procCounter(targetId, now);
      }
      const player = this.room.state.players.get(targetId);
      if (player) {
        this.fx({
          kind: "hit",
          abilityId: "counter",
          x: player.x,
          z: player.z,
          ownerId: targetId,
          targetId,
          damage: 0,
        });
      }
      return true;
    }
    if (this.statuses.has(targetId, "revengeArmed")) {
      if (mistChannel) {
        if (!this.revengeMistBlinked.has(targetId)) {
          this.revengeMistBlinked.add(targetId);
          this.procRevenge(targetId, attackerSessionId, now, { keepArmed: true });
        }
      } else {
        this.procRevenge(targetId, attackerSessionId, now);
      }
      const player = this.room.state.players.get(targetId);
      if (player) {
        this.fx({
          kind: "hit",
          abilityId: "revenge",
          x: player.x,
          z: player.z,
          ownerId: targetId,
          targetId,
          damage: 0,
        });
      }
      return true;
    }
    return false;
  }

  /** HP change + hit FX. Returns post-resist damage applied (0 if blocked / invuln / countered). */
  private applyRawDamage(
    targetId: string,
    damage: number,
    attackerSessionId: string,
    abilityId: string,
    opts?: {
      /** Default true — set false for fuse blasts / aura-like ticks. */
      triggersCounter?: boolean;
      fxVariant?: number;
    },
  ): number {
    const now = Date.now();
    const dealtMul = this.statuses.getDamageDealtMul(attackerSessionId);
    const salvoMul = this.peekOpeningSalvoMul(attackerSessionId, abilityId, damage, now);
    const oppMul = this.peekOpportunistMul(attackerSessionId, targetId, abilityId, damage);
    const fifthMul = this.peekFifthCadenceMul(attackerSessionId, abilityId, damage);
    const scaledIn = damage > 0 ? damage * dealtMul * salvoMul * oppMul * fifthMul : damage;
    const allowCounter = opts?.triggersCounter !== false;

    // Armed Counter / Revenge: deny the next melee / direct projectile / magma / shroom.
    if (
      allowCounter &&
      scaledIn > 0 &&
      this.tryProcCounterOrRevenge(targetId, attackerSessionId, abilityId, now)
    ) {
      return 0;
    }

    // Crit once at the gate — before resist/shields — so every damage path shares one RNG.
    const atkKit = this.kits.get(attackerSessionId);
    const crit =
      scaledIn > 0 &&
      rollCrit(atkKit?.critChance ?? COMBAT.critChance);
    const critMult =
      COMBAT.critMultiplier * (1 + (atkKit?.critDamageBonus ?? 0));
    let resistMul = this.statuses.getDamageTakenMul(targetId);
    // Bulwark Charge: full block only from the forward hemisphere.
    if (this.bulwarkBlocksIncoming(targetId, attackerSessionId)) {
      resistMul = 0;
    }
    let dealt = Math.max(0, Math.round(scaleForCrit(scaledIn, crit, critMult) * resistMul));
    const damageForLeech = dealt;
    dealt = this.statuses.absorbWithShields(targetId, dealt);

    const player = this.room.state.players.get(targetId);
    if (player) {
      if (player.invulnerable) return 0;
      if (scaledIn > 0) {
        this.noteDealtDamage(attackerSessionId, now);
        if (salvoMul > 1) this.commitOpeningSalvo(attackerSessionId, now);
        this.noteTookDamage(targetId, now);
      }
      if (dealt > 0) {
        player.hp = Math.max(0, player.hp - dealt);
        this.hooks.onPlayerDamaged?.(targetId, dealt, attackerSessionId);
        // Both sides earn from an exchange; taken is the richer rate, so the
        // player losing it gets some pressure back.
        this.grantEnergy(attackerSessionId, "damageDealt", dealt, abilityId);
        this.grantEnergy(targetId, "damageTaken", dealt);
      }
      this.fx({
        kind: "hit",
        abilityId,
        x: player.x,
        z: player.z,
        ownerId: attackerSessionId,
        targetId,
        damage: dealt,
        crit: crit && dealt > 0 ? true : undefined,
        variant: opts?.fxVariant,
      });
      return damageForLeech;
    }

    const decoy = this.room.state.decoys.get(targetId);
    if (decoy) {
      if (scaledIn > 0) {
        this.noteDealtDamage(attackerSessionId, now);
        if (salvoMul > 1) this.commitOpeningSalvo(attackerSessionId, now);
      }
      if (dealt > 0) {
        decoy.hp = Math.max(0, decoy.hp - dealt);
      }
      this.fx({
        kind: "hit",
        abilityId,
        x: decoy.x,
        z: decoy.z,
        ownerId: attackerSessionId,
        targetId,
        damage: dealt,
        crit: crit && dealt > 0 ? true : undefined,
        variant: opts?.fxVariant,
      });
      if (decoy.hp <= 0) {
        this.room.state.decoys.delete(targetId);
      }
      return damageForLeech;
    }

    const target = this.room.state.targets.get(targetId);
    if (target) {
      if (scaledIn > 0) {
        this.noteDealtDamage(attackerSessionId, now);
        if (salvoMul > 1) this.commitOpeningSalvo(attackerSessionId, now);
      }
      if (dealt > 0) {
        target.hp = Math.max(0, target.hp - dealt);
        this.hooks.onTargetDamaged?.(targetId, dealt, attackerSessionId);
        // Dummies pay out so the bar can be exercised without a second
        // player. The rate cap already makes this no faster than a real
        // fight, so it is a testing affordance rather than a shortcut.
        this.grantEnergy(attackerSessionId, "damageDealt", dealt, abilityId);
      }
      this.fx({
        kind: "hit",
        abilityId,
        x: target.x,
        z: target.z,
        ownerId: attackerSessionId,
        targetId,
        damage: dealt,
        crit: crit && dealt > 0 ? true : undefined,
        variant: opts?.fxVariant,
      });
      if (target.hp <= 0) {
        this.hooks.onTargetKilled?.(targetId, attackerSessionId);
        // Practice targets refill; wave mobs are removed. Attackable map props
        // are practice targets: their model and collider are part of the
        // authored map, so they have nowhere to go and nothing to rebuild.
        if (target.kind === "dummy" || target.kind === PROP_TARGET_KIND) {
          target.hp = target.maxHp;
          target.statuses.clear();
          this.knockbacks.delete(targetId);
          const spawn = this.targetSpawns.get(targetId);
          if (spawn) {
            target.x = spawn.x;
            target.z = spawn.z;
          }
          target.castAbilityId = "";
          target.castPhase = "";
          target.castLockUntil = 0;
        } else {
          target.statuses.clear();
          this.knockbacks.delete(targetId);
          this.targetSpawns.delete(targetId);
          this.room.state.targets.delete(targetId);
        }
      }
      return damageForLeech;
    }
    return 0;
  }

  /**
   * Restore HP on a player or practice dummy. Crit rolls once here for all heals.
   * Returns HP actually restored (0 if none). Overflow converts wasted heal when applicable.
   */
  private applyHealAmount(
    targetId: string,
    amount: number,
    healerId: string,
    abilityId: string,
  ): number {
    if (!(amount > 0)) return 0;
    const crit = rollCrit(this.kits.get(healerId)?.critChance ?? COMBAT.critChance);
    const healFor = Math.max(0, Math.round(scaleForCrit(amount, crit)));
    const now = Date.now();

    const emit = (x: number, z: number, healed: number) => {
      if (!(healed > 0)) return;
      this.fx({
        kind: "hit",
        abilityId,
        x,
        z,
        damage: healed,
        ownerId: healerId,
        targetId,
        crit: crit || undefined,
      });
    };

    const creditHealing = (healed: number) => {
      if (!(healed > 0)) return;
      const healer = this.room.state.players.get(healerId);
      if (healer) healer.statHealing += healed;
      this.grantEnergy(healerId, "healingDone", healed, abilityId);
    };

    const player = this.room.state.players.get(targetId);
    if (player) {
      if (player.disconnected || player.hp <= 0) return 0;
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + healFor);
      const healed = player.hp - before;
      emit(player.x, player.z, healed);
      creditHealing(healed);
      this.tryProcOverflow(healerId, targetId, healFor - healed, player.maxHp, abilityId, now);
      return healed;
    }

    const target = this.room.state.targets.get(targetId);
    if (target) {
      if (target.hp <= 0) return 0;
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + healFor);
      const healed = target.hp - before;
      emit(target.x, target.z, healed);
      creditHealing(healed);
      this.tryProcOverflow(healerId, targetId, healFor - healed, target.maxHp, abilityId, now);
      return healed;
    }
    return 0;
  }

  private syncAllInvulnerable(now: number) {
    this.room.state.players.forEach((player, sessionId) => {
      this.syncInvulnerable(sessionId, player, now);
    });
  }

  /** Consume Counter window → invuln + haste + damage amp. */
  private procCounter(targetId: string, now: number) {
    this.statuses.remove(targetId, "counterArmed");
    this.counterMistRiposted.delete(targetId);
    this.applyCounterRiposteBuffs(targetId, now);
  }

  /** Haste + empower + end Counter cast pose (stance may still be armed for mist). */
  private applyCounterRiposteBuffs(targetId: string, now: number, keepArmed = false) {
    this.statuses.apply(targetId, "counterHaste", targetId, now);
    this.statuses.apply(targetId, "counterEmpowered", targetId, now);
    const player = this.room.state.players.get(targetId);
    if (player) {
      const cast = this.casts.get(targetId);
      if (cast?.abilityId === "counter") {
        this.clearCastState(targetId, player, { keepStanceArmed: keepArmed });
        this.phaseFx(targetId, player, "counter", "idle", now);
      }
      this.syncInvulnerable(targetId, player, now);
    }
  }

  /**
   * Consume Revenge window → instant blink behind attacker, vanish briefly, then reappear.
   * If full behind is blocked, land closer along the behind line (never through walls).
   * `keepArmed` — Frost Mist multi-tick: blink once but keep denying later mist ticks.
   */
  private procRevenge(
    targetId: string,
    attackerId: string,
    now: number,
    opts?: { keepArmed?: boolean },
  ) {
    if (!opts?.keepArmed) {
      this.statuses.remove(targetId, "revengeArmed");
      this.revengeMistBlinked.delete(targetId);
    }
    const player = this.room.state.players.get(targetId);
    if (!player) return;

    const attacker =
      this.room.state.players.get(attackerId) ?? this.room.state.targets.get(attackerId);
    if (attacker && attackerId !== targetId) {
      const behindDist = REVENGE_CAST.behindDist;
      const forward = { x: Math.sin(attacker.yaw), z: Math.cos(attacker.yaw) };
      const right = { x: forward.z, z: -forward.x };
      const from = { x: player.x, z: player.z };
      const atk = { x: attacker.x, z: attacker.z };

      const candidates: Vec2[] = [];
      // Prefer full behind, then step closer toward the attacker.
      for (let i = 0; i <= 6; i++) {
        const d = behindDist * (1 - i / 6);
        if (d < COLLISION.playerRadius * 0.85) break;
        candidates.push({
          x: atk.x - forward.x * d,
          z: atk.z - forward.z * d,
        });
      }
      // Slight side offsets at mid/close range if center line is jammed.
      for (const d of [behindDist * 0.55, behindDist * 0.35]) {
        for (const side of [-1, 1]) {
          candidates.push({
            x: atk.x - forward.x * d + right.x * side * COLLISION.playerRadius * 1.1,
            z: atk.z - forward.z * d + right.z * side * COLLISION.playerRadius * 1.1,
          });
        }
      }
      candidates.push({ ...atk });

      let clamped = this.clampPlayerPos(targetId, from);
      for (const ideal of candidates) {
        const landed = this.sweepPlayerPos(targetId, from, ideal);
        const next = this.clampPlayerPos(targetId, landed);
        // Accept if we made progress toward the ideal (not stuck at origin feet).
        const toIdeal = Math.hypot(ideal.x - next.x, ideal.z - next.z);
        const fromIdeal = Math.hypot(ideal.x - from.x, ideal.z - from.z);
        if (toIdeal + 0.05 < fromIdeal || Math.hypot(next.x - from.x, next.z - from.z) > 0.15) {
          clamped = next;
          break;
        }
      }

      this.travels.delete(targetId);
      this.knockbacks.delete(targetId);

      // Vanish burst at the old feet, then snap.
      this.fx({
        kind: "dash",
        abilityId: "revenge",
        x: from.x,
        z: from.z,
        ownerId: targetId,
        yaw: player.yaw,
      });

      player.x = clamped.x;
      player.z = clamped.z;
      const face = normalize2({
        x: attacker.x - player.x,
        z: attacker.z - player.z,
      });
      player.yaw =
        length2(face) > 1e-4 ? Math.atan2(face.x, face.z) : attacker.yaw + Math.PI;

      this.statuses.apply(targetId, "revengePhased", targetId, now, {
        durationMs: REVENGE_CAST.vanishMs,
      });
    }

    const cast = this.casts.get(targetId);
    if (cast?.abilityId === "revenge") {
      this.clearCastState(targetId, player, { keepStanceArmed: Boolean(opts?.keepArmed) });
      this.phaseFx(targetId, player, "revenge", "idle", now);
    }
    this.syncInvulnerable(targetId, player, now);
  }

  private syncInvulnerable(sessionId: string, player: PlayerState, now: number) {
    let fromCast = false;
    const cast = this.casts.get(sessionId);
    if (cast) {
      const def = ABILITIES[cast.abilityId];
      if (def) fromCast = isInIFrameWindow(def, now - cast.castStartedAt);
    }
    const blinkUntil = this.blinkIframeUntil.get(sessionId) ?? 0;
    if (blinkUntil > 0 && now >= blinkUntil) this.blinkIframeUntil.delete(sessionId);
    const fromBlink = (this.blinkIframeUntil.get(sessionId) ?? 0) > now;
    player.invulnerable = fromCast || fromBlink || this.statuses.grantsInvulnerable(sessionId);
  }

  private canHurt(ownerId: string, targetId: string): boolean {
    if (ownerId === targetId) return false;
    // Dummies don't friendly-fire each other.
    if (this.room.state.targets.has(ownerId) && this.room.state.targets.has(targetId)) {
      return false;
    }
    if (this.room.state.targets.has(targetId)) return true;
    // Decoy clones absorb hits (dummy bolts while owner is cloaked, etc.).
    if (this.room.state.decoys.has(targetId)) {
      return this.room.state.targets.has(ownerId) || this.room.state.players.has(ownerId);
    }
    const targetPlayer = this.room.state.players.get(targetId);
    if (targetPlayer) {
      if (targetPlayer.role === "spectator" || targetPlayer.roundDead) return false;
      const ownerPlayer = this.room.state.players.get(ownerId);
      if (
        ownerPlayer &&
        ownerPlayer.team &&
        targetPlayer.team &&
        ownerPlayer.team === targetPlayer.team
      ) {
        return false;
      }
    }
    // Practice dummies may bolt players even when hub PvP is off.
    if (this.room.state.targets.has(ownerId) && this.room.state.players.has(targetId)) {
      return true;
    }
    if (!this.hooks.canHurtPlayers) return false;
    return this.room.state.players.has(targetId);
  }

  private collectBodies(): CombatBody[] {
    const bodies = this.bodyBuffer;
    bodies.length = 0;
    this.room.state.players.forEach((p, sessionId) => {
      // Spectators and round-dead fighters are out of the fight entirely.
      if (p.role === "spectator" || p.roundDead) return;
      bodies.push({
        id: sessionId,
        x: p.x,
        z: p.z,
        yaw: p.yaw,
        hp: p.hp,
        maxHp: p.maxHp,
        vulnerable: !p.disconnected && p.hp > 0 && !p.invulnerable,
      });
    });
    this.room.state.targets.forEach((t) => {
      bodies.push({
        id: t.id,
        x: t.x,
        z: t.z,
        yaw: t.yaw,
        hp: t.hp,
        maxHp: t.maxHp,
        vulnerable: t.hp > 0,
        // Absent for dummies and mobs, which are player-sized; set only by
        // attackable props, whose footprint comes from their collider.
        ...(t.radius > 0 ? { radius: t.radius } : {}),
      });
    });
    this.room.state.decoys.forEach((d) => {
      bodies.push({
        id: d.id,
        x: d.x,
        z: d.z,
        yaw: d.yaw,
        hp: d.hp,
        maxHp: d.maxHp,
        vulnerable: d.hp > 0,
      });
    });
    return bodies;
  }

  private playerBody(sessionId: string, player: PlayerState): CombatBody {
    return {
      id: sessionId,
      x: player.x,
      z: player.z,
      yaw: player.yaw,
      hp: player.hp,
      maxHp: player.maxHp,
      vulnerable: !player.disconnected && !player.invulnerable,
    };
  }

  private phaseFx(
    sessionId: string,
    player: PlayerState,
    abilityId: string,
    phase: CombatFxEvent["phase"],
    phaseEndsAt: number,
    extra?: {
      cooldownMs?: number;
      comboHit?: number;
      radius?: number;
      x2?: number;
      z2?: number;
      yaw?: number;
    },
  ) {
    this.fx({
      kind: "cast_phase",
      abilityId,
      x: player.x,
      z: player.z,
      x2: extra?.x2,
      z2: extra?.z2,
      yaw: extra?.yaw,
      ownerId: sessionId,
      phase,
      phaseEndsAt,
      cooldownMs: extra?.cooldownMs,
      comboHit: extra?.comboHit,
      radius: extra?.radius,
    });
  }

  /** Torso / center mass height for combat FX on players, dummies, and map props. */
  private combatFxTorsoY(targetId: string): number {
    if (this.room.state.players.has(targetId)) return 1.15;
    const target = this.room.state.targets.get(targetId);
    if (!target) return 1.15;
    const footprint = target.radius > 0 ? target.radius : 0.45;
    return (target.y ?? 0) + footprint * 0.55;
  }

  private fx(event: CombatFxEvent) {
    this.room.broadcast("combat_fx", event);
  }

  /** Apply ability cooldown; returns ms for client sync. */
  private startCooldown(sessionId: string, abilityId: string, now: number): number {
    if (this.noCooldownSessions.has(sessionId)) return 0;
    const def = ABILITIES[abilityId];
    const baseMs = def?.cooldownMs ?? 0;
    const cooldownMs = kitCooldownMs(this.kits.get(sessionId), abilityId, baseMs);
    let bag = this.cds.get(sessionId);
    if (!bag) {
      bag = new Map();
      this.cds.set(sessionId, bag);
    }
    bag.set(abilityId, now + cooldownMs);
    return cooldownMs;
  }

  /** Admin: skip ability cooldowns for this session (hub practice). */
  setNoCooldowns(sessionId: string, enabled: boolean): boolean {
    if (enabled) {
      this.noCooldownSessions.add(sessionId);
      this.cds.delete(sessionId);
    } else {
      this.noCooldownSessions.delete(sessionId);
    }
    return this.noCooldownSessions.has(sessionId);
  }

  hasNoCooldowns(sessionId: string): boolean {
    return this.noCooldownSessions.has(sessionId);
  }

  /**
   * After an effect resolves: non-combo → start CD.
   * Combo → count hit; start CD only when chain completes.
   * Returns cooldownMs when CD started, else undefined.
   */
  private onEffectResolved(sessionId: string, def: AbilityDef, now: number): number | undefined {
    // Rift Fissure: CD starts on first plant; second plant must not refresh it.
    if (abilityEffectKind(def) === "riftFissure") {
      const until = this.cds.get(sessionId)?.get(def.id) ?? 0;
      if (until > now) return until - now;
      return this.startCooldown(sessionId, def.id, now);
    }
    if (!isComboAbility(def) || !def.combo) {
      return this.startCooldown(sessionId, def.id, now);
    }

    let combo = this.combos.get(sessionId);
    if (!combo || combo.abilityId !== def.id) {
      combo = { abilityId: def.id, hitsDone: 0, continueUntil: 0 };
    }
    combo.hitsDone += 1;
    combo.continueUntil = 0;

    if (combo.hitsDone >= def.combo.hits) {
      this.combos.delete(sessionId);
      return this.startCooldown(sessionId, def.id, now);
    }

    this.combos.set(sessionId, combo);
    return undefined;
  }

  /** After a swing fully ends, open the window to continue the chain. */
  private openComboContinueWindow(sessionId: string, def: AbilityDef, now: number) {
    if (!isComboAbility(def) || !def.combo) return;
    const combo = this.combos.get(sessionId);
    if (!combo || combo.abilityId !== def.id || combo.hitsDone <= 0) return;
    if (combo.hitsDone >= def.combo.hits) return;
    combo.continueUntil = now + def.combo.continueWindowMs;
    this.combos.set(sessionId, combo);
  }

  /**
   * Cancel / interrupt mid-chain: if any hit landed (this swing or prior), start CD.
   * Free cancel only on the first swing before impact.
   */
  private endComboEarly(
    sessionId: string,
    abilityId: string,
    effectFired: boolean,
    now: number,
  ): number | undefined {
    const def = ABILITIES[abilityId];
    if (!isComboAbility(def)) {
      this.combos.delete(sessionId);
      return undefined;
    }

    const combo = this.combos.get(sessionId);
    const priorHits = combo?.abilityId === abilityId ? combo.hitsDone : 0;
    this.combos.delete(sessionId);

    if (!effectFired && priorHits <= 0) return undefined;

    const readyAt = this.cds.get(sessionId)?.get(abilityId) ?? 0;
    if (readyAt > now) return undefined;
    return this.startCooldown(sessionId, abilityId, now);
  }

  private comboHitFor(sessionId: string, abilityId: string): number | undefined {
    const combo = this.combos.get(sessionId);
    if (combo?.abilityId === abilityId && combo.hitsDone > 0) return combo.hitsDone;
    return undefined;
  }
}
