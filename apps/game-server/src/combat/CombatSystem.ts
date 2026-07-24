import type { Room } from "@colyseus/core";
import {
  ABILITIES,
  COLLISION,
  COMBAT,
  MOVE_SPEED,
  canPlayerCancelCast,
  createProjectile,
  dashOffset,
  isComboAbility,
  isInIFrameWindow,
  length2,
  meleeCenter,
  moveAndCollide,
  nextCastPhase,
  playerCollidersExcept,
  phaseDurationMs,
  pointInFront,
  resolveCastMoveMul,
  resolveComboContinueMoveMul,
  resolveCollisions,
  resolveInstantHits,
  resolveTravel,
  ruptureCenter,
  sampleTravel,
  sweepTravel,
  tickProjectiles,
  totalCastDurationMs,
  travelDistance,
  travelDurationMs,
  travelProgress01,
  travelTakeoffDelayMs,
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
  PlayerState,
  ProjectileState,
  WorldTargetState,
} from "../schema/BaseCityState.js";
import { StatusSystem } from "../status/StatusSystem.js";

export type CombatRoomHooks = {
  canHurtPlayers: boolean;
  onTargetDamaged?: (targetId: string, damage: number, attackerSessionId: string) => void;
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
};

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

type ActiveCombo = {
  abilityId: string;
  hitsDone: number;
  /** After a swing ends; 0 while still casting that swing. */
  continueUntil: number;
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
  private combos = new Map<string, ActiveCombo>();
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
      playerCollidersExcept(this.room.state.players.entries(), sessionId),
    );
  }

  /** Clamp a teleport/dash sample into free space (swept so we can't skip walls). */
  clampPlayerPos(sessionId: string, pos: Vec2): Vec2 {
    return resolveCollisions(
      pos,
      COLLISION.playerRadius,
      this.staticColliders,
      playerCollidersExcept(this.room.state.players.entries(), sessionId),
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
    this.clearCastState(sessionId, player);
    this.phaseFx(sessionId, player, abilityId, "interrupt", now, { cooldownMs });
  }

  ensurePracticeDummy(x: number, z: number, id = "practice_dummy") {
    if (this.room.state.targets.has(id)) return;
    const t = new WorldTargetState();
    t.id = id;
    t.kind = "dummy";
    t.x = x;
    t.z = z;
    t.hp = 200;
    t.maxHp = 200;
    this.room.state.targets.set(t.id, t);
  }

  clearSession(sessionId: string) {
    this.cds.delete(sessionId);
    this.casts.delete(sessionId);
    this.travels.delete(sessionId);
    this.combos.delete(sessionId);
    this.statuses.clearTarget(sessionId);
    for (const [id, sim] of this.sims) {
      if (sim.ownerId === sessionId) {
        this.sims.delete(id);
        this.room.state.projectiles.delete(id);
      }
    }
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

  tryBeginCast(sessionId: string, player: PlayerState, castId: string, now: number): boolean {
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
        def.interruptsOtherCasts === true && cur?.interruptible !== false && existing.abilityId !== castId;
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

    const first = nextCastPhase(def, null);
    if (!first) return false;

    this.beginComboHitIndex(sessionId, player, def);

    if (first === "impact") {
      this.fireEffect(sessionId, player, def, now);
      const cooldownMs = this.onEffectResolved(sessionId, def, now);
      this.enterPhase(sessionId, player, def, "impact", now, now, {
        cooldownMs,
        comboHit: this.comboHitFor(sessionId, def.id),
      });
      const live = this.casts.get(sessionId);
      if (live) live.effectFired = true;
      this.syncInvulnerable(sessionId, player, now);
      return true;
    }

    this.enterPhase(sessionId, player, def, first, now, now);
    this.syncInvulnerable(sessionId, player, now);
    return true;
  }

  tryCancelCast(sessionId: string, player: PlayerState, now: number): boolean {
    const cast = this.casts.get(sessionId);
    if (!cast) return false;
    const def = ABILITIES[cast.abilityId];
    if (!def) return false;
    if (!canPlayerCancelCast(def, cast.phase)) return false;

    const cooldownMs = this.endComboEarly(sessionId, def.id, cast.effectFired, now);
    this.clearCastState(sessionId, player);
    this.phaseFx(sessionId, player, def.id, "cancel", now, { cooldownMs });
    return true;
  }

  tick(dt: number, now: number) {
    this.advanceTravels(now);
    this.advanceCasts(now);
    this.advanceCombos(now);
    this.syncAllInvulnerable(now);
    this.statuses.tick(now);

    if (this.sims.size === 0) return;

    const bodies = this.collectBodies();
    const list = [...this.sims.values()];
    const walls = this.staticColliders.filter(
      (c): c is Extract<StaticCollider, { shape: "walls" }> => c.shape === "walls",
    );
    const { removedIds, hits } = tickProjectiles(
      list,
      dt,
      bodies,
      (o, t) => this.canHurt(o, t),
      walls,
    );

    for (const hit of hits) {
      this.applyDamage(hit.targetId, hit.damage, hit.ownerId, hit.abilityId);
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
        if (player) this.clearCastState(sessionId, player);
        else {
          this.casts.delete(sessionId);
          this.travels.delete(sessionId);
        }
        continue;
      }

      // Aim tracks during anticipation only — cast/impact lock silhouette facing
      if (cast.phase === "anticipation") {
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
    fxExtra?: { cooldownMs?: number; comboHit?: number },
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
      const center =
        def.id === "rupture"
          ? ruptureCenter(ownerBody, def)
          : (travelLanding ?? { x: player.x, z: player.z });
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
    // dash / deferred landing: travel-only here (+ optional self statuses)

    this.statuses.applyApplications(sessionId, def.applyOnSelf, sessionId, now);
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
    for (const hit of hits) {
      this.applyDamage(hit.targetId, hit.damage, ownerId, abilityId, now);
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
    const player = this.room.state.players.get(targetId);
    if (player) {
      if (player.invulnerable) return false;
      player.hp = Math.max(0, player.hp - damage);
      this.hooks.onPlayerDamaged?.(targetId, damage, attackerSessionId);
      this.fx({
        kind: "hit",
        abilityId,
        x: player.x,
        z: player.z,
        ownerId: attackerSessionId,
        targetId,
        damage,
      });
      return true;
    }

    const target = this.room.state.targets.get(targetId);
    if (target) {
      target.hp = Math.max(0, target.hp - damage);
      this.hooks.onTargetDamaged?.(targetId, damage, attackerSessionId);
      this.fx({
        kind: "hit",
        abilityId,
        x: target.x,
        z: target.z,
        ownerId: attackerSessionId,
        targetId,
        damage,
      });
      if (target.hp <= 0) {
        target.hp = target.maxHp;
        target.statuses.clear();
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
    if (this.room.state.targets.has(targetId)) return true;
    if (!this.hooks.canHurtPlayers) return false;
    if (ownerId === targetId) return false;
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
        yaw: 0,
        hp: t.hp,
        maxHp: t.maxHp,
        vulnerable: t.hp > 0,
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
