import type { AbilityVfxProfile } from "../profiles/types";

export type PlayerCastPose = {
  x?: number;
  z?: number;
  yaw?: number;
  castPhase?: string;
  castAbilityId?: string;
  castPhaseEndsAt?: number;
};

export type CastEngineContext = {
  sessionId: string;
  abilityId: string;
  phase: string;
  prevPhase: string;
  now: number;
  pose: PlayerCastPose;
  profile: AbilityVfxProfile;
};

export type CastEngine = {
  onPhaseChange: (ctx: CastEngineContext) => void;
  /** Called every frame after phase handling (muzzle schedule fire, etc.). */
  tick?: (ctx: CastEngineContext) => void;
};
