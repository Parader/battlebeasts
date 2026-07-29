import {
  ABILITIES,
  COLLISION,
  MOVE_SPEED,
  applyMovement,
  baseCityStaticColliders,
  length2,
  moveAndCollide,
  resolveCastMoveMul,
  resolveComboContinueMoveMul,
  sampleTravel,
  sweepTravel,
  travelDistance,
  travelDurationMs,
  travelProgress01,
  travelTakeoffDelayMs,
  resolveTravel,
  type CastPhaseId,
  type CircleCollider,
  type PlayerInput,
  type StaticCollider,
} from "@battlebeasts/shared";

export type PredictedState = {
  x: number;
  z: number;
  yaw: number;
};

type LocalTravel = {
  abilityId: string;
  fromX: number;
  fromZ: number;
  yaw: number;
  distance: number;
  startMs: number;
  durationMs: number;
  /** Spirit Form return — ignore walls. */
  ignoreCollision?: boolean;
};

function isActiveCastPhase(phase: string | undefined): phase is CastPhaseId {
  return (
    phase === "anticipation" ||
    phase === "cast" ||
    phase === "impact" ||
    phase === "recovery"
  );
}

function stepPredicted(
  state: PredictedState,
  input: PlayerInput,
  moveMul: number,
  staticColliders: StaticCollider[],
  dynamicColliders: CircleCollider[],
): PredictedState {
  const next = { ...state, yaw: input.yaw };
  const desired = applyMovement(next, input, MOVE_SPEED * moveMul);
  // Match server walk: slide with moveAndCollide (sweep is for dashes / long travel).
  const clamped = moveAndCollide(
    next,
    desired,
    COLLISION.playerRadius,
    staticColliders,
    dynamicColliders,
  );
  return { x: clamped.x, z: clamped.z, yaw: input.yaw };
}

/**
 * Client-side movement prediction.
 * Cast / combo move muls mirror server `resolveCastMoveMul` + continue-window rules.
 * Status haste/slow multiplies on top (e.g. Surge).
 */
export class LocalPredictor {
  state: PredictedState = { x: 0, z: 0, yaw: 0 };
  private pending: PlayerInput[] = [];
  private seeded = false;
  /** Cast / combo window multiplier. */
  moveMul = 1;
  /** Active status move multiplier (haste/slow). */
  statusMoveMul = 1;
  /** Ability id while a combo continue-window slow is active. */
  private comboGapAbilityId: string | null = null;
  private comboGapUntil = 0;
  private travel: LocalTravel | null = null;
  private staticColliders: StaticCollider[] = baseCityStaticColliders();
  private dynamicColliders: CircleCollider[] = [];

  seed(x: number, z: number, yaw: number) {
    this.state = { x, z, yaw };
    this.pending = [];
    this.seeded = true;
    this.travel = null;
    this.clearMoveMul();
    this.statusMoveMul = 1;
  }

  get isSeeded() {
    return this.seeded;
  }

  setWorldColliders(
    staticColliders: StaticCollider[],
    dynamicColliders: CircleCollider[] = [],
  ) {
    this.staticColliders = staticColliders;
    this.dynamicColliders = dynamicColliders;
  }

  /** Sync status-derived move mul from server (combineStatusMoveMul). */
  setStatusMoveMul(mul: number) {
    this.statusMoveMul = Number.isFinite(mul) ? Math.max(0, mul) : 1;
  }

  private effectiveMoveMul(): number {
    return this.moveMul * this.statusMoveMul;
  }

  /**
   * Mirror server cast slow for an active phase.
   * Call only for anticipation/cast/impact/recovery.
   */
  applyCastMove(abilityId: string, phase: string) {
    if (!isActiveCastPhase(phase)) {
      this.clearMoveMul();
      return;
    }
    const def = ABILITIES[abilityId];
    if (!def) {
      this.clearMoveMul();
      return;
    }
    this.comboGapAbilityId = null;
    this.comboGapUntil = 0;
    this.moveMul = resolveCastMoveMul(def, phase);
  }

  /**
   * Mirror server continue-window slow between combo swings.
   * Call on cast idle when the server did not start cooldown.
   */
  applyComboContinue(abilityId: string) {
    const def = ABILITIES[abilityId];
    const windowMs = def?.combo?.continueWindowMs;
    if (windowMs == null) {
      this.clearMoveMul();
      return;
    }
    this.comboGapAbilityId = abilityId;
    this.comboGapUntil = performance.now() + windowMs;
    this.moveMul = resolveComboContinueMoveMul(def);
  }

  /** End all cast/combo slows (CD started, free cancel, interrupt, leave). */
  clearMoveMul() {
    this.comboGapAbilityId = null;
    this.comboGapUntil = 0;
    this.moveMul = 1;
  }

  /** True while a combo continue-window slow is still active. */
  isInComboGap(): boolean {
    return Boolean(this.comboGapAbilityId && performance.now() < this.comboGapUntil);
  }

  beginTravelFromCast(abilityId: string, yaw: number) {
    const def = ABILITIES[abilityId];
    if (!def) return;
    const travel = resolveTravel(def);
    // Hold-to-confirm blinks wait for confirmCast — don't snap on impact enter.
    if (def.confirmOnRelease) return;
    if (travel.mode === "instant") {
      const dist = travelDistance(def);
      const ideal = sampleTravel(this.state, yaw, dist, 1);
      const clamped = sweepTravel(
        this.state,
        ideal,
        COLLISION.playerRadius,
        this.staticColliders,
      );
      this.state = { ...this.state, x: clamped.x, z: clamped.z, yaw };
      this.travel = null;
      return;
    }
    if (travel.mode !== "translate") return;
    const dist = travelDistance(def);
    const dur = travelDurationMs(def);
    const from = { x: this.state.x, z: this.state.z };
    const ideal = sampleTravel(from, yaw, dist, 1);
    const clamped = sweepTravel(from, ideal, COLLISION.playerRadius, this.staticColliders);
    const actualDist = length2(clamped.x - from.x, clamped.z - from.z);
    const scale = dist > 1e-6 ? Math.min(1, actualDist / dist) : 0;
    this.travel = {
      abilityId,
      fromX: from.x,
      fromZ: from.z,
      yaw,
      distance: dist * scale,
      startMs: performance.now() + travelTakeoffDelayMs(def),
      durationMs: Math.max(16, dur * Math.max(0.05, scale)),
    };
  }

  /** Optimistic Portal blink at a charged distance. */
  beginInstantBlink(abilityId: string, yaw: number, distance: number) {
    const ideal = sampleTravel(this.state, yaw, Math.max(0, distance), 1);
    const clamped = sweepTravel(
      this.state,
      ideal,
      COLLISION.playerRadius,
      this.staticColliders,
    );
    this.state = { ...this.state, x: clamped.x, z: clamped.z, yaw };
    this.travel = null;
  }

  /** Dash toward a world point (Spirit Form return) — no wall collision. */
  beginPointTravel(toX: number, toZ: number, durationMs: number) {
    const from = { x: this.state.x, z: this.state.z };
    const dx = toX - from.x;
    const dz = toZ - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) {
      this.state = { ...this.state, x: toX, z: toZ };
      this.travel = null;
      return;
    }
    this.travel = {
      abilityId: "spiritForm",
      fromX: from.x,
      fromZ: from.z,
      yaw: Math.atan2(dx, dz),
      distance: dist,
      startMs: performance.now(),
      durationMs: Math.max(16, durationMs),
      ignoreCollision: true,
    };
  }

  clearTravel() {
    this.travel = null;
  }

  predict(input: PlayerInput): PredictedState {
    this.pending.push(input);
    if (this.pending.length > 128) this.pending.shift();

    if (this.comboGapAbilityId && performance.now() >= this.comboGapUntil) {
      this.clearMoveMul();
    }

    const now = performance.now();
    if (this.travel && now >= this.travel.startMs + this.travel.durationMs) {
      const ideal = sampleTravel(
        { x: this.travel.fromX, z: this.travel.fromZ },
        this.travel.yaw,
        this.travel.distance,
        1,
      );
      const landed = this.travel.ignoreCollision
        ? ideal
        : sweepTravel(
            { x: this.travel.fromX, z: this.travel.fromZ },
            ideal,
            COLLISION.playerRadius,
            this.staticColliders,
          );
      this.state = { ...this.state, x: landed.x, z: landed.z, yaw: input.yaw };
      this.travel = null;
    }

    if (this.travel) {
      const t = this.travel;
      const linear = Math.min(1, Math.max(0, (now - t.startMs) / Math.max(1, t.durationMs)));
      const def = ABILITIES[t.abilityId];
      const p = def ? travelProgress01(def, linear) : linear;
      const ideal = sampleTravel({ x: t.fromX, z: t.fromZ }, t.yaw, t.distance, p);
      const next = t.ignoreCollision
        ? ideal
        : sweepTravel(
            { x: t.fromX, z: t.fromZ },
            ideal,
            COLLISION.playerRadius,
            this.staticColliders,
          );
      // Path stays on travel.yaw; facing still follows mouse (Leap Slam aim).
      this.state = { x: next.x, z: next.z, yaw: input.yaw };
      return this.state;
    }

    this.state = stepPredicted(
      this.state,
      input,
      this.effectiveMoveMul(),
      this.staticColliders,
      this.dynamicColliders,
    );
    return this.state;
  }

  reconcile(serverX: number, serverZ: number, serverYaw: number, lastProcessedSeq: number) {
    this.state = { x: serverX, z: serverZ, yaw: serverYaw };
    this.pending = this.pending.filter((p) => p.seq > lastProcessedSeq);
    for (const input of this.pending) {
      this.state = stepPredicted(
        this.state,
        input,
        this.effectiveMoveMul(),
        this.staticColliders,
        this.dynamicColliders,
      );
    }
  }
}
