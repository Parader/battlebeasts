import { MOVE_SPEED } from "./constants";
import type { PlayerInput, Vec2 } from "./protocol";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function length2(x: number, z: number): number {
  return Math.hypot(x, z);
}

export function normalize2(x: number, z: number): Vec2 {
  const len = length2(x, z);
  if (len < 1e-6) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}

/** Apply movement on the XZ plane. Shared by client prediction and server. */
export function applyMovement(
  pos: Vec2,
  input: Pick<PlayerInput, "moveX" | "moveZ" | "dt">,
  speed = MOVE_SPEED,
): Vec2 {
  const dir = normalize2(input.moveX, input.moveZ);
  return {
    x: pos.x + dir.x * speed * input.dt,
    z: pos.z + dir.z * speed * input.dt,
  };
}

/** Signed shortest yaw delta in (-π, π]. */
export function shortestYawDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** Step current yaw toward target, capped at `maxRadPerSec`. */
export function stepYawToward(
  currentYaw: number,
  targetYaw: number,
  maxRadPerSec: number,
  dt: number,
): number {
  const delta = shortestYawDelta(currentYaw, targetYaw);
  const maxStep = Math.max(0, maxRadPerSec) * Math.max(0, dt);
  if (Math.abs(delta) <= maxStep) return targetYaw;
  return currentYaw + Math.sign(delta) * maxStep;
}

/**
 * Apply aim yaw. When `maxRadPerSec` + `dt` are set, turn rate is capped
 * (e.g. Hand Shield slow rotate); otherwise snaps to input.
 */
export function applyYaw(
  currentYaw: number,
  inputYaw: number,
  dt = 0,
  maxRadPerSec?: number,
): number {
  if (maxRadPerSec == null || !(maxRadPerSec > 0) || !(dt > 0)) return inputYaw;
  return stepYawToward(currentYaw, inputYaw, maxRadPerSec, dt);
}
