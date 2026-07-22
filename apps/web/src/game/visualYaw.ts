import * as THREE from "three";

/** Default visual turn rate — lower = smoother / slower face-aim. */
export const VISUAL_YAW_RESPONSIVENESS = 7;

/** Signed shortest delta from `from` → `to` in (-π, π]. */
export function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Frame-rate-independent yaw smoothing toward a target facing.
 * Does not wrap the returned value into [-π, π] so continuous integration stays stable.
 */
export function dampYaw(
  current: number,
  target: number,
  responsiveness: number,
  delta: number,
): number {
  const t = 1 - Math.exp(-responsiveness * Math.max(0, delta));
  return current + shortestAngleDelta(current, target) * t;
}

/** Clamp a yaw into (-π, π] for debug / comparisons. */
export function normalizeYaw(yaw: number): number {
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

/**
 * Optional hard max turn rate (rad/s). When set, caps how far dampYaw can travel
 * in one frame so very snappy aim still looks like a turn, not a snap.
 */
export function dampYawClamped(
  current: number,
  target: number,
  responsiveness: number,
  delta: number,
  maxRadPerSec = 9,
): number {
  const next = dampYaw(current, target, responsiveness, delta);
  const maxStep = maxRadPerSec * Math.max(0, delta);
  const deltaYaw = shortestAngleDelta(current, next);
  if (Math.abs(deltaYaw) <= maxStep) return next;
  return current + Math.sign(deltaYaw) * maxStep;
}
