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

export function applyYaw(_currentYaw: number, inputYaw: number): number {
  return inputYaw;
}
