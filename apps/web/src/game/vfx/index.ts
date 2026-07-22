export type { SpellEffectId, VfxPose, VfxHandle, OneShotEffect, VfxSpawnOpts } from "./types";
export { ABILITY_VFX_COLOR, abilityVfxColor } from "./colors";
export { spawnCastEffect, spawnImpactEffect, vfxRuntime } from "./runtime";
export { spawnTrail } from "./spawnTrail";
export { VfxWorld } from "./VfxWorld";
export { SpellVfxBridge } from "./SpellVfxBridge";
export {
  CATALOG_PROJECTILES,
  hasCatalogProjectile,
  BoltProjectileEffect,
  renderOneShot,
} from "./catalog";

export {
  createEnergyBallMaterial,
  createEnergyRingMaterial,
  tintEnergyMaterial,
  createFresnelGlowMaterial,
  setFresnelColor,
  createScrollNoiseMaterial,
  tickScrollNoise,
  createTrailMaterial,
  createDissolveMaterial,
  setDissolveThreshold,
  createRuneMaterial,
  tickRuneMaterial,
  createShieldMaterials,
  tickShieldMaterials,
} from "./materials";

export { GroundMagicCircle } from "./components/GroundMagicCircle";
export { RuneDecal } from "./components/RuneDecal";
export { AdditiveParticleBurst } from "./components/AdditiveParticleBurst";

export {
  findBone,
  attachToObject,
  attachToBone,
  followObjectWorld,
  type AttachHandle,
} from "./attach";

export { ObjectPool, createVec3Pool } from "./pool";
