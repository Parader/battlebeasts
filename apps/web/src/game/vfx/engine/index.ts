export { MAX_PARTICLES, MAX_EMITTERS, MAX_PARTICLE_DRAWS, SIM_BUDGET_MS, LOD_TRAIL_RATIO } from "./budgets";
export { BatchId, Collide, LodRank } from "./types";
export type { AtlasUv, EmitterSpawn, ParticleStats } from "./types";
export { ParticleWorld, bindParticleWorld, getParticleWorld } from "./particleWorld";
export { ParticleWorldView } from "./ParticleWorldView";
export { LabShapePreview, LabTelegraphPreview } from "./LabShapePreview";
export {
  getLabPreview,
  setLabPreview,
  subscribeLabPreview,
  useLabPreview,
} from "./labPreview";
export type { LabVfxFocus } from "./labPreview";
export { SHAPE_GALLERY } from "./shapeKinds";
export type { ShapeId } from "./shapeKinds";
export { spawnShapeShowcase, spawnShapeGallery } from "./shapeShowcase";
export {
  getElementSettings,
  patchElementSettings,
  resetElementSettings,
} from "./elementSettings";
export type { ElementSettings } from "./elementSettings";
export {
  spawnEmitter,
  setEmitterPose,
  setEmitterRate,
  setEmitterLook,
  setEmitterLife,
  setEmitterHoming,
  killEmitter,
  killAllEmitters,
  fireCone,
  emberTrail,
  smokePuff,
  frostMist,
  spawnStressCones,
} from "./director";
export {
  ELEMENT_GALLERY,
  spawnElementShowcase,
  spawnElementGallery,
  spawnElementFocus,
} from "./elementGallery";
export type { ElementId } from "./elementGallery";
export {
  elementRoleLayers,
  spawnElementRole,
  burstElementRole,
} from "./elementPresets";
export type { ElementRole, ElementHandle } from "./elementPresets";
export {
  LightningArcWorld,
  bindLightningArcWorld,
  getLightningArcWorld,
  spawnLightningCluster,
  spawnLightningSegment,
  moveLightningCluster,
  setLightningSegment,
  patchLightningCluster,
  killLightningCluster,
  killAllLightningClusters,
} from "./lightningArcs";
export type { LightningClusterOpts } from "./lightningArcs";
export {
  lightningSettings,
  patchLightningSettings,
  resetLightningSettings,
} from "./lightningSettings";
export type { LightningSettings } from "./lightningSettings";
export { ATLAS_UV, primeParticleAtlas } from "./atlas";
export { getBillboardProto, createWarmBillboardMesh } from "./billboardMaterial";
