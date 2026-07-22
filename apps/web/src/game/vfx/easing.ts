import * as THREE from "three";

/** Hermite smoothstep 0→1. */
export function smooth01(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Smoothstep between edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  return smooth01((x - edge0) / (edge1 - edge0));
}

/**
 * Soft envelope: ease in to peak, ease out to 0.
 * `inEnd` / `outStart` are normalized lifetime (0..1).
 */
export function softEnvelope(
  t: number,
  inEnd = 0.4,
  outStart = 0.55,
): number {
  const age = THREE.MathUtils.clamp(t, 0, 1);
  const appear = smoothstep(0, inEnd, age);
  const fade = 1 - smoothstep(outStart, 1, age);
  return appear * fade;
}
