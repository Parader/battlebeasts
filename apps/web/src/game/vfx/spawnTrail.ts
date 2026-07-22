import type { VfxHandle, VfxPose } from "./types";

/**
 * Shared trail spawn entry point for future ribbon trails.
 * Bolt draws its own history trail in-mesh; this stays available for callers.
 */
export function spawnTrail(_abilityId: string, _pose: VfxPose): VfxHandle {
  return { cancel: () => undefined };
}
