export type {
  VfxElement,
  GroundShape,
  VfxPrimitive,
  ElementLook,
  GroundDecalPreset,
  ProjectilePreset,
  LaserPreset,
  StreamPreset,
  WavePreset,
} from "./types";
export { ELEMENT_STYLE, GROUND_SHAPE_ID } from "./types";

export { GroundDecal } from "../components/GroundDecal";
export {
  groundPresets,
  projectilePresets,
  laserPresets,
  streamPresets,
  wavePresets,
  type GroundPresetId,
} from "../presets/ground";

export {
  createGroundDecalMaterial,
  setGroundDecalProgress,
  setGroundDecalOpacity,
  tickGroundDecal,
  applyGroundDecalPreset,
} from "../materials/groundDecal";
