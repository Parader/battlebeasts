import type { Room } from "@colyseus/core";
import {
  ABILITIES,
  COLLISION,
  COMBAT,
  MOVE_SPEED,
  canPlayerCancelCast,
  createProjectile,
  dashOffset,
  isChannelAbility,
  isComboAbility,
  isInIFrameWindow,
  length2,
  meleeCenter,
  moveAndCollide,
  nextCastPhase,
  unitCollidersExcept,
  phaseDurationMs,
  pointInFront,
  resolveCastMoveMul,
  resolveComboContinueMoveMul,
  resolveCollisions,
  resolveInstantHits,
  resolveTravel,
  resolveConeHits,
  sampleTravel,
  spikeLinePoints,
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
  type StaticCollider,
  type CombatBody,
  type CombatFxEvent,
  type ProjectileSim,
  type Vec2,
} from "@battlebeasts/shared";
import {
  BaseCityState,
  DecoyState,
  PlayerState,
  ProjectileState,
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
  yaw: number;
  effectFired: boolean;
  /** Stick direction frozen at cast start (Decoy drift). */
  moveX: number;
  moveZ: number;
};

export type CastBeginOpts = {
  moveX?: number;
  moveZ?: number;
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
  private knockbacks = new Map<string, ActiveKnockback>();
  private combos = new Map<string, ActiveCombo>();
  private pendingSpikes: PendingSpike[] = [];
  private pendingFrostMist: PendingFrostMist[] = [];
  private pendingGrooveHeal: PendingGrooveHeal[] = [];
  /** Original spawn pose for practice dummies (respawn here on death). */
  private targetSpawns = new Map<string, { x: number; z: number }>();
  private nextId = 1;
  private hooks: CombatRoomHooks;
  private staticColliders: StaticCollider[] = [];
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
    });
  }

  setHooks(hooks: Partial<CombatRoomHooks>) {
    this.hooks = { ...this.hooks, ...hooks };
  }

  setStaticColliders(colliders: StaticCollider[]) {
    this.staticColliders = colliders;
  }

  /** Authoritative move with player/static collision. */
  movePlayer(sessionId: string, from: Vec2, desired: Vec2): Vec2 {
    return moveAndCollide(
      from,
      desired,
      COLLISION.playerRadius,
      this.staticColliders,
      unitCollidersExcept(
        this.room.state.players.entries(),
        this.room.state.targets.entries(),
        sessionId,
      ),
    );
  }

  /** Clamp a teleport/dash sample into free space (swept so we can't skip walls). */
  clampPlayerPos(sessionId: string, pos: Vec2): Vec2 {
    return resolveCollisions(
      pos,
      COLLISION.playerRadius,
      this.staticColliders,
      unitCollidersExcept(
        this.room.state.players.entries(),
        this.room.state.targets.entries(),
        sessionId,
      ),
    );
  }

  /** Sweep from → to for dashes / charges (through enemies; stop on walls). */
  sweepPlayerPos(_sessionId: string, from: Vec2, to: Vec2): Vec2 {
    return sweepTravel(from, to, COLLISION.playerRadius, this.staticColliders);
  }

  /** Force-cancel an in-progress cast (stun / silence). Clears travel too. */
  interruptCast(sessionId: string) {
    const player = this.room.state.players.get(sessionId);
    if (!player) return;
    const cast = this.casts.get(sessionId);
    if (!cast) return;
    const abilityId = cast.abilityId;
    const now = Date.now();
    this.travels.delete(sessionId);
    const cooldownMs = this.endComboEarly(sessionId, abilityId, cast.effectFired, now);
    this.clearPendingFrostMist(sessionId);
    this.clearPendingGrooveHeal(sessionId);
    this.clearCastState(sessionId, player);
    this.phaseFx(sessionId, player, abilityId, "cancel", now, { cooldownMs });
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
    t.hp = 200;
    t.maxHp = 200;
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
    this.room.state.projectiles.set(id, st);
    return true;
  }

  clearSession(sessionId: string) {
    this.cds.delete(sessionId);
    this.casts.delete(sessionId);
    this.travels.delete(sessionId);
    this.combos.delete(sessionId);
    this.statuses.clearTarget(sessionId);
    this.clearOwnedDecoys(sessionId);
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
    return base * this.getMoveMultiplier(sessionId);
  }

  tryBeginCast(
    sessionId: string,
    player: PlayerState,
    castId: string,
    now: number,
    opts?: CastBeginOpts,
  ): boolean {
    const loadout = player.loadout.split(",").filter(Boolean);
    if (!loadout.includes(castId)) return false;
    const def = ABILITIES[castId];
    if (!def) return false;
    if (player.disconnected || player.hp <= 0) return false;
    if (!this.statuses.canCast(sessionId)) return false;

    const existing = this.casts.get(sessionId);
    if (existing) {
      const cur = ABILITIES[existing.abilityId];
      const canCut =
        def.interruptsOtherCasts === true &&
        cur?.interruptible !== false &&
        !isChannelAbility(cur) &&
        existing.abilityId !== castId;
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
      });
      this.fireEffect(sessionId, player, def, now);
      const cooldownMs = this.onEffectResolved(sessionId, def, now);
      this.enterPhase(sessionId, player, def, "impact", now, now, {
        cooldownMs,
        comboHit: this.comboHitFor(sessionId, def.id),
        moveX,
        moveZ,
      });
      const live = this.casts.get(sessionId);
      if (live) live.effectFired = true;
      this.syncInvulnerable(sessionId, player, now);
      return true;
    }

    this.enterPhase(sessionId, player, def, first, now, now, { moveX, moveZ });
    // Decoy: clone + cloak commit immediately so the fake appears before the crouch.
    if (def.id === "decoy") {
      this.commitDecoyCast(sessionId, player, def, now);
    }
    this.syncInvulnerable(sessionId, player, now);
    return true;
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
    this.clearCastState(sessionId, player);
    this.phaseFx(sessionId, player, def.id, "cancel", now, { cooldownMs });
    return true;
  }

  tick(dt: number, now: number) {
    this.advanceTravels(now);
    this.advanceKnockbacks(now);
    this.advanceCasts(now);
    this.advanceCombos(now);
    this.advancePendingSpikes(now);
    this.advancePendingFrostMist(now);
    this.advancePendingGrooveHeal(now);
    this.advanceDecoys(dt, now);
    this.syncAllInvulnerable(now);
    this.statuses.tick(now);

    if (this.sims.size === 0) return;

    const bodies = this.collectBodies();
    const list = [...this.sims.values()];
    const walls = this.staticColliders.filter(
      (c): c is Extract<StaticCollider, { shape: "walls" }> => c.shape === "walls",
    );
    const { removedIds, hits, slows } = tickProjectiles(
      list,
      dt,
      bodies,
      (o, t) => this.canHurt(o, t),
      walls,
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
        this.applyPull(hit.ownerId, hit.targetId, def.pull, def.pullMs ?? 280, now, def.pullStopDistance);
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
    for (const id of removedIds) {
      this.sims.delete(id);
      this.room.state.projectiles.delete(id);
    }
    for (const [id, sim] of this.sims) {
      const st = this.room.state.projectiles.get(id);
      if (!st) continue;
      st.x = sim.x;
      st.z = sim.z;
    }
  }

  private advanceKnockbacks(now: number) {
    for (const [id, kb] of [...this.knockbacks.entries()]) {
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
      } else {
        const target = this.room.state.targets.get(id);
        if (!target) {
          this.knockbacks.delete(id);
          continue;
        }
        target.x = clamped.x;
        target.z = clamped.z;
      }

      if (now >= kb.endAt) this.knockbacks.delete(id);
    }
  }

  private advanceTravels(now: number) {
    for (const [sessionId, travel] of [...this.travels.entries()]) {
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
      const clamped = this.sweepPlayerPos(
        sessionId,
        { x: travel.fromX, z: travel.fromZ },
        pos,
      );
      player.x = clamped.x;
      player.z = clamped.z;
      if (now >= travel.endAt) {
        const pending = travel.pendingLandingEffect;
        const abilityId = travel.abilityId;
        this.travels.delete(sessionId);
        if (pending) {
          const landDef = ABILITIES[abilityId];
          if (landDef) this.resolveLandingEffect(sessionId, player, landDef, now);
        }
      }
    }
  }

  private advanceCasts(now: number) {
    for (const [sessionId, cast] of [...this.casts.entries()]) {
      const player = this.room.state.players.get(sessionId);
      if (!player || player.disconnected || player.hp <= 0) {
        this.endComboEarly(sessionId, cast.abilityId, cast.effectFired, now);
        this.clearPendingFrostMist(sessionId);
        this.clearPendingGrooveHeal(sessionId);
        if (player) this.clearCastState(sessionId, player);
        else {
          this.casts.delete(sessionId);
          this.travels.delete(sessionId);
        }
        continue;
      }

      // Aim tracks through windup and air so Leap Slam follows the mouse.
      if (cast.phase === "anticipation" || cast.phase === "cast" || cast.phase === "impact") {
        cast.yaw = player.yaw;
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

      if (next === "impact" && !cast.effectFired) {
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
      } else {
        this.enterPhase(sessionId, player, def, next, now, cast.castStartedAt);
      }
    }
  }

  private advanceCombos(now: number) {
    for (const [sessionId, combo] of [...this.combos.entries()]) {
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
    },
  ) {
    const duration = Math.max(16, phaseDurationMs(def, phase));

    const prev = this.casts.get(sessionId);
    const cast: ActiveCast = {
      abilityId: def.id,
      phase,
      phaseEndsAt: now + duration,
      castStartedAt,
      yaw: prev?.yaw ?? player.yaw,
      effectFired: prev?.effectFired ?? false,
      moveX: fxExtra?.moveX ?? prev?.moveX ?? 0,
      moveZ: fxExtra?.moveZ ?? prev?.moveZ ?? 0,
    };
    this.casts.set(sessionId, cast);

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
      });
    }

    if (def.shape === "projectile") {
      if (this.sims.size < COMBAT.maxProjectiles) {
        const id = `p_${this.nextId++}`;
        const sim = createProjectile(id, ownerBody, def);
        if (sim) {
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
      if (def.id === "spikes") {
        this.scheduleSpikeWave(sessionId, ownerBody, def, now);
      } else if (def.id === "frostMist") {
        this.scheduleFrostMist(sessionId, def, now);
      } else if (def.id === "groove") {
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
      } else {
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
    } else if (def.id === "decoy") {
      // Clone + cloak already committed at cast begin (see commitDecoyCast).
    }
    // dash / deferred landing: travel-only here (+ optional self statuses)

    if (def.id !== "decoy") {
      this.statuses.applyApplications(sessionId, def.applyOnSelf, sessionId, now);
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

      const walls = this.staticColliders.filter(
        (c): c is Extract<StaticCollider, { shape: "walls" }> => c.shape === "walls",
      );
      const hits = resolveConeHits(
        { x: owner.x, z: owner.z },
        owner.yaw,
        length,
        halfAngle,
        mist.damage,
        mist.ownerId,
        this.collectBodies(),
        (o, tid) => this.canHurt(o, tid),
        { walls, softOcclude: true },
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
   * HP actually restored to others that tick.
   */
  private applyGrooveHealPulse(
    center: { x: number; z: number },
    radius: number,
    amount: number,
    casterId: string,
    abilityId: string,
  ) {
    if (!(amount > 0) || !(radius > 0)) return;
    const soft = COLLISION.playerRadius;

    const emitHeal = (id: string, x: number, z: number, before: number, after: number) => {
      const healed = after - before;
      if (healed <= 0) return;
      this.fx({
        kind: "hit",
        abilityId,
        x,
        z,
        damage: healed,
        ownerId: casterId,
        targetId: id,
      });
    };

    let healedOthers = 0;

    for (const [id, player] of this.room.state.players) {
      if (id === casterId) continue;
      if (player.disconnected || player.hp <= 0) continue;
      const dist = Math.hypot(player.x - center.x, player.z - center.z);
      if (dist > radius + soft) continue;
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + amount);
      const gained = player.hp - before;
      healedOthers += gained;
      emitHeal(id, player.x, player.z, before, player.hp);
    }

    for (const [id, target] of this.room.state.targets) {
      if (target.hp <= 0) continue;
      const dist = Math.hypot(target.x - center.x, target.z - center.z);
      if (dist > radius + soft) continue;
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + amount);
      const gained = target.hp - before;
      healedOthers += gained;
      emitHeal(id, target.x, target.z, before, target.hp);
    }

    const selfHeal = Math.floor(healedOthers / 2);
    if (selfHeal <= 0) return;
    const caster = this.room.state.players.get(casterId);
    if (!caster || caster.disconnected || caster.hp <= 0) return;
    const before = caster.hp;
    caster.hp = Math.min(caster.maxHp, caster.hp + selfHeal);
    emitHeal(casterId, caster.x, caster.z, before, caster.hp);
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

  /** HP change + hit FX. Returns false if blocked (missing / invuln). */
  private applyRawDamage(
    targetId: string,
    damage: number,
    attackerSessionId: string,
    abilityId: string,
  ): boolean {
    const resistMul = this.statuses.getDamageTakenMul(targetId);
    const dealt = Math.max(0, Math.round(damage * resistMul));

    const player = this.room.state.players.get(targetId);
    if (player) {
      if (player.invulnerable) return false;
      player.hp = Math.max(0, player.hp - dealt);
      this.hooks.onPlayerDamaged?.(targetId, dealt, attackerSessionId);
      this.fx({
        kind: "hit",
        abilityId,
        x: player.x,
        z: player.z,
        ownerId: attackerSessionId,
        targetId,
        damage: dealt,
      });
      return true;
    }

    const decoy = this.room.state.decoys.get(targetId);
    if (decoy) {
      this.fx({
        kind: "hit",
        abilityId,
        x: decoy.x,
        z: decoy.z,
        ownerId: attackerSessionId,
        targetId,
        damage: dealt,
      });
      this.room.state.decoys.delete(targetId);
      return true;
    }

    const target = this.room.state.targets.get(targetId);
    if (target) {
      target.hp = Math.max(0, target.hp - dealt);
      this.hooks.onTargetDamaged?.(targetId, dealt, attackerSessionId);
      this.fx({
        kind: "hit",
        abilityId,
        x: target.x,
        z: target.z,
        ownerId: attackerSessionId,
        targetId,
        damage: dealt,
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

  private syncAllInvulnerable(now: number) {
    this.room.state.players.forEach((player, sessionId) => {
      this.syncInvulnerable(sessionId, player, now);
    });
  }

  private syncInvulnerable(sessionId: string, player: PlayerState, now: number) {
    const cast = this.casts.get(sessionId);
    if (!cast) {
      player.invulnerable = false;
      return;
    }
    const def = ABILITIES[cast.abilityId];
    if (!def) {
      player.invulnerable = false;
      return;
    }
    player.invulnerable = isInIFrameWindow(def, now - cast.castStartedAt);
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
    // Practice dummies may bolt players even when hub PvP is off.
    if (this.room.state.targets.has(ownerId) && this.room.state.players.has(targetId)) {
      return true;
    }
    if (!this.hooks.canHurtPlayers) return false;
    return this.room.state.players.has(targetId);
  }

  private collectBodies(): CombatBody[] {
    const bodies: CombatBody[] = [];
    this.room.state.players.forEach((p, sessionId) => {
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
    const cooldownMs = def?.cooldownMs ?? 0;
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
