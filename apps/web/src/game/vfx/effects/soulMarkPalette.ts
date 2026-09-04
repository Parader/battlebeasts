import * as THREE from "three";

/** Soul Mark color palette — shadow / psychic / curse read. */
export const SOUL_MARK_COLORS = {
  darkCore: "#16091F",
  deepViolet: "#43106B",
  primary: "#8B2DCE",
  bright: "#D68CFF",
  hotFlash: "#F4E5FF",
  smoke: "#100914",
  shadowWisp: "#2A0B38",
} as const;

export const SOUL_MARK_GROUND_Y = 0.03;

/** Shared ground rings — uploaded once. */
export const GEO_SOUL_OUTER_RING = new THREE.RingGeometry(0.58, 0.63, 48);
export const GEO_SOUL_INNER_RING = new THREE.RingGeometry(0.38, 0.44, 40);
export const GEO_SOUL_SHOCK_RING = new THREE.RingGeometry(0.14, 0.17, 40);
/** Vertical rupture ring — thin band in YZ plane when rotated. */
export const GEO_SOUL_VERT_RING = new THREE.RingGeometry(0.08, 0.11, 32);
export const GEO_SOUL_RUNE_ARM = new THREE.PlaneGeometry(0.1, 0.38);
export const GEO_SOUL_CENTER = new THREE.CircleGeometry(0.14, 24);

export const SOUL_RUNE_RADIUS = 0.34;

export const SOUL_RUNE_ANGLES = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3] as const;

export type SoulMarkStackLevel = 1 | 2 | 3;

export function soulMarkStackConfig(stacks: SoulMarkStackLevel) {
  switch (stacks) {
    case 1:
      return {
        outerOpacity: 0.35,
        innerOpacity: 0.08,
        outerSpeed: 0.25,
        innerSpeed: 0,
        wisps: 1,
        riseRate: 0.35,
        centerGlow: 0.28,
        pulseSpeed: 4,
        pulseScale: 0,
        outerBright: 0.55,
      };
    case 2:
      return {
        outerOpacity: 0.55,
        innerOpacity: 0.42,
        outerSpeed: 0.45,
        innerSpeed: -0.6,
        wisps: 2,
        riseRate: 0.65,
        centerGlow: 0.48,
        pulseSpeed: 6,
        pulseScale: 0,
        outerBright: 0.72,
      };
    default:
      return {
        outerOpacity: 0.88,
        innerOpacity: 0.78,
        outerSpeed: 0.8,
        innerSpeed: -1.0,
        wisps: 3,
        riseRate: 1.05,
        centerGlow: 0.72,
        pulseSpeed: 10,
        pulseScale: 0.06,
        outerBright: 1,
      };
  }
}

export function easeOutCubic(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return 1 - (1 - u) ** 3;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = Math.max(0, Math.min(1, t));
  return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2;
}
