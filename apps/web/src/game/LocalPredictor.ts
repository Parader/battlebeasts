import {
  ABILITIES,
  COLLISION,
  MOVE_SPEED,
  applyMovement,
  applyYaw,
  baseCityStaticColliders,
  moveAndCollide,
  moveMulForPhase,
  resolveCollisions,
  resolveTravel,
  sampleTravel,
  travelDistance,
  travelDurationMs,
  type CastPhaseId,
  type CircleCollider,
  type PlayerInput,
} from "@battlebeasts/shared";

const RECONCILE_EPSILON = 0.05;

export type PredictedState = {
  x: number;
  z: number;
  yaw: number;
};

type LocalTravel = {
  fromX: number;
  fromZ: number;
  yaw: number;
  distance: number;
  startMs: number;
  durationMs: number;
};

function applyInput(
  state: PredictedState,
  input: PlayerInput,
  moveMul: number,
  travel: LocalTravel | null,
  nowMs: number,
  staticColliders: readonly CircleCollider[],
  dynamicColliders: readonly CircleCollider[],
): PredictedState {
  let next = {
    ...state,
    yaw: applyYaw(state.yaw, input.yaw),
  };

  if (travel) {
    const progress = Math.min(1, Math.max(0, (nowMs - travel.startMs) / travel.durationMs));
    const pos = sampleTravel(
      { x: travel.fromX, z: travel.fromZ },
      travel.yaw,
      travel.distance,
      progress,
    );
    const clamped = resolveCollisions(
      pos,
      COLLISION.playerRadius,
      staticColliders,
      dynamicColliders,
    );
    next = { ...next, x: clamped.x, z: clamped.z };
    return next;
  }

  const desired = applyMovement(next, input, MOVE_SPEED * moveMul);
  const moved = moveAndCollide(
    { x: next.x, z: next.z },
    desired,
    COLLISION.playerRadius,
    staticColliders,
    dynamicColliders,
  );
  next = { ...moved, yaw: next.yaw };
  return next;
}

export class LocalPredictor {
  state: PredictedState = { x: 0, z: 0, yaw: 0 };
  private pending: PlayerInput[] = [];
  private seeded = false;
  moveMul = 1;
  private travel: LocalTravel | null = null;
  private staticColliders: CircleCollider[] = baseCityStaticColliders();
  private dynamicColliders: CircleCollider[] = [];

  seed(x: number, z: number, yaw: number) {
    this.state = { x, z, yaw };
    this.pending = [];
    this.seeded = true;
    this.travel = null;
  }

  get isSeeded() {
    return this.seeded;
  }

  setWorldColliders(
    staticColliders: CircleCollider[],
    dynamicColliders: CircleCollider[] = [],
  ) {
    this.staticColliders = staticColliders;
    this.dynamicColliders = dynamicColliders;
  }

  setMoveMulFromPhase(abilityId: string | undefined, phase: string | undefined) {
    if (!abilityId || !phase) {
      this.moveMul = 1;
      return;
    }
    const def = ABILITIES[abilityId];
    if (!def) {
      this.moveMul = 1;
      return;
    }
    if (phase === "anticipation" || phase === "cast" || phase === "impact" || phase === "recovery") {
      this.moveMul = moveMulForPhase(def, phase as CastPhaseId);
      return;
    }
    this.moveMul = 1;
  }

  /** Start local translate prediction when impact begins for a travel spell. */
  beginTravelFromCast(abilityId: string, yaw: number) {
    const def = ABILITIES[abilityId];
    if (!def) return;
    const travel = resolveTravel(def);
    if (travel.mode === "instant") {
      const dist = travelDistance(def);
      const pos = sampleTravel(this.state, yaw, dist, 1);
      const clamped = resolveCollisions(
        pos,
        COLLISION.playerRadius,
        this.staticColliders,
        this.dynamicColliders,
      );
      this.state = { ...this.state, x: clamped.x, z: clamped.z, yaw };
      this.travel = null;
      return;
    }
    if (travel.mode !== "translate") return;
    this.travel = {
      fromX: this.state.x,
      fromZ: this.state.z,
      yaw,
      distance: travelDistance(def),
      startMs: performance.now(),
      durationMs: travelDurationMs(def),
    };
  }

  clearTravel() {
    this.travel = null;
  }

  predict(input: PlayerInput): PredictedState {
    this.pending.push(input);
    if (this.pending.length > 128) this.pending.shift();

    const now = performance.now();
    if (this.travel && now >= this.travel.startMs + this.travel.durationMs) {
      const pos = sampleTravel(
        { x: this.travel.fromX, z: this.travel.fromZ },
        this.travel.yaw,
        this.travel.distance,
        1,
      );
      const clamped = resolveCollisions(
        pos,
        COLLISION.playerRadius,
        this.staticColliders,
        this.dynamicColliders,
      );
      this.state = { ...this.state, x: clamped.x, z: clamped.z };
      this.travel = null;
    }

    this.state = applyInput(
      this.state,
      input,
      this.moveMul,
      this.travel,
      now,
      this.staticColliders,
      this.dynamicColliders,
    );
    return this.state;
  }

  reconcile(server: { x: number; z: number; yaw: number; lastInputSeq: number }) {
    if (!this.seeded) {
      this.seed(server.x, server.z, server.yaw);
      return this.state;
    }

    this.pending = this.pending.filter((i) => i.seq > server.lastInputSeq);

    // While translating, soft-follow server — hard replay fights the lerp
    if (this.travel) {
      const blend = 0.35;
      this.state = {
        x: this.state.x + (server.x - this.state.x) * blend,
        z: this.state.z + (server.z - this.state.z) * blend,
        yaw: server.yaw,
      };
      return this.state;
    }

    let replayed: PredictedState = { x: server.x, z: server.z, yaw: server.yaw };
    const now = performance.now();
    for (const input of this.pending) {
      replayed = applyInput(
        replayed,
        input,
        this.moveMul,
        null,
        now,
        this.staticColliders,
        this.dynamicColliders,
      );
    }

    const dx = replayed.x - this.state.x;
    const dz = replayed.z - this.state.z;
    const err = Math.hypot(dx, dz);

    if (err > RECONCILE_EPSILON) {
      if (err > 2) {
        this.state = replayed;
      } else {
        this.state = {
          x: this.state.x + (replayed.x - this.state.x) * 0.5,
          z: this.state.z + (replayed.z - this.state.z) * 0.5,
          yaw: replayed.yaw,
        };
      }
    } else {
      this.state.yaw = replayed.yaw;
    }

    return this.state;
  }
}
