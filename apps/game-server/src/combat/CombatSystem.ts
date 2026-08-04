import type { Room } from "@colyseus/core";
import {
  ABILITIES,
  BARRIER_CAST,
  COLLISION,
  COMBAT,
  GROOVE_CAST,
  HEAL_BEAM_CAST,
  LIFE_LEECH_CAST,
  MOVE_SPEED,
  PRACTICE_DUMMY_MAX_HP,
  POISON_CLOUD_CAST,
  SMOKE_BOMB_CAST,
  HOLY_GROUND_CAST,
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
  STARTER_COLORS,
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  REVENGE_CAST,
  HAND_SHIELD_CAST,
  HAND_SHIELD_ARMED_MS,
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
  COMBAT_ENGAGE_LINGER_MS,
  OPENING_SALVO_COOLDOWN_MS,
  OVERFLOW_DURATION_MS,
  PROTECTIVE_INSTINCT_COOLDOWN_MS,
  PROTECTIVE_INSTINCT_DURATION_MS,
  COMBAT_FX_VARIANT_WALL_HIT,
  createProjectile,
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
  inFacingCone,
  angleFromFacing,
  rollCrit,
  scaleForCrit,
  sampleTravel,
  spikeLinePoints,
  firewallWallPoints,
  sweepTravel,
  tickProjectiles,
  totalCastDurationMs,
  travelDistance,
  travelDurationMs,
  travelProgress01,
  travelTakeoffDelayMs,
  normalize2,
  nextFrostChillStacks,
  type AbilityDef,
  type CastPhaseId,
  type CombatSessionKit,
  type StaticCollider,
  type CombatBody,
  type CombatFxEvent,
  type ProjectileSim,
  type TalentBuild,
  type Vec2,
} from "@battlebeasts/shared";
import {
  BaseCityState,
  DecoyState,
  PlayerState,
  ProjectileState,
  ProtectionBubbleState,
  RiftPortalState,
  ShroomState,
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
  /** Last Magma Orbs meet range broadcast via cast_phase (aim sync). */
  magmaMeetRange?: number;
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
const DECOY_LIFE_MS = 2500;
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
  private pendingSilenceSweeps: PendingSilenceSweep[] = [];
  private pendingFirewalls: PendingFirewall[] = [];
  private pendingPoisonClouds: PendingPoisonCloud[] = [];
  private pendingHolyGrounds: PendingHolyGround[] = [];
  /** Bodies currently holding holyBlessed from a live Holy Ground zone. */
  private holyBlessedBodyIds = new Set<string>();
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
  private pendingBarrier = new Map<string, PendingBarrier>();
  /** Active Spirit Form sessions (husk id + end time + link stun tracking). */
  private spiritForms = new Map<
    string,
    { huskId: string; endsAt: number; linkHitIds: Set<string> }
  >();
  /** Husk kept alive while the return dash plays; deleted on travel end. */
  private spiritReturnHusks = new Map<string, string>();
  /** Original spawn pose for practice dummies (respawn here on death). */
  private targetSpawns = new Map<string, { x: number; z: number }>();
  private nextId = 1;
  private hooks: CombatRoomHooks;
  private staticColliders: StaticCollider[] = [];
  /** Cached wall colliders — rebuilt in setStaticColliders. */
  private wallColliders: Extract<StaticCollider, { shape: "walls" }>[] = [];
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
  /**
   * Fifth Cadence — `count` = damaging spells toward next bonus (0–5);
   * armed window applies +15% only to the 5th spell's ability id.
   */
  private fifthSpellBySession = new Map<
    string,
    { count: number; armedAbilityId: string; armedUntil: number }
  >();
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
    this.wallColliders = colliders.filter(
      (c): c is Extract<StaticCollider, { shape: "walls" }> => c.shape === "walls",
    );
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
      let cooldownMs = this.endComboEarly(targetId, abilityId, cast.effectFired, now);
      const def = ABILITIES[abilityId];
      if (def?.holdChannel && cast.effectFired) {
        cooldownMs = this.startCooldown(targetId, abilityId, now);
      }
      this.clearPendingFrostMist(targetId);
      this.clearPendingGrooveHeal(targetId);
      this.clearPendingHealBeam(targetId);
      this.clearPendingLifeLeech(targetId);
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
    this.statuses.clearTarget(sessionId);
    this.clearPendingFrostMist(sessionId);
    this.clearPendingGrooveHeal(sessionId);
    this.clearPendingHealBeam(sessionId);
    this.clearPendingLifeLeech(sessionId);
    this.clearOwnedDecoys(sessionId);
    this.clearOwnerRifts(sessionId);
    this.clearSpiritForm(sessionId, Date.now(), false);
    this.clearSpiritReturn(sessionId);
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
  }

  clearOwnedDecoys(sessionId: string) {
    const toDelete: string[] = [];
    this.room.state.decoys.forEach((d, id) => {
      if (d.ownerSessionId === sessionId) toDelete.push(id);
    });
    for (const id of toDelete) this.room.state.decoys.delete(id);
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
    if (!inLoadout) return reject();
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

    // Any successful new cast breaks cloak (including re-casting Decoy).
    this.revealCloak(sessionId);

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
      this.fireEffect(sessionId, player, def, now);
      const cooldownMs = this.onEffectResolved(sessionId, def, now);
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

    // Magma Orbs: rebroadcast meet range so observers track live aim (not phase-stamp only).
    if (cast.abilityId !== "magmaOrbs") return;
    const player = this.room.state.players.get(sessionId);
    if (!player) return;
    const meet = resolveMagmaOrbsMeetRange(
      { x: player.x, z: player.z },
      { x: aimX, z: aimZ },
    );
    const prev = cast.magmaMeetRange;
    if (prev != null && Math.abs(prev - meet) < 0.12) return;
    cast.magmaMeetRange = meet;
    this.phaseFx(sessionId, player, "magmaOrbs", cast.phase, cast.phaseEndsAt, {
      radius: meet,
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
    this.clearUnarmedShrooms(sessionId);
    if (def.id === "counter") {
      this.statuses.remove(sessionId, "counterArmed");
    }
    if (def.id === "revenge") {
      this.statuses.remove(sessionId, "revengeArmed");
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
              COMBAT.playerHitRadius,
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
    this.advanceTravels(now);
    this.advanceKnockbacks(now);
    this.advanceCasts(now);
    this.advanceCombos(now);
    this.advancePendingSpikes(now);
    this.advancePendingSilenceSweeps(now);
    this.advancePendingFirewalls(now);
    this.advancePendingPoisonClouds(now);
    this.advancePendingHolyGrounds(now);
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
    this.advancePendingBarrier(now);
    this.advanceDecoys(dt, now);
    this.advanceSpiritForms(now);
    this.syncAllInvulnerable(now);
    this.statuses.tick(now);

    if (this.sims.size === 0) return;

    const bodies = this.collectBodies();
    this.simList.length = 0;
    for (const sim of this.sims.values()) this.simList.push(sim);
    const { removedIds, hits, slows, explodes, wallHits } = tickProjectiles(
      this.simList,
      dt,
      bodies,
      (o, t) => this.canHurt(o, t),
      this.wallColliders,
      (abilityId) => {
        const delay = ABILITIES[abilityId]?.detonate?.delayMs ?? 0;
        return delay > 0 ? delay / 1000 : 0;
      },
      this.collectProjectileBlockColliders(now),
    );

    for (const hit of hits) {
      // Aura ticks: damage only (slows applied separately). Contact: damage + applyOnHit.
      const def = ABILITIES[hit.abilityId];
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
      this.sims.delete(id);
      this.room.state.projectiles.delete(id);
    }
    for (const wall of wallHits) {
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
        if (!target) {
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

      if (now >= travel.endAt) {
        const pending = travel.pendingLandingEffect;
        const abilityId = travel.abilityId;
        this.travels.delete(sessionId);
        if (abilityId === "spiritForm") {
          this.finishSpiritReturn(sessionId);
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
          this.fireEffect(sessionId, player, def, now);
          player.yaw = yawBefore;
          const cooldownMs = this.onEffectResolved(sessionId, def, now);
          this.enterPhase(sessionId, player, def, next, now, cast.castStartedAt, {
            cooldownMs,
            comboHit: this.comboHitFor(sessionId, def.id),
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
    const duration = Math.max(
      16,
      fxExtra?.durationMs ?? phaseDurationMs(def, phase),
    );

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
    if (magmaMeet != null) cast.magmaMeetRange = magmaMeet;
    this.phaseFx(sessionId, player, def.id, phase, cast.phaseEndsAt, {
      ...fxExtra,
      comboHit: player.castComboHit || fxExtra?.comboHit,
      // Cursor-clamped meet range so clients can preview / sync curves.
      radius: magmaMeet,
    });
  }

  private clearCastState(sessionId: string, player: PlayerState) {
    const cast = this.casts.get(sessionId);
    if (cast?.abilityId === "counter") {
      this.statuses.remove(sessionId, "counterArmed");
    }
    if (cast?.abilityId === "revenge") {
      this.statuses.remove(sessionId, "revengeArmed");
    }
    if (cast?.abilityId === "handShield") {
      this.statuses.remove(sessionId, "handShielding");
    }
    this.casts.delete(sessionId);
    this.travels.delete(sessionId);
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

  private fireEffect(sessionId: string, player: PlayerState, def: AbilityDef, now: number) {
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
      return;
    }

    if (kind === "spikeWave" && !deferHit) {
      this.scheduleSpikeWave(sessionId, ownerBody, def, now);
    } else if (kind === "silenceSweep" && !deferHit) {
      this.scheduleSilenceSweep(sessionId, ownerBody, def, now);
    } else if (kind === "firewall" && !deferHit) {
      this.scheduleFirewall(sessionId, ownerBody, def, now);
    } else if (kind === "poisonCloud" && !deferHit) {
      this.schedulePoisonCloud(sessionId, ownerBody, def, now);
    } else if (kind === "smokeBomb" && !deferHit) {
      this.scheduleSmokeBomb(sessionId, ownerBody, def, now);
    } else if (kind === "holyGround" && !deferHit) {
      this.scheduleHolyGround(sessionId, ownerBody, def, now);
    } else if (kind === "riftFissure" && !deferHit) {
      this.scheduleRiftFissure(sessionId, ownerBody, def, now);
    } else if (kind === "volcano" && !deferHit) {
      this.scheduleVolcano(sessionId, ownerBody, def, now);
    } else if (kind === "protectionBubble" && !deferHit) {
      this.scheduleProtectionBubble(sessionId, ownerBody, def, now);
    } else if (kind === "shrooms" && !deferHit) {
      this.armShrooms(sessionId, now);
    } else if (kind === "spiritForm" && !deferHit) {
      this.commitSpiritForm(sessionId, player, def, now);
    } else if (kind === "magmaOrbs" && !deferHit) {
      this.scheduleMagmaOrbs(sessionId, ownerBody, def, now);
    } else if (kind === "coneChannel" && !deferHit) {
      this.scheduleFrostMist(sessionId, def, now);
    } else if (kind === "healBeam" && !deferHit) {
      this.scheduleHealBeam(sessionId, def, now);
    } else if (kind === "lifeLeech" && !deferHit) {
      this.scheduleLifeLeech(sessionId, def, now);
    } else if (kind === "pulseHeal" && !deferHit) {
      const center = { x: player.x, z: player.z };
      const radius = def.radius ?? 7;
      this.fx({
        kind: "aoe",
        abilityId: def.id,
        x: center.x,
        z: center.z,
        radius,
        ownerId: sessionId,
      });
      this.scheduleGrooveHeal(sessionId, def, now);
    } else if (def.shape === "projectile") {
      if (this.sims.size < COMBAT.maxProjectiles) {
        const id = `p_${this.nextId++}`;
        const sim = createProjectile(id, ownerBody, def);
        if (sim) {
          if (abilityEffectKind(def) === "fireball") {
            const live = this.casts.get(sessionId);
            this.stampFireballProjectile(sim, live?.fireballCharge01 ?? 1);
          } else {
            this.applyTalentProjectileRadii(sessionId, sim);
          }
          this.stampProjectileBubblePass(sim, now);
          this.sims.set(id, sim);
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
      const center = travelLanding ?? { x: player.x, z: player.z };
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
    // dash / buff / deferred landing: travel-only here (+ optional self statuses)

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
    this.statuses.apply(sessionId, "counterArmed", sessionId, now, {
      durationMs: 1200,
    });
  }

  /** Root + red glow for the Revenge window (1.2s from cast start). */
  private commitRevengeCast(sessionId: string, now: number) {
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
    d.expiresAt = now + DECOY_LIFE_MS;
    this.room.state.decoys.set(id, d);
  }

  private advanceDecoys(dt: number, now: number) {
    const expired: string[] = [];
    this.room.state.decoys.forEach((d, id) => {
      if (now >= d.expiresAt) {
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
            this.applyDamage(hit.targetId, hit.damage, zone.ownerId, zone.abilityId, now);
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
              COMBAT.playerHitRadius,
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
            COMBAT.playerHitRadius,
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
   * Prefer forward plant; if an enemy occupies the spot (or wall blocks),
   * fan out to side / closer candidates.
   */
  private findRiftPlantPos(sessionId: string, ownerBody: CombatBody): Vec2 {
    const yaw = ownerBody.yaw;
    const origin = { x: ownerBody.x, z: ownerBody.z };
    const forward = RIFT_FISSURE_CAST.placeForward;
    const side = 1.4;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    const candidates: Vec2[] = [
      { x: origin.x + fx * forward, z: origin.z + fz * forward },
      { x: origin.x + fx * forward + rx * side, z: origin.z + fz * forward + rz * side },
      { x: origin.x + fx * forward - rx * side, z: origin.z + fz * forward - rz * side },
      { x: origin.x + fx * (forward * 0.55), z: origin.z + fz * (forward * 0.55) },
      {
        x: origin.x + fx * (forward * 0.55) + rx * side,
        z: origin.z + fz * (forward * 0.55) + rz * side,
      },
      {
        x: origin.x + fx * (forward * 0.55) - rx * side,
        z: origin.z + fz * (forward * 0.55) - rz * side,
      },
      { x: origin.x + fx * 1.2, z: origin.z + fz * 1.2 },
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
      x: origin.x + fx * 1.1,
      z: origin.z + fz * 1.1,
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
          COMBAT.playerHitRadius,
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
    const maxT = magmaOrbsMaxFlightTs(path, this.wallColliders, flightHitRadius);
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
                COMBAT.playerHitRadius,
              )) ||
            (rightAlive &&
              circlesOverlap(
                right.x,
                right.z,
                orb.flightHitRadius,
                body.x,
                body.z,
                COMBAT.playerHitRadius,
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
        this.applyDamage(hit.targetId, hit.damage, orb.ownerId, orb.abilityId, now);
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
            COMBAT.playerHitRadius,
          )
        ) {
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
            COMBAT.playerHitRadius,
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
                COMBAT.playerHitRadius,
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
              this.applyDamage(hit.targetId, hit.damage, zone.ownerId, zone.abilityId, now);
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
      { walls: this.wallColliders, softOcclude: true },
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
      { walls: this.wallColliders, softOcclude: true },
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
        { walls: this.wallColliders, softOcclude: true },
      );
      for (const hit of hits) {
        this.applyRawDamage(hit.targetId, hit.damage, mist.ownerId, mist.abilityId);
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
        continue;
      }
      this.applyDamage(hit.targetId, hit.damage, ownerId, abilityId, now);
      if (knock > 0) this.applyKnockback(center, hit.targetId, knock, knockMs, now);
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

  /** Schedule a radial shove (translated over knockbackMs, not teleported). */
  private applyKnockback(
    center: { x: number; z: number },
    targetId: string,
    distance: number,
    durationMs: number,
    now: number,
  ) {
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
    if (distance <= 0) return;
    const owner = this.room.state.players.get(ownerId);
    if (!owner) return;

    const origin = { x: owner.x, z: owner.z };
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
  ) {
    const dealt = this.applyRawDamage(targetId, damage, attackerSessionId, abilityId);
    if (!dealt) return;
    const def = ABILITIES[abilityId];
    if (def?.applyOnHit?.length) {
      this.applyOutgoingStatusApps(targetId, def.applyOnHit, attackerSessionId, now);
    }
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

  /** HP change + hit FX. Returns post-resist damage applied (0 if blocked / invuln / countered). */
  private applyRawDamage(
    targetId: string,
    damage: number,
    attackerSessionId: string,
    abilityId: string,
    opts?: { /** Default true — set false for fuse blasts / aura-like ticks. */ triggersCounter?: boolean },
  ): number {
    const now = Date.now();
    const atkDef = ABILITIES[abilityId];
    const dealtMul = this.statuses.getDamageDealtMul(attackerSessionId);
    const salvoMul = this.peekOpeningSalvoMul(attackerSessionId, abilityId, damage, now);
    const oppMul = this.peekOpportunistMul(attackerSessionId, targetId, abilityId, damage);
    const fifthMul = this.peekFifthCadenceMul(attackerSessionId, abilityId, damage);
    const scaledIn = damage > 0 ? damage * dealtMul * salvoMul * oppMul * fifthMul : damage;
    const allowCounter = opts?.triggersCounter !== false;

    // Armed Counter / Revenge: deny the next melee / direct projectile.
    if (
      allowCounter &&
      scaledIn > 0 &&
      this.room.state.players.has(targetId) &&
      abilityTriggersCounter(atkDef, abilityId)
    ) {
      if (this.statuses.has(targetId, "counterArmed")) {
        this.procCounter(targetId, now);
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
        return 0;
      }
      if (this.statuses.has(targetId, "revengeArmed")) {
        this.procRevenge(targetId, attackerSessionId, now);
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
        return 0;
      }
    }

    // Crit once at the gate — before resist/shields — so every damage path shares one RNG.
    const atkKit = this.kits.get(attackerSessionId);
    const crit =
      scaledIn > 0 &&
      rollCrit(atkKit?.critChance ?? COMBAT.critChance);
    const critMult =
      COMBAT.critMultiplier * (1 + (atkKit?.critDamageBonus ?? 0));
    const resistMul = this.statuses.getDamageTakenMul(targetId);
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
      });
      return damageForLeech;
    }

    const decoy = this.room.state.decoys.get(targetId);
    if (decoy) {
      if (scaledIn > 0) {
        this.noteDealtDamage(attackerSessionId, now);
        if (salvoMul > 1) this.commitOpeningSalvo(attackerSessionId, now);
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
      });
      this.room.state.decoys.delete(targetId);
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
      });
      if (target.hp <= 0) {
        this.hooks.onTargetKilled?.(targetId, attackerSessionId);
        // Hub practice dummies refill; wave mobs are removed.
        if (target.kind === "dummy") {
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
    this.statuses.apply(targetId, "counterHaste", targetId, now);
    this.statuses.apply(targetId, "counterEmpowered", targetId, now);
    const player = this.room.state.players.get(targetId);
    if (player) {
      const cast = this.casts.get(targetId);
      if (cast?.abilityId === "counter") {
        this.clearCastState(targetId, player);
        this.phaseFx(targetId, player, "counter", "idle", now);
      }
      this.syncInvulnerable(targetId, player, now);
    }
  }

  /**
   * Consume Revenge window → instant blink behind attacker, vanish briefly, then reappear.
   * If full behind is blocked, land closer along the behind line (never through walls).
   */
  private procRevenge(targetId: string, attackerId: string, now: number) {
    this.statuses.remove(targetId, "revengeArmed");
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
      this.clearCastState(targetId, player);
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
      });
    });
    this.room.state.decoys.forEach((d) => {
      bodies.push({
        id: d.id,
        x: d.x,
        z: d.z,
        yaw: d.yaw,
        hp: 1,
        maxHp: 1,
        vulnerable: true,
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
    extra?: { cooldownMs?: number; comboHit?: number; radius?: number },
  ) {
    this.fx({
      kind: "cast_phase",
      abilityId,
      x: player.x,
      z: player.z,
      ownerId: sessionId,
      phase,
      phaseEndsAt,
      cooldownMs: extra?.cooldownMs,
      comboHit: extra?.comboHit,
      radius: extra?.radius,
    });
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
