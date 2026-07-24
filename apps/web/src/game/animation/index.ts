export {
  CharacterAnimationController,
  type UpperBodyActionOptions,
  type FullBodyActionOptions,
  type CharacterAnimationState,
  type AnimDebugSnapshot,
} from "./CharacterAnimationController";

/** @deprecated Use FullBodyActionOptions */
export type { FullBodyActionOptions as FullBodyPlayOptions } from "./CharacterAnimationController";

export {
  heroAnimationConfig,
  character1AnimationConfig,
  defaultCharacterAnimationConfig,
  abilityAnimationBindings,
  type CharacterAnimationConfig,
} from "./animationConfig";

export { debugPrintAnimationAssets } from "./debugAnimations";

export {
  createLowerBodyClip,
  createUpperBodyClip,
  createLegsOnlyClip,
  createCastBodyClip,
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
