export type { SpellEffectId, VfxPose, VfxHandle, OneShotEffect, VfxSpawnOpts } from "./types";
export { ABILITY_VFX_COLOR, abilityVfxColor } from "./colors";
export { spawnCastEffect, spawnImpactEffect, cancelFollowOwnerVfx, vfxRuntime } from "./runtime";
export { spawnTrail } from "./spawnTrail";
export { VfxWorld } from "./VfxWorld";
export { SpellVfxBridge } from "./SpellVfxBridge";
export { VfxWarmup } from "./VfxWarmup";
export { warmSpellMaterials } from "./preloadVfx";
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
  usesBridgedAoeFx,
  usesSpikeFx,
  usesFrostMistFx,
  usesGrooveFx,
  usesHealBeamFx,
  BoltProjectileEffect,
  CrescentCastEffect,
  CrescentImpactEffect,
  SmashCrackEffect,
  GustWaveEffect,
  FrostBallCastEffect,
  BarrierCastEffect,
  GraspProjectileEffect,
  SpikesPopEffect,
  FrostMistConeEffect,
  HealSwooshEffect,
  HealBeamEffect,
  PoisonDartCastEffect,
  PoisonDartProjectileEffect,
  renderOneShot,
} from "./catalog";

export { GroundMagicCircle } from "./components/GroundMagicCircle";
export { GroundDecal } from "./components/GroundDecal";
export { RuneDecal } from "./components/RuneDecal";
export { AdditiveParticleBurst } from "./components/AdditiveParticleBurst";

export {
  groundPresets,
  projectilePresets,
  laserPresets,
  streamPresets,
  wavePresets,
} from "./presets/ground";

export type {
  VfxElement,
  GroundShape,
  VfxPrimitive,
  GroundDecalPreset,
} from "./kit/types";

export {
  createGroundDecalMaterial,
  setGroundDecalProgress,
  setGroundDecalOpacity,
  tickGroundDecal,
  applyGroundDecalPreset,
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

export { ObjectPool, createVec3Pool } from "./pool";

export {
  findBone,
  attachToObject,
  attachToBone,
  followObjectWorld,
  type AttachHandle,
} from "./attach";
