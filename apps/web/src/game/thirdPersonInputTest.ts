/**
 * Isolated 3rd-person control experiment (admin camera toggle).
 *
 * Live WASD is map-axis and yaw is ground-aim. A real 3rd-person scheme has to
 * remap those at the input tick — this module is that remap, gated so the rest
 * of movement/combat stays on the Battlerite path.
 */

import { getAdminThirdPerson } from "./adminThirdPerson";

const SENSITIVITY = 0.00215;

let yawApplier: ((yaw: number) => void) | null = null;

/** Direct yaw write used by mouse-look (bypasses the ground-aim gate). */
export function registerThirdPersonYawApplier(fn: (yaw: number) => void): () => void {
  yawApplier = fn;
  return () => {
    if (yawApplier === fn) yawApplier = null;
  };
}

export function applyThirdPersonLookYaw(yaw: number): void {
  yawApplier?.(yaw);
}

export function thirdPersonLookSensitivity(): number {
  return SENSITIVITY;
}

/** Cursor ground-aim must not overwrite facing while the test is on. */
export function shouldBlockGroundAimYaw(): boolean {
  return getAdminThirdPerson();
}

/**
 * Keys are encoded map-space: W=(0,−1), D=(+1,0).
 * Reinterpret as character-space: W=forward along yaw, D=right of yaw.
 */
export function remapMapWasdToFacing(
  moveX: number,
  moveZ: number,
  yaw: number,
): { moveX: number; moveZ: number } {
  if (!getAdminThirdPerson()) return { moveX, moveZ };
  if (moveX === 0 && moveZ === 0) return { moveX, moveZ };
  const forward = -moveZ;
  const strafe = -moveX;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return {
    moveX: strafe * rx + forward * fx,
    moveZ: strafe * rz + forward * fz,
  };
}
