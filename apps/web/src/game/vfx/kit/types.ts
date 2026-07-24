/**
 * Shared elemental VFX kit types.
 * Ground is fully implemented; projectile/laser/stream/wave are API-ready scaffolds.
 */

export type VfxElement = "fire" | "ice" | "water" | "wind" | "poison" | "earth";

export type GroundShape = "circle" | "ring" | "cone" | "line" | "rect" | "arc";

export type VfxPrimitive = "ground" | "projectile" | "laser" | "stream" | "wave";

/** Shared look knobs — elements are data, not separate shaders. */
export type ElementLook = {
  element: VfxElement;
  colorCore: string;
  colorMid: string;
  colorEdge: string;
  noiseScale: number;
  breakup: number;
  opacity: number;
  /** Prefer additive blending for emissive elements (fire). */
  additive?: boolean;
  spin?: number;
};

export type GroundDecalPreset = ElementLook & {
  /** Default shape when caller omits one. */
  shape: GroundShape;
  radius: number;
  lifeMs: number;
  ringWidth: number;
  softness: number;
  /** Cone half-angle (radians). */
  halfAngle?: number;
  /** Ring inner radius as fraction of outer (0..1). */
  innerRatio?: number;
  /** Arc span (radians) for arc shape. */
  arcSpan?: number;
  /** Rect length/width aspect (length along yaw). */
  aspect?: number;
  /** Normalized lifetime when appear finishes (default 0.12). */
  appearEnd?: number;
  /** Normalized lifetime when fade begins (default 0.55). */
  fadeStart?: number;
};

export type ProjectilePreset = ElementLook & {
  radius: number;
  lifeMs: number;
};

export type LaserPreset = ElementLook & {
  width: number;
  lifeMs: number;
};

export type StreamPreset = ElementLook & {
  length: number;
  halfAngle: number;
  lifeMs: number;
};

export type WavePreset = ElementLook & {
  radius: number;
  ringWidth: number;
  lifeMs: number;
};

/** Style index consumed by GroundDecalMaterial.uStyle */
export const ELEMENT_STYLE: Record<VfxElement, number> = {
  earth: 0,
  fire: 1,
  ice: 2,
  water: 3,
  wind: 4,
  poison: 5,
};

/** Shape index consumed by GroundDecalMaterial.uShape */
export const GROUND_SHAPE_ID: Record<GroundShape, number> = {
  circle: 0,
  ring: 1,
  cone: 2,
  line: 3,
  rect: 4,
  arc: 5,
};
