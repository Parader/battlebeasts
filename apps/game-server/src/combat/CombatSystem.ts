import type { Room } from "@colyseus/core";
import {
  ABILITIES,
  COLLISION,
  COMBAT,
  MOVE_SPEED,
  createProjectile,
  dashOffset,
  isInIFrameWindow,
  meleeCenter,
  moveAndCollide,
  moveMulForPhase,
  nextCastPhase,
  playerCollidersExcept,
  phaseDurationMs,
  resolveCollisions,
  resolveInstantHits,
  resolveTravel,
  ruptureCenter,
  sampleTravel,
  tickProjectiles,
  totalCastDurationMs,
  travelDistance,
  travelDurationMs,
  type AbilityDef,
  type CastPhaseId,
  type CircleCollider,
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
};

/**
 * Server-side combat: Anticipation → Cast → Impact → Recovery.
 * Cancel is only valid during anticipation (before commitment / effect).
 * Effect (projectile, hit, travel) resolves at impact start.
 * Travel can be instant or translated; i-frames are per-ability windows.
 * Statuses (stun/slow/DoT/…) are owned by StatusSystem.
 */
export class CombatSystem {
  private sims = new Map<string, ProjectileSim>();
  private cds = new Map<string, Map<string, number>>();
  private casts = new Map<string, ActiveCast>();
  private travels = new Map<string, ActiveTravel>();
  private nextId = 1;
  private hooks: CombatRoomHooks;
  private staticColliders: CircleCollider[] = [];
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

  setStaticColliders(colliders: CircleCollider[]) {
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

  /** Clamp a teleport/dash sample into free space. */
  clampPlayerPos(sessionId: string, pos: Vec2): Vec2 {
    return resolveCollisions(
      pos,
      COLLISION.playerRadius,
      this.staticColliders,
      playerCollidersExcept(this.room.state.players.entries(), sessionId),
    );
  }

  /** Force-cancel an in-progress cast (stun / silence). Clears travel too. */
  interruptCast(sessionId: string) {
    const player = this.room.state.players.get(sessionId);
    if (!player) return;
    const cast = this.casts.get(sessionId);
    if (!cast) return;
    const abilityId = cast.abilityId;
    this.travels.delete(sessionId);
    this.clearCastState(sessionId, player);
    this.phaseFx(sessionId, player, abilityId, "cancel", Date.now());
  }

  /**
   * Ability interrupt (e.g. Space during LMB): end caster phases/anim lock only.
   * Projectiles already spawned keep flying. Travel from the interrupted ability is dropped.
   */
  softInterruptCast(sessionId: string, player: PlayerState, now: number) {
    const cast = this.casts.get(sessionId);
    if (!cast) return;
    const abilityId = cast.abilityId;
    const travel = this.travels.get(sessionId);
    if (travel && travel.abilityId === abilityId) {
      this.travels.delete(sessionId);
    }
    this.casts.delete(sessionId);
    player.castAbilityId = "";
    player.castPhase = "";
    player.castPhaseEndsAt = 0;
    player.castLockUntil = 0;
    player.invulnerable = false;
    this.phaseFx(sessionId, player, abilityId, "interrupt", now);
  }

  ensurePracticeDummy(x: number, z: number) {
    if (this.room.state.targets.has("practice_dummy")) return;
    const t = new WorldTargetState();
    t.id = "practice_dummy";
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
    if (cast) {
      const def = ABILITIES[cast.abilityId];
      if (def) mul *= moveMulForPhase(def, cast.phase);
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

    if (first === "impact") {
      this.enterPhase(sessionId, player, def, "impact", now, now);
      this.fireEffect(sessionId, player, def, now);
      const live = this.casts.get(sessionId);
      if (live) live.effectFired = true;
      bag.set(castId, now + def.cooldownMs);
      this.syncInvulnerable(sessionId, player, now);
      return true;
    }

    this.enterPhase(sessionId, player, def, first, now, now);
    this.syncInvulnerable(sessionId, player, now);
    return true;
  }

  tryCancelCast(sessionId: string, player: PlayerState, now: number): boolean {
    const cast = this.casts.get(sessionId);
    if (!cast || cast.phase !== "anticipation") return false;
    const def = ABILITIES[cast.abilityId];
    if (!def) return false;
    if (def.timing.canCancelAnticipation === false) return false;

    this.clearCastState(sessionId, player);
    this.phaseFx(sessionId, player, def.id, "cancel", now);
    return true;
  }

  tick(dt: number, now: number) {
    this.advanceTravels(now);
    this.advanceCasts(now);
    this.syncAllInvulnerable(now);
    this.statuses.tick(now);

    if (this.sims.size === 0) return;

    const bodies = this.collectBodies();
    const list = [...this.sims.values()];
    const { removedIds, hits } = tickProjectiles(list, dt, bodies, (o, t) => this.canHurt(o, t));

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
      const progress = Math.min(1, Math.max(0, (now - travel.startAt) / dur));
      const pos = sampleTravel(
        { x: travel.fromX, z: travel.fromZ },
        travel.yaw,
        travel.distance,
        progress,
      );
      const clamped = this.clampPlayerPos(sessionId, pos);
      player.x = clamped.x;
      player.z = clamped.z;
      if (now >= travel.endAt) {
        this.travels.delete(sessionId);
      }
    }
  }

  private advanceCasts(now: number) {
    for (const [sessionId, cast] of [...this.casts.entries()]) {
      const player = this.room.state.players.get(sessionId);
      if (!player || player.disconnected || player.hp <= 0) {
        this.casts.delete(sessionId);
        this.travels.delete(sessionId);
        if (player) this.clearCastState(sessionId, player);
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
        this.clearCastState(sessionId, player);
        this.phaseFx(sessionId, player, def.id, "idle", now);
        continue;
      }

      this.enterPhase(sessionId, player, def, next, now, cast.castStartedAt);

      if (next === "impact" && !cast.effectFired) {
        const yawBefore = player.yaw;
        player.yaw = cast.yaw;
        this.fireEffect(sessionId, player, def, now);
        player.yaw = yawBefore;
        const live = this.casts.get(sessionId);
        if (live) live.effectFired = true;
        let bag = this.cds.get(sessionId);
        if (!bag) {
          bag = new Map();
          this.cds.set(sessionId, bag);
        }
        bag.set(def.id, now + def.cooldownMs);
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

    this.phaseFx(sessionId, player, def.id, phase, cast.phaseEndsAt);
  }

  private clearCastState(sessionId: string, player: PlayerState) {
    this.casts.delete(sessionId);
    this.travels.delete(sessionId);
    player.castAbilityId = "";
    player.castPhase = "";
    player.castPhaseEndsAt = 0;
    player.castLockUntil = 0;
    player.invulnerable = false;
  }

  private fireEffect(sessionId: string, player: PlayerState, def: AbilityDef, now: number) {
    const ownerBody = this.playerBody(sessionId, player);
    const travel = resolveTravel(def);

    // Travel can attach to any shape (dash default; future charges etc.)
    if (travel.mode === "instant") {
      const dist = travelDistance(def);
      const off = dashOffset(player.yaw, dist);
      const clamped = this.clampPlayerPos(sessionId, {
        x: player.x + off.x,
        z: player.z + off.z,
      });
      player.x = clamped.x;
      player.z = clamped.z;
      this.fx({ kind: "dash", abilityId: def.id, x: player.x, z: player.z, ownerId: sessionId });
    } else if (travel.mode === "translate") {
      const dist = travelDistance(def);
      const dur = travelDurationMs(def);
      this.travels.set(sessionId, {
        abilityId: def.id,
        fromX: player.x,
        fromZ: player.z,
        yaw: player.yaw,
        distance: dist,
        startAt: now,
        endAt: now + dur,
      });
      this.fx({
        kind: "dash",
        abilityId: def.id,
        x: player.x,
        z: player.z,
        ownerId: sessionId,
        radius: dist,
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
    } else if (def.shape === "melee") {
      const center = meleeCenter(ownerBody, def);
      const radius = def.radius ?? def.range;
      this.fx({
        kind: "melee",
        abilityId: def.id,
        x: center.x,
        z: center.z,
        radius,
        ownerId: sessionId,
      });
      this.applyInstant(center, radius, def.damage, sessionId, def.id, now);
    } else if (def.shape === "aoe") {
      const center =
        def.id === "rupture" ? ruptureCenter(ownerBody, def) : { x: player.x, z: player.z };
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
    // dash: travel-only (+ optional self statuses)

    this.statuses.applyApplications(sessionId, def.applyOnSelf, sessionId, now);
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
  ) {
    this.fx({
      kind: "cast_phase",
      abilityId,
      x: player.x,
      z: player.z,
      ownerId: sessionId,
      phase,
      phaseEndsAt,
    });
  }

  private fx(event: CombatFxEvent) {
    this.room.broadcast("combat_fx", event);
  }
}
