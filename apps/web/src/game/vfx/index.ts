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
  usesLifeLeechFx,
  usesFirewallFx,
  usesPoisonCloudFx,
  usesSmokeBombFx,
  usesHolyGroundFx,
  usesIceLanceExplodeFx,
  usesVolcanoFx,
  isOwnedByCastProjectile,
  BoltProjectileEffect,
  CrescentCastEffect,
  CrescentImpactEffect,
  SmashCrackEffect,
  GustWaveEffect,
  FrostBallCastEffect,
  BarrierCastEffect,
  GraspProjectileEffect,
  ChainJumpProjectileEffect,
  SpikesPopEffect,
  FrostMistConeEffect,
  HealSwooshEffect,
  HealBeamEffect,
  PoisonDartCastEffect,
  PoisonDartProjectileEffect,
  IceLanceCastEffect,
  IceLanceExplodeEffect,
  SoulMarkProjectileEffect,
  VoidDiscProjectileEffect,
  RunicShardProjectileEffect,
  AstralChainProjectileEffect,
  renderOneShot,
} from "./catalog";

export { getAbilityVfxProfile } from "./profiles/registry";
export type { AbilityVfxProfile, CastEngine } from "./profiles/types";
export { dispatchCombatFxVfx } from "./combatFxDispatch";
export type { CombatFxMessage, CombatFxDispatchCtx } from "./combatFxDispatch";

export { GroundMagicCircle } from "./components/GroundMagicCircle";
export { GroundDecal } from "./components/GroundDecal";
export { RuneDecal } from "./components/RuneDecal";
export { AdditiveParticleBurst } from "./components/AdditiveParticleBurst";
export { FireParticleField } from "./components/FireParticleField";
export { LavaGroundStrip } from "./components/LavaGroundStrip";

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
  createAoeRimMarkerMaterial,
  tintAoeRimMarkerMaterial,
  tickAoeRimMarkerMaterial,
  setAoeRimMarkerOpacity,
  setAoeRimMarkerAspect,
  setAoeRimMarkerHalfAngle,
  setAoeRimMarkerProgress,
  createEnergyBallMaterial,
  createEnergyRingMaterial,
  acquireEnergyBallMaterial,
  acquireEnergyRingMaterial,
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
  applyAtlasFrame,
  atlasTile,
  cloneAtlasFrameMaterial,
  type AtlasFrame,
  type AtlasSize,
} from "./atlasFrame";

export {
  SPELL_EFFECTS_ATLAS,
  SPELL_FX,
  spellEffectsCell,
  spellEffectsTile,
  getSpellEffectsTexture,
  applySpellEffectsFrame,
  cloneSpellEffectsMaterial,
  type SpellEffectsFrame,
} from "./spellEffectsTexture";

export {
  SHADOW_SPELL_ATLAS,
  SHADOW_SIGIL_FRAMES,
  SHADOW_PROJECTILE_FRAME,
  SHADOW_PROJECTILE_LARGE_FRAME,
  SHADOW_BURST_FRAME,
  SHADOW_MIST_FRAME,
  getShadowSpellTexture,
  applyShadowSpellFrame,
  cloneShadowFrameMaterial,
  sigilFrameForStacks,
  type ShadowSpellFrame,
} from "./shadowSpellTexture";

export { VFX_SPELL_EFFECTS_URL, VFX_SHADOW_SPELL_URL } from "./vfxUrls";

export { AoeRimMarker } from "./components/AoeRimMarker";
export type { AoeRimMarkerProps } from "./components/AoeRimMarker";

export {
  findBone,
  attachToObject,
  attachToBone,
  followObjectWorld,
  type AttachHandle,
} from "./attach";
