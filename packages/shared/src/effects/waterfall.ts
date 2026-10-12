/**
 * Enchanted Meadow waterfall, as data.
 *
 * The Babylon view renders this. The map builder can store the same object
 * without importing a renderer. Numbers come from TEM_Waterfall_01.mat and
 * TEM_Water_Particles_01A.prefab.
 */

export type Rgb = { r: number; g: number; b: number };
export type Vec3 = { x: number; y: number; z: number };
export type CurveKey = { t: number; v: number };

export type WaterfallSettings = {
  enabled: boolean;
  /** World-space texture repeat. Unity `_TilingSize`. */
  tiling: number;
  /** Normal-map strength. Unity `_DistortionAmount`. */
  distortion: number;
  /** Blend between the two scrolling normals. Unity `_LerpStrength`. */
  lerpStrength: number;
  /** 0 is a tight rim, 1 is a broad one. Unity `_FresnelIntensity`. */
  fresnelIntensity: number;
  /** World XZ drift of the normals. Unity `_FlowDirection`. */
  flow: Vec3;
  /** UV scroll of the vertical streaks. Unity `_VerticalFlowSpeed`. */
  verticalFlow: { x: number; y: number };
  shallow: Rgb;
  deep: Rgb;
  fresnel: Rgb;
  highlights1: Rgb;
  highlights2: Rgb;
  edgeFoam: Rgb;
  edgeFoamOpacity: number;
  /** Stand-in for the scene-depth shallow/deep blend. 0 is shallow, 1 is deep. */
  depthMix: number;
  /** Particles per second. */
  emitRate: number;
  /** Offset from the foot of the mesh, in the prop's local space. */
  emitter: Vec3;
  lifetime: number;
  speedMin: number;
  speedMax: number;
  startSize: number;
  /** Multiplier on Unity's default gravity (0, -9.81, 0). */
  gravityModifier: number;
  /** Extra downward speed, metres per second. Velocity-over-lifetime Y. */
  velocityY: number;
  simulationSpeed: number;
  /** Emitter box after the prefab's 90° yaw, in metres. */
  box: Vec3;
};

export const WATERFALL_SIZE_MAX: readonly CurveKey[] = [
  { t: 0, v: 0.08371397 },
  { t: 0.09309012, v: 0.46703303 },
  { t: 0.21767023, v: 0.43469325 },
  { t: 0.45323986, v: 0.7726054 },
  { t: 0.6317736, v: 1.0252205 },
  { t: 0.90942115, v: 0.49960637 },
  { t: 1, v: 0.07913381 },
];

export const WATERFALL_SIZE_MIN: readonly CurveKey[] = [
  { t: 0, v: 0 },
  { t: 0.12250527, v: 0.23164095 },
  { t: 0.28919113, v: 0.26092163 },
  { t: 1, v: 0 },
];

/** Size-curve multipliers from the prefab. Max curve is scaled by 5, min by 1. */
export const WATERFALL_SIZE_SCALE = { min: 1, max: 5 };

/** Alpha over the particle's life. Times are 0–1. */
export const WATERFALL_ALPHA: readonly CurveKey[] = [
  { t: 0, v: 0 },
  { t: 8096 / 65535, v: 1 },
  { t: 36623 / 65535, v: 1 },
  { t: 1, v: 0 },
];

export const ENCHANTED_MEADOW_WATERFALL: WaterfallSettings = {
  enabled: true,
  tiling: 8,
  distortion: 0.1,
  lerpStrength: 0.45,
  fresnelIntensity: 0.3,
  flow: { x: -0.05, y: 0, z: 0.0255 },
  verticalFlow: { x: 0, y: 0.65 },
  shallow: { r: 0.25882354, g: 0.72156864, b: 0.7529412 },
  deep: { r: 0.13333334, g: 0.40392157, b: 0.35686275 },
  fresnel: { r: 0.10980392, g: 0.29803923, b: 0.32156864 },
  highlights1: { r: 0.36538804, g: 0.60409445, b: 0.6509434 },
  highlights2: { r: 0, g: 0.59544224, b: 0.6792453 },
  edgeFoam: { r: 1, g: 1, b: 1 },
  edgeFoamOpacity: 0.5,
  depthMix: 0.35,
  emitRate: 120,
  emitter: { x: 0, y: 0.15, z: 0 },
  lifetime: 2.5,
  speedMin: 3.5,
  speedMax: 4.5,
  startSize: 0.35,
  gravityModifier: 0.15,
  velocityY: -5,
  simulationSpeed: 1.25,
  box: { x: 1, y: 0.1, z: 4 },
};

export function cloneWaterfallSettings(source: WaterfallSettings = ENCHANTED_MEADOW_WATERFALL): WaterfallSettings {
  return {
    ...source,
    flow: { ...source.flow },
    verticalFlow: { ...source.verticalFlow },
    shallow: { ...source.shallow },
    deep: { ...source.deep },
    fresnel: { ...source.fresnel },
    highlights1: { ...source.highlights1 },
    highlights2: { ...source.highlights2 },
    edgeFoam: { ...source.edgeFoam },
    emitter: { ...source.emitter },
    box: { ...source.box },
  };
}
