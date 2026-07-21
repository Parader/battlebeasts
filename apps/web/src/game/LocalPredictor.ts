import { applyMovement, applyYaw, type PlayerInput } from "@battlebeasts/shared";

const RECONCILE_EPSILON = 0.05;

export type PredictedState = {
  x: number;
  z: number;
  yaw: number;
};

export class LocalPredictor {
  state: PredictedState = { x: 0, z: 0, yaw: 0 };
  private pending: PlayerInput[] = [];
  private seeded = false;

  seed(x: number, z: number, yaw: number) {
    this.state = { x, z, yaw };
    this.pending = [];
    this.seeded = true;
  }

  get isSeeded() {
    return this.seeded;
  }

  predict(input: PlayerInput): PredictedState {
    this.pending.push(input);
    if (this.pending.length > 128) this.pending.shift();

    this.state = {
      ...applyMovement(this.state, input),
      yaw: applyYaw(this.state.yaw, input.yaw),
    };
    return this.state;
  }

  reconcile(server: { x: number; z: number; yaw: number; lastInputSeq: number }) {
    if (!this.seeded) {
      this.seed(server.x, server.z, server.yaw);
      return this.state;
    }

    this.pending = this.pending.filter((i) => i.seq > server.lastInputSeq);

    let replayed: PredictedState = { x: server.x, z: server.z, yaw: server.yaw };
    for (const input of this.pending) {
      replayed = {
        ...applyMovement(replayed, input),
        yaw: applyYaw(replayed.yaw, input.yaw),
      };
    }

    const dx = replayed.x - this.state.x;
    const dz = replayed.z - this.state.z;
    const err = Math.hypot(dx, dz);

    if (err > RECONCILE_EPSILON) {
      // Hard correct large errors; soft blend small ones
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
