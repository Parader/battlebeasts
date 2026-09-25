export const BatchId = {
  AdditiveFire: 0,
  AdditiveSpark: 1,
  AlphaSmoke: 2,
  AlphaIce: 3,
} as const;

export type BatchId = (typeof BatchId)[keyof typeof BatchId];

export const LodRank = {
  Core: 0,
  Trail: 1,
} as const;

export type LodRank = (typeof LodRank)[keyof typeof LodRank];

export const Collide = {
  None: 0,
  Kill: 1,
  Bounce: 2,
} as const;

export type Collide = (typeof Collide)[keyof typeof Collide];

/** Atlas UV: offset.xy + scale.zw in 0..1 (WebGL bottom-left). */
export type AtlasUv = readonly [number, number, number, number];

export type EmitterSpawn = {
  x: number;
  y: number;
  z: number;
  /** Emit direction (world). Defaults to +Y. */
  dirX?: number;
  dirY?: number;
  dirZ?: number;
  rate?: number;
  spread?: number;
  gravity?: number;
  drag?: number;
  noise?: number;
  groundY?: number;
  collide?: Collide;
  batch?: BatchId;
  atlasUv?: AtlasUv;
  color0?: string;
  color1?: string;
  color2?: string;
  size?: number;
  sizeEnd?: number;
  life?: number;
  lifeJitter?: number;
  rotRate?: number;
  /** 0 = upright sprites (bolts / streaks); 1 = full random start angle. Default 1. */
  rotJitter?: number;
  /** Peak opacity multiplier (smoke sandbox uses ~0.05–0.12). Default 1. */
  opacity?: number;
  lod?: LodRank;
  /** Seconds. <= 0 means until killed. */
  duration?: number;
  /** Immediate particles on spawn. */
  burst?: number;
  /** Steer living particles toward home (updated via setEmitterHoming). */
  homeStrength?: number;
  homeX?: number;
  homeY?: number;
  homeZ?: number;
  /**
   * Absorb when within this distance of home. Particles that miss and fly past
   * stop steering and fade out instead of looping back.
   */
  homeKillRadius?: number;
};

export type ParticleStats = {
  living: number;
  emitters: number;
  simMs: number;
  draws: number;
  lodActive: boolean;
};
