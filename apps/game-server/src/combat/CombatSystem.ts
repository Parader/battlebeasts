import type { Room } from "@colyseus/core";
import {
  ABILITIES,
  BARRIER_CAST,
  COLLISION,
  COMBAT,
  GROOVE_CAST,
  HEAL_BEAM_CAST,
  MOVE_SPEED,
  PRACTICE_DUMMY_MAX_HP,
  VOLCANO_CAST,
  MAGMA_ORBS_CAST,
  PROTECTION_BUBBLE_CAST,
  SHROOM_CAST,
  SPIRIT_FORM_CAST,
  REVENGE_CAST,
  HAND_SHIELD_CAST,
  HAND_SHIELD_ARMED_MS,
  abilityEffectKind,
  abilityTriggersCounter,
  abilityCanProcOpeningSalvo,
  canInterruptOtherCast,
  canPlayerCancelCast,
  channelChargeDistance,
  clampGroundAim,
  COMBAT_ENGAGE_LINGER_MS,
  OPENING_SALVO_COOLDOWN_MS,
  COMBAT_FX_VARIANT_WALL_HIT,
  createProjectile,
  dashOffset,
  isComboAbility,
  isInIFrameWindow,
  kitCooldownMs,
  length2,
  meleeCenter,
  moveAndCollide,
  nextCastPhase,
  unitCollidersExcept,
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
};

export type CastBeginOpts = {
  moveX?: number;
  moveZ?: number;
  aimX?: number;
  aimZ?: number;
};

/** How long the decoy clone stays in the world after spawn. */
const DECOY_LIFE_MS = 2500;
/** Drift speed matches walk so the clone sells the fake. */
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
  private pendingFirewalls: PendingFirewall[] = [];
  private pendingVolcanoes: PendingVolcano[] = [];
  private pendingMagmaOrbs: PendingMagmaOrbs[] = [];
  private pendingProtectionBubbles: PendingProtectionBubble[] = [];
  private pendingShrooms: PendingShroom[] = [];
  private pendingFrostMist: PendingFrostMist[] = [];
  private pendingGrooveHeal: PendingGrooveHeal[] = [];
  private pendingHealBeam: PendingHealBeam[] = [];
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
    talentCsv: string,
    talentBuild?: TalentBuild,
  ) {
    const talentIds = talentCsv.split(",").filter(Boolean);
    this.kits.set(sessionId, resolveKit(loadoutCsv, talentIds, talentBuild));
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

  private noteDealtDamage(attackerSessionId: string, now: number) {
    if (!attackerSessionId || !this.room.state.players.has(attackerSessionId)) return;
    const state = this.engageState(attackerSessionId, now);
    state.inCombatUntil = now + COMBAT_ENGAGE_LINGER_MS;
  }

  /** Authoritative move with player/static/volcano collision. */
  movePlayer(sessionId: string, from: Vec2, desired: Vec2): Vec2 {
    const me = this.room.state.players.get(sessionId);
    return moveAndCollide(
      from,
      desired,
      COLLISION.playerRadius,
      this.staticColliders,
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
      this.staticColliders,
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
      const cooldownMs = this.endComboEarly(targetId, abilityId, cast.effectFired, now);
      this.clearPendingFrostMist(targetId);
      this.clearPendingGrooveHeal(targetId);
      this.clearPendingHealBeam(targetId);
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
    const cooldownMs = this.endComboEarly(sessionId, abilityId, cast.effectFired, now);
    this.clearPendingFrostMist(sessionId);
    this.clearPendingGrooveHeal(sessionId);
    this.clearPendingHealBeam(sessionId);
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
    this.casts.delete(sessionId);
    this.travels.delete(sessionId);
    this.combos.delete(sessionId);
    this.kits.delete(sessionId);
    this.engageBySession.delete(sessionId);
    this.statuses.clearTarget(sessionId);
    this.clearOwnedDecoys(sessionId);
    this.clearSpiritForm(sessionId, Date.now(), false);
    this.clearSpiritReturn(sessionId);
    for (const [id, sim] of this.sims) {
      if (sim.ownerId === sessionId) {
        this.sims.delete(id);
        this.room.state.projectiles.delete(id);
      }
    }
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
    husk.color = player.color || "#4ade80";
    husk.pattern = player.pattern || "plain";
    husk.patternColor = player.patternColor || "#1f2937";
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
    const kit = this.kits.get(sessionId);
    const inLoadout = kit ? kit.loadoutIds.has(castId) : player.loadout.split(",").includes(castId);
    if (!inLoadout) return false;
    const def = ABILITIES[castId];
    if (!def) return false;
    if (player.disconnected || player.hp <= 0) return false;
    if (!this.statuses.canCast(sessionId)) return false;

    // Spirit Form recast: snap back without needing CD ready.
    if (castId === "spiritForm" && this.spiritForms.has(sessionId)) {
      this.endSpiritForm(sessionId, now);
      return true;
    }

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
        return false;
      }
    }

    // After soft-interrupt, travel from the old cast may be gone; still block if mid-travel of same/other
    if (this.travels.has(sessionId)) return false;

    let bag = this.cds.get(sessionId);
    if (!bag) {
      bag = new Map();
      this.cds.set(sessionId, bag);
    }
    if ((bag.get(castId) ?? 0) > now) return false;

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
    if (!first) return false;

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
  }

  tryCancelCast(sessionId: string, player: PlayerState, now: number): boolean {
    const cast = this.casts.get(sessionId);
    if (!cast) return false;
    const def = ABILITIES[cast.abilityId];
    if (!def) return false;
    if (!canPlayerCancelCast(def, cast.phase)) return false;

    this.revealCloak(sessionId);
    const cooldownMs = this.endComboEarly(sessionId, def.id, cast.effectFired, now);
    this.clearPendingFrostMist(sessionId);
    this.clearPendingGrooveHeal(sessionId);
    this.clearPendingHealBeam(sessionId);
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
   * Confirm hold-to-release channel (Portal). Teleports + stamps CD.
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
      this.tryCancelCast(sessionId, player, now);
      return false;
    }

    const dist = channelChargeDistance(def, elapsed);
    cast.yaw = player.yaw;
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
    this.advancePendingFirewalls(now);
    this.advancePendingVolcanoes(now);
    this.advancePendingMagmaOrbs(now);
    this.advancePendingProtectionBubbles(now);
    this.advancePendingShrooms(now);
    this.advancePendingFrostMist(now);
    this.advancePendingGrooveHeal(now);
    this.advancePendingHealBeam(now);
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
        this.statuses.applyApplications(
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
        if (player) this.clearCastState(sessionId, player);
        else {
          this.casts.delete(sessionId);
          this.travels.delete(sessionId);
        }
        continue;
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

      // Portal: grace timeout while channeling (before phase ends).
      if (cast.phase === "impact" && !cast.effectFired) {
        const defEarly = ABILITIES[cast.abilityId];
        if (defEarly?.confirmOnRelease) {
          const anchor = cast.channelAnchorAt ?? cast.castStartedAt;
          const chargeMs = defEarly.channelChargeMs ?? 1000;
          const graceMs = defEarly.channelCapGraceMs ?? 1000;
          if (now - anchor >= chargeMs + graceMs) {
            this.tryCancelCast(sessionId, player, now);
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

      // Confirm-on-release: impact ended without confirm → cancel (no CD).
      if (def.confirmOnRelease && cast.phase === "impact" && !cast.effectFired) {
        this.tryCancelCast(sessionId, player, now);
        continue;
      }

      if (next === "impact" && !cast.effectFired) {
        if (def.confirmOnRelease) {
          // Enter channel — wait for confirmCast / grace cancel.
          this.enterPhase(sessionId, player, def, next, now, cast.castStartedAt, {
            comboHit: this.comboHitFor(sessionId, def.id),
          });
          const live = this.casts.get(sessionId);
          if (live) live.channelAnchorAt = now;
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
        this.enterPhase(sessionId, player, def, next, now, cast.castStartedAt);
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
    },
  ) {
    const duration = Math.max(16, phaseDurationMs(def, phase));

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

    this.phaseFx(sessionId, player, def.id, phase, cast.phaseEndsAt, {
      ...fxExtra,
      comboHit: player.castComboHit || fxExtra?.comboHit,
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
    } else if (kind === "firewall" && !deferHit) {
      this.scheduleFirewall(sessionId, ownerBody, def, now);
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
      this.applyInstant(center, radius, def.damage, sessionId, def.id, now);
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
    const dir = normalize2(cast?.moveX ?? 0, cast?.moveZ ?? 0);
    const drifting = length2(dir.x, dir.z) > 1e-4;
    const id = `decoy_${this.nextId++}`;
    const d = new DecoyState();
    d.id = id;
    d.ownerSessionId = sessionId;
    d.x = player.x;
    d.z = player.z;
    d.yaw = player.yaw;
    d.vx = drifting ? dir.x * DECOY_SPEED : 0;
    d.vz = drifting ? dir.z * DECOY_SPEED : 0;
    d.color = player.color || "#4ade80";
    d.pattern = player.pattern || "plain";
    d.patternColor = player.patternColor || "#1f2937";
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
      const from = { x: d.x, z: d.z };
      const desired = { x: d.x + d.vx * dt, z: d.z + d.vz * dt };
      const next = sweepTravel(from, desired, COLLISION.playerRadius, this.staticColliders);
      // Stop if a wall fully blocked the step.
      if (length2(next.x - from.x, next.z - from.z) < 1e-5) {
        d.vx = 0;
        d.vz = 0;
      } else {
        d.x = next.x;
        d.z = next.z;
        // Keep release-time facing — do not turn into the drift direction.
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
      this.applyInstant(center, radius, def.damage, sessionId, def.id, now);
      return;
    }
    if (def.shape === "aoe") {
      // Leap Slam: hands hit the ground in front of the caster.
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
    const radius = def.radius ?? 0.55;
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
      radius: def.radius ?? 0.9,
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
    const meetRange = Math.max(2, def.range > 0 ? def.range : MAGMA_ORBS_CAST.meetRange);
    const path = buildMagmaOrbsFlightPath(ownerBody, yaw, meetRange);
    const blastRadius = Math.max(0.8, def.radius ?? MAGMA_ORBS_CAST.blastRadius);
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
            this.statuses.applyApplications(body.id, burn, orb.ownerId, now);
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
    for (const zone of this.pendingProtectionBubbles) {
      const st = this.room.state.protectionBubbles.get(zone.id);
      if (now >= zone.despawnAt) {
        this.room.state.protectionBubbles.delete(zone.id);
        continue;
      }
      if (zone.phase === "forming" && now >= zone.formEndsAt) {
        zone.phase = "active";
        if (st) st.phase = "active";
      }
      if (zone.phase === "active" && now >= zone.activeEndsAt) {
        zone.phase = "fading";
        if (st) st.phase = "fading";
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
    const triggerRadius = Math.max(0.35, def.radius ?? SHROOM_CAST.triggerRadius);
    const blastRadius = SHROOM_CAST.blastRadius;
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
    if (this.room.state.targets.has(targetId)) return true;
    const player = this.room.state.players.get(targetId);
    if (!player || player.disconnected || player.hp <= 0) return false;
    if (player.role === "spectator" || player.roundDead) return false;
    if (casterId === targetId) return true;
    const caster = this.room.state.players.get(casterId);
    if (caster?.team && player.team && caster.team !== player.team) return false;
    return true;
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
        this.statuses.applyApplications(
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
    const pos = clampGroundAim(ownerBody, aim, def.range > 0 ? def.range : 10);
    const collideRadius = Math.max(0.5, def.radius ?? VOLCANO_CAST.collideRadius);
    const blastRadius = VOLCANO_CAST.rockBlastRadius;
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
            this.statuses.applyApplications(body.id, burn, zone.ownerId, now);
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
    const endRange = Math.max(2, def.range);
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

  /** Allies (same team / hub) and practice dummies — never enemies. */
  private canHealBeamTarget(casterId: string, targetId: string): boolean {
    if (casterId === targetId) return false;
    if (this.room.state.targets.has(targetId)) return true;
    const player = this.room.state.players.get(targetId);
    if (!player || player.disconnected || player.hp <= 0) return false;
    if (player.role === "spectator" || player.roundDead) return false;
    const caster = this.room.state.players.get(casterId);
    if (caster?.team && player.team && caster.team !== player.team) return false;
    return true;
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
    for (const hit of hits) {
      this.applyDamage(hit.targetId, hit.damage, ownerId, abilityId, now);
      if (knock > 0) this.applyKnockback(center, hit.targetId, knock, knockMs, now);
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
      if (id === casterId) continue;
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
    if (healed > 0) {
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
    const travel = Math.min(distance, Math.max(0, len - minDist));
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
      this.statuses.applyApplications(targetId, def.applyOnHit, attackerSessionId, now);
    }
  }

  /** HP change + hit FX. Returns false if blocked (missing / invuln / countered). */
  private applyRawDamage(
    targetId: string,
    damage: number,
    attackerSessionId: string,
    abilityId: string,
    opts?: { /** Default true — set false for fuse blasts / aura-like ticks. */ triggersCounter?: boolean },
  ): boolean {
    const now = Date.now();
    const atkDef = ABILITIES[abilityId];
    const dealtMul = this.statuses.getDamageDealtMul(attackerSessionId);
    const salvoMul = this.peekOpeningSalvoMul(attackerSessionId, abilityId, damage, now);
    const scaledIn = damage > 0 ? damage * dealtMul * salvoMul : damage;
    const allowCounter = opts?.triggersCounter !== false;

    // Armed Counter / Revenge: deny the next melee / direct projectile.
    if (
      allowCounter &&
      scaledIn > 0 &&
      this.room.state.players.has(targetId) &&
      abilityTriggersCounter(atkDef)
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
        return false;
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
        return false;
      }
    }

    // Crit once at the gate — before resist/shields — so every damage path shares one RNG.
    const crit =
      scaledIn > 0 &&
      rollCrit(this.kits.get(attackerSessionId)?.critChance ?? COMBAT.critChance);
    const resistMul = this.statuses.getDamageTakenMul(targetId);
    let dealt = Math.max(0, Math.round(scaleForCrit(scaledIn, crit) * resistMul));
    dealt = this.statuses.absorbWithShields(targetId, dealt);

    const player = this.room.state.players.get(targetId);
    if (player) {
      if (player.invulnerable) return false;
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
      return true;
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
      return true;
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
      }
      return true;
    }
    return false;
  }

  /**
   * Restore HP on a player or practice dummy. Crit rolls once here for all heals.
   * Returns HP actually restored (0 if none).
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

    const player = this.room.state.players.get(targetId);
    if (player) {
      if (player.disconnected || player.hp <= 0) return 0;
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + healFor);
      const healed = player.hp - before;
      emit(player.x, player.z, healed);
      return healed;
    }

    const target = this.room.state.targets.get(targetId);
    if (target) {
      if (target.hp <= 0) return 0;
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + healFor);
      const healed = target.hp - before;
      emit(target.x, target.z, healed);
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
      const ideal = {
        x: attacker.x - forward.x * behindDist,
        z: attacker.z - forward.z * behindDist,
      };
      const from = { x: player.x, z: player.z };
      const landed = this.sweepPlayerPos(targetId, from, ideal);
      const clamped = this.clampPlayerPos(targetId, landed);

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
    extra?: { cooldownMs?: number; comboHit?: number },
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
    });
  }

  private fx(event: CombatFxEvent) {
    this.room.broadcast("combat_fx", event);
  }

  /** Apply ability cooldown; returns ms for client sync. */
  private startCooldown(sessionId: string, abilityId: string, now: number): number {
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

  /**
   * After an effect resolves: non-combo → start CD.
   * Combo → count hit; start CD only when chain completes.
   * Returns cooldownMs when CD started, else undefined.
   */
  private onEffectResolved(sessionId: string, def: AbilityDef, now: number): number | undefined {
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
