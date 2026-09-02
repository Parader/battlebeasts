export {
  CharacterAnimationController,
  type UpperBodyActionOptions,
  type FullBodyActionOptions,
  type CharacterAnimationState,
  type AnimDebugSnapshot,
  type CharacterAnimOptions,
} from "./CharacterAnimationController";

/** @deprecated Use FullBodyActionOptions */
export type { FullBodyActionOptions as FullBodyPlayOptions } from "./CharacterAnimationController";

export {
  heroAnimationConfig,
  character1AnimationConfig,
  defaultCharacterAnimationConfig,
  abilityAnimationBindings,
  emoteAnimationClips,
  HERO_CHEST_PROXY_BAKE_ACTIONS,
  type CharacterAnimationConfig,
} from "./animationConfig";

export { playEmoteAnimation } from "./emoteAnimation";

export { debugPrintAnimationAssets } from "./debugAnimations";

export { listDeathClipNames, pickRandomDeathClip, playRandomDeath } from "./deathClips";

export {
  createLowerBodyClip,
  createUpperBodyClip,
  createUpperLocoClip,
  getCachedUpperCastClip,
  stripHorizontalRootMotion,
  plantHipsRootMotion,
  getHipsStartY,
  resolveClip,
  reportMissingClips,
} from "./clipUtils";

export {
  computeLocoTargets,
  dampWeights,
  ZERO_LOCO_WEIGHTS,
  type LocoWeights,
  type LocoDir,
  type MovementParams,
} from "./locomotionBlend";

export {
  applySpineCursorYaw,
  findSpineAimBones,
} from "./spineCursorAim";

export {
  applyChestProxySnap,
  findChestProxyBones,
} from "./chestProxySnap";