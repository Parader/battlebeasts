/**
 * Procedural directional locomotion weights.
 *
 * Facing is aim-forward. World velocity is projected into that frame:
 *   forward = (sin(yaw), cos(yaw))
 *   right   = screen/player side (negated so LeftStrafe / RightStrafe match WASD)
 */

export type LocoDir = "idle" | "forward" | "backward" | "left" | "right";

export type LocoWeights = Record<LocoDir, number>;

export const ZERO_LOCO_WEIGHTS: LocoWeights = {
  idle: 1,
  forward: 0,
  backward: 0,
  left: 0,
  right: 0,
};

export type MovementParams = {
  /** World-space planar velocity (y ignored). */
  worldVelocity: { x: number; y?: number; z: number };
  /** Aim / facing yaw in radians (same basis as gameplay atan2). */
  facingYaw: number;
  /** Gameplay max move speed for normalizing (e.g. MOVE_SPEED). */
  maximumSpeed: number;
};

/**
 * Convert world velocity → local forward/right and target blend weights.
 * Directional weights are cartesian (not radial) so diagonals split influence
 * between forward+strafe (or back+strafe) rather than picking one clip.
 */
export function computeLocoTargets(params: MovementParams): {
  localForward: number;
  localRight: number;
  speed: number;
  normalizedSpeed: number;
  targets: LocoWeights;
} {
  const maxSpeed = Math.max(1e-4, params.maximumSpeed);
  const vx = params.worldVelocity.x;
  const vz = params.worldVelocity.z;
  const speed = Math.hypot(vx, vz);
  const normalizedSpeed = Math.min(1, speed / maxSpeed);

  const s = Math.sin(params.facingYaw);
  const c = Math.cos(params.facingYaw);
  // Match aim: forward = (sin, cos). Negate side so Mixamo Left/RightStrafe
  // align with WASD from the fixed top-down camera.
  const localForward = vx * s + vz * c;
  const localRight = -(vx * c - vz * s);

  if (normalizedSpeed < 1e-4) {
    return {
      localForward,
      localRight,
      speed,
      normalizedSpeed: 0,
      targets: { ...ZERO_LOCO_WEIGHTS },
    };
  }

  // Unit direction in facing space (avoid speed in the directional split)
  const inv = 1 / Math.max(1e-4, speed);
  const dirF = localForward * inv;
  const dirR = localRight * inv;

  let forward = Math.max(0, dirF);
  let backward = Math.max(0, -dirF);
  let right = Math.max(0, dirR);
  let left = Math.max(0, -dirR);

  const dirSum = forward + backward + left + right;
  if (dirSum > 1e-6) {
    forward /= dirSum;
    backward /= dirSum;
    left /= dirSum;
    right /= dirSum;
  }

  // Move influence rises with speed; idle fills the remainder
  const moveInfluence = normalizedSpeed;
  return {
    localForward,
    localRight,
    speed,
    normalizedSpeed,
    targets: {
      idle: 1 - moveInfluence,
      forward: forward * moveInfluence,
      backward: backward * moveInfluence,
      left: left * moveInfluence,
      right: right * moveInfluence,
    },
  };
}

/** Frame-rate-independent exponential approach. */
export function dampWeight(current: number, target: number, responsiveness: number, delta: number): number {
  const t = 1 - Math.exp(-responsiveness * Math.max(0, delta));
  return current + (target - current) * t;
}

export function dampWeights(
  current: LocoWeights,
  target: LocoWeights,
  responsiveness: number,
  delta: number,
): LocoWeights {
  return {
    idle: dampWeight(current.idle, target.idle, responsiveness, delta),
    forward: dampWeight(current.forward, target.forward, responsiveness, delta),
    backward: dampWeight(current.backward, target.backward, responsiveness, delta),
    left: dampWeight(current.left, target.left, responsiveness, delta),
    right: dampWeight(current.right, target.right, responsiveness, delta),
  };
}
