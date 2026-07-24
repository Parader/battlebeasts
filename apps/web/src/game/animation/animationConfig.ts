/**
 * Maps logical animation roles → clip names inside the loaded GLB.
 * Update these when swapping characters / Mixamo packs.
 */
import { SMASH_JUMP_ATTACK } from "@battlebeasts/shared";

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
  /** Full-body leap / jump attack (RMB slam). */
  jumpAttack?: string;
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

/**
 * Active mapping for `/hero.glb` (Blender Mixamo export).
 * Cardinal loco + dive + magic/melee attacks. Diagonal jogs exist in the
 * file (`jog_diag_*`) but the blend tree is still 4-way.
 */
export const heroAnimationConfig: CharacterAnimationConfig = {
  idle: "idle",
  runForward: "run",
  runBackward: "run_back",
  strafeLeft: "strafe_left",
  strafeRight: "strafe_right",
  upperBodyIdle: "idle",
  castPrimary: "magic_1h",
  castAoE: "magic_aoe",
  castMelee: "attack",
  heavyCast: "magic_2h",
  dash: "dive",
  jumpAttack: "Jump Attack",
  locomotionBlendResponsiveness: 12,
  idleBlendResponsiveness: 10,
  locoTimeScaleMin: 0.75,
  locoTimeScaleMax: 1.35,
};

/** @deprecated Legacy Mixamo `/character1.glb` clip names. */
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
  dash: "StandingDiveForward",
  locomotionBlendResponsiveness: 12,
  idleBlendResponsiveness: 10,
  locoTimeScaleMin: 0.75,
  locoTimeScaleMax: 1.35,
};

/** Default = hero. */
export const defaultCharacterAnimationConfig = heroAnimationConfig;

/** Ability id → logical cast / full-body key used by the avatar bridge. */
export const abilityAnimationBindings: Record<
  string,
  {
    upper?: keyof CharacterAnimationConfig;
    fullBody?: keyof CharacterAnimationConfig;
    /**
     * Ordered clip names for combo swings (1st, 2nd, 3rd…).
     * Index = castComboHit - 1. Prefer full-body for melee flourishes.
     */
    comboFullBody?: string[];
    comboUpper?: string[];
    /**
     * Single multi-hit clip started on combo swing 1 only.
     * Held across inter-swing gaps so it is not restarted per slash.
     */
    comboFullBodyOnce?: string;
    /** Same as comboFullBodyOnce but upper-body so legs keep locomoting. */
    comboUpperOnce?: string;
    /**
     * Playback length for combo*Once clips (seconds).
     * When set, overrides combo-chain compression so the anim isn't frantic.
     */
    comboAnimDurationSec?: number;
    /**
     * Playback length for fullBody clips (seconds).
     * When set, overrides totalCastDuration so long Mixamo clips aren't sped up.
     */
    fullBodyAnimDurationSec?: number;
    /**
     * Keep clamped full-body end pose through recovery instead of canceling
     * into loco at impact→recovery.
     */
    holdEndPoseOnRecovery?: boolean;
    /**
     * When holding end pose, freeze the clip at this time (seconds) —
     * e.g. Jump Attack ground frame 54 @ 30fps = 1.8.
     */
    holdPoseAtSec?: number;
    /** Play full-body clip at natural speed (timeScale 1). */
    playNaturalSpeed?: boolean;
    /** Clip scrub start (seconds). */
    startAtSec?: number;
    /** Mixer timeScale during anticipation. */
    windupTimeScale?: number;
    /** Mixer timeScale once impact / travel begins. */
    airTimeScale?: number;
  }
> = {
  bolt: { upper: "castPrimary" },
  shock: { upper: "castPrimary" },
  nova: { upper: "castAoE" },
  rupture: { upper: "castAoE" },
  smash: {
    fullBody: "jumpAttack",
    holdEndPoseOnRecovery: true,
    holdPoseAtSec: SMASH_JUMP_ATTACK.groundFrame / SMASH_JUMP_ATTACK.fps,
    startAtSec: SMASH_JUMP_ATTACK.startFrame / SMASH_JUMP_ATTACK.fps,
    windupTimeScale: SMASH_JUMP_ATTACK.windupRate,
    airTimeScale: SMASH_JUMP_ATTACK.playbackRate,
  },
  dash: { fullBody: "dash" },
  crescent: {
    comboUpperOnce: "attack_combo",
  },
};
