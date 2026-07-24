import {
  ABILITIES,
  COLLISION,
  MOVE_SPEED,
  applyMovement,
  baseCityStaticColliders,
  length2,
  resolveCastMoveMul,
  resolveComboContinueMoveMul,
  sampleTravel,
  sweepMove,
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
  const clamped = sweepMove(
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
 */
export class LocalPredictor {
  state: PredictedState = { x: 0, z: 0, yaw: 0 };
  private pending: PlayerInput[] = [];
  private seeded = false;
  moveMul = 1;
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

  beginTravelFromCast(abilityId: string, yaw: number) {
    const def = ABILITIES[abilityId];
    if (!def) return;
    const travel = resolveTravel(def);
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
      const clamped = sweepTravel(
        { x: this.travel.fromX, z: this.travel.fromZ },
        ideal,
        COLLISION.playerRadius,
        this.staticColliders,
      );
      this.state = { ...this.state, x: clamped.x, z: clamped.z, yaw: this.travel.yaw };
      this.travel = null;
    }

    if (this.travel) {
      const t = this.travel;
      const linear = Math.min(1, Math.max(0, (now - t.startMs) / Math.max(1, t.durationMs)));
      const def = ABILITIES[t.abilityId];
      const p = def ? travelProgress01(def, linear) : linear;
      const ideal = sampleTravel({ x: t.fromX, z: t.fromZ }, t.yaw, t.distance, p);
      const clamped = sweepTravel(
        { x: t.fromX, z: t.fromZ },
        ideal,
        COLLISION.playerRadius,
        this.staticColliders,
      );
      this.state = { x: clamped.x, z: clamped.z, yaw: t.yaw };
      return this.state;
    }

    this.state = stepPredicted(
      this.state,
      input,
      this.moveMul,
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
        this.moveMul,
        this.staticColliders,
        this.dynamicColliders,
      );
    }
  }
}
