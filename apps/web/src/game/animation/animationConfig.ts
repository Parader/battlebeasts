/**
 * Maps logical animation roles → clip names inside the loaded GLB.
 * Update these when swapping characters / Mixamo packs.
 */
export type CharacterAnimationConfig = {
  idle: string;
  runForward: string;
  runBackward: string;
  strafeLeft: string;
  strafeRight: string;
  /** Upper torso when not casting (usually Idle upper mask). */
  upperBodyIdle?: string;
  /** Default upper-body cast (1H magic). */
  castPrimary: string;
  castAoE?: string;
  castMelee?: string;
  dash?: string;
  hit?: string;
  death?: string;
  heavyCast?: string;
  /** Blend how fast loco weights chase targets (higher = snappier). */
  locomotionBlendResponsiveness?: number;
  idleBlendResponsiveness?: number;
  /** Optional gait timeScale clamp from normalized move speed. */
  locoTimeScaleMin?: number;
  locoTimeScaleMax?: number;
};

/** Default mapping for `/character1.glb` (Mixamo Beta). */
export const character1AnimationConfig: CharacterAnimationConfig = {
  idle: "UnarmedIdle",
  runForward: "Running",
  runBackward: "RunningBackward",
  strafeLeft: "LeftStrafe",
  strafeRight: "RightStrafe",
  upperBodyIdle: "UnarmedIdle",
  castPrimary: "Standing1HMagicAttack01(1)",
  castAoE: "Standing2HMagicAreaAttack02",
  castMelee: "StandingMeleeAttackDownward",
  heavyCast: "Standing2HMagicAttack04",
  // No true dash clip yet — Jump stands in until a dash export exists
  dash: "Jump",
  locomotionBlendResponsiveness: 12,
  idleBlendResponsiveness: 10,
  locoTimeScaleMin: 0.75,
  locoTimeScaleMax: 1.35,
};

/** Ability id → logical cast / full-body key used by the avatar bridge. */
export const abilityAnimationBindings: Record<
  string,
  { upper?: keyof CharacterAnimationConfig; fullBody?: keyof CharacterAnimationConfig }
> = {
  bolt: { upper: "castPrimary" },
  shock: { upper: "castPrimary" },
  nova: { upper: "castAoE" },
  rupture: { upper: "castAoE" },
  smash: { upper: "castMelee" },
  dash: { fullBody: "dash" },
};
