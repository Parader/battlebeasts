import * as THREE from "three";
import { getCharacterRoot } from "../characterRoots";
import { findHandBone } from "./attach";

/**
 * Where a caster's hand actually is this frame.
 *
 * Every hand-anchored spell needs the same thing: the live bone if the character has
 * streamed in, a sane point in front of the chest if it has not, plus a small forward
 * push so particles clear the palm instead of spawning inside it.
 */

/** Chest-ish height used before a character root exists. */
export const HAND_FALLBACK_Y = 1.15;

/** Forward offset from the body centre when falling back to the pose. */
export const HAND_FALLBACK_REACH = 0.45;

/** Nudge along the aim so emitters clear the palm. */
export const HAND_PUSH = 0.06;

export type HandPose = { x: number; y: number; z: number };

const scratch = new THREE.Vector3();

/**
 * Resolve the casting hand into `out` (mutated, never allocated).
 *
 * `forwardX` / `forwardZ` are the aim basis — `Math.sin(yaw)` / `Math.cos(yaw)`.
 */
export function resolveHandPose(
  out: HandPose,
  ownerId: string | null | undefined,
  bodyX: number,
  bodyZ: number,
  forwardX: number,
  forwardZ: number,
  side: "left" | "right" = "right",
): HandPose {
  const root = getCharacterRoot(ownerId);
  const hand = root ? findHandBone(root, side) : null;
  if (hand) {
    hand.getWorldPosition(scratch);
    out.x = scratch.x + forwardX * HAND_PUSH;
    out.y = scratch.y;
    out.z = scratch.z + forwardZ * HAND_PUSH;
    return out;
  }
  out.x = bodyX + forwardX * HAND_FALLBACK_REACH;
  out.y = HAND_FALLBACK_Y;
  out.z = bodyZ + forwardZ * HAND_FALLBACK_REACH;
  return out;
}

/** Character root origin (feet) for ground-anchored follow effects. */
export function resolveFeetY(ownerId: string | null | undefined): number {
  return getCharacterRoot(ownerId)?.position.y ?? 0;
}
