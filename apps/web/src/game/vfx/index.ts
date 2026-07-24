export type { SpellEffectId, VfxPose, VfxHandle, OneShotEffect, VfxSpawnOpts } from "./types";
export { ABILITY_VFX_COLOR, abilityVfxColor } from "./colors";
export { spawnCastEffect, spawnImpactEffect, vfxRuntime } from "./runtime";
export { spawnTrail } from "./spawnTrail";
export { VfxWorld } from "./VfxWorld";
export { SpellVfxBridge } from "./SpellVfxBridge";
export {
  notifyCrescentHit,
  notifyCrescentMelee,
  clearCrescentSpawnState,
} from "./crescentSpawn";
export {
  CATALOG_PROJECTILES,
  CATALOG_CAST_FX,
  CATALOG_IMPACT_FX,
  CATALOG_MELEE_SWOOP,
  CATALOG_AOE_CRACK,
  hasCatalogProjectile,
  hasCatalogCastFx,
  hasCatalogImpactFx,
  usesMeleeSwoopFx,
  usesAoeCrackFx,
  BoltProjectileEffect,
  CrescentCastEffect,
  CrescentImpactEffect,
  SmashCrackEffect,
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
