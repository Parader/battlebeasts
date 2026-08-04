/**
 * Maps logical animation roles → clip names inside the loaded GLB.
 * Update these when swapping characters / Mixamo packs.
 */
import { SMASH_JUMP_ATTACK, SPIKES_CAST, POISON_CLOUD_CAST, SMOKE_BOMB_CAST, FROST_MIST_CAST, FROST_BALL_CAST, BOLT_CAST, BARRIER_CAST, HEAL_BEAM_CAST, LIFE_LEECH_CAST, POISON_DART_CAST, ICE_LANCE_CAST, FIREWALL_CAST, HOLY_GROUND_CAST, VOLCANO_CAST, BLOOD_RUSH_CAST, MAGMA_ORBS_CAST, PROTECTION_BUBBLE_CAST, SHROOM_CAST, HAND_SHIELD_CAST, FIREBALL_CAST, RIFT_FISSURE_CAST, fireballThrowSeekSec, fireballReleaseSec, fireballFollowThroughEndSec, EMOTES } from "@battlebeasts/shared";

export type CharacterAnimationConfig = {
  idle: string;
  runForward: string;
  runBackward: string;
  strafeLeft: string;
  strafeRight: string;
  /** Loop while stunned (replaces idle when present). */
  stunnedIdle?: string;
  /** Upper torso when not casting (usually Idle upper mask). */
  upperBodyIdle?: string;
  /** Default upper-body cast (ChestProxy-baked Mixamo clip). */
  castPrimary: string;
  /** Frost Ball / Standing 1H Magic Attack 02. */
  castFrost?: string;
  /** Barrier / Standing 1H Cast Spell 01. */
  castBarrier?: string;
  /** Spikes / Standing 1H Magic Attack 03. */
  castSpikes?: string;
  /** Poison Cloud / Standing Melee Attack Downward. */
  castPoisonCloud?: string;
  castFireballCharge?: string;
  /** Frost Mist / Standing 2H Magic Attack 03. */
  castFrostMist?: string;
  /** Heal Beam / Standing 2H Magic Attack 04. */
  castHealBeam?: string;
  /** Firewall / Standing 2H Magic Area Attack 01. */
  castFirewall?: string;
  /** Protection Bubble / Standing 2H Magic Area Attack 02 (01 fallback). */
  castProtectionBubble?: string;
  /** Magma Orbs / Standing 2H Magic Attack 05. */
  castMagmaOrbs?: string;
  /** Poison Dart / Right Hook. */
  castPoisonDart?: string;
  /** Ice Lance / Baseball Pitching. */
  castIceLance?: string;
  /** Counter / Female Dance Pose. */
  castCounter?: string;
  /** Hand Shield / Standing Block Start. */
  castBlockStart?: string;
  /** Hand Shield / Standing Block Idle (loop). */
  castBlockIdle?: string;
  /** Hand Shield / Standing Block End. */
  castBlockEnd?: string;
  /** Portal / praying channel. */
  castPraying?: string;
  castAoE?: string;
  castMelee?: string;
  dash?: string;
  /** Full-body leap / jump attack (RMB slam). */
  jumpAttack?: string;
  /** Full-body Jazz Dancing (Groove heal). */
  jazzDance?: string;
  /** Idle → crouch (Decoy enter / Blood Rush charge). */
  idleToCrouch?: string;
  /** Crouch → sprint burst (Blood Rush dash). */
  crouchToSprint?: string;
  /** Loop while cloaked and moving. */
  crouchWalk?: string;
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
  stunnedIdle: "Dizzy Idle",
  upperBodyIdle: "idle",
  castPrimary: "magic_1h",
  castFrost: "Standing 1H Magic Attack 02",
  castBarrier: "Standing 1H Cast Spell 01",
  castSpikes: "Standing 1H Magic Attack 03",
  castPoisonCloud: "Standing Melee Attack Downward",
  castFireballCharge: "Casting Spell",
  castFrostMist: "Standing 2H Magic Attack 03",
  /** Standing 2H Magic Attack 04 (was historically exported as magic_2h). */
  castHealBeam: "Standing 2H Magic Attack 04",
  castFirewall: "Standing 2H Magic Area Attack 01",
  /** GLB ships Area Attack 01 only (02 not exported). */
  castProtectionBubble: "Standing 2H Magic Area Attack 01",
  castMagmaOrbs: "Standing 2H Magic Attack 05",
  castPoisonDart: "Right Hook",
  castIceLance: "Baseball Pitching",
  castCounter: "Female Dance Pose",
  castBlockStart: "Standing Block Start",
  castBlockIdle: "Standing Block Idle",
  castBlockEnd: "Standing Block End",
  castPraying: "praying",
  castAoE: "magic_aoe",
  castMelee: "Standing Melee Attack Downward",
  heavyCast: "Standing 2H Magic Attack 04",
  dash: "dive",
  jumpAttack: "Jump Attack",
  jazzDance: "Jazz Dancing",
  idleToCrouch: "Standing To Crouched",
  crouchToSprint: "Crouched To Sprinting",
  crouchWalk: "Crouched Walking",
  locomotionBlendResponsiveness: 12,
  idleBlendResponsiveness: 10,
  locoTimeScaleMin: 0.75,
  locoTimeScaleMax: 2,
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
  locoTimeScaleMax: 2,
};

/** Default = hero. */

/**
 * Base Mixamo action names that need ChestProxy bake for hero upper casts.
 * Keep in sync with tools/spell_cast_bake_actions.json (no *_aim suffix).
 */
export const HERO_CHEST_PROXY_BAKE_ACTIONS = [
  "magic_1h",
  "Standing 1H Magic Attack 02",
  "Standing 1H Cast Spell 01",
  "Standing 1H Magic Attack 03",
  "Standing 2H Magic Attack 03",
  "Standing 2H Magic Attack 04",
  "Standing 2H Magic Area Attack 01",
  "Standing 2H Magic Attack 05",
  "Right Hook",
  "Baseball Pitching",
  "magic_aoe",
  "Standing Melee Attack Downward",
] as const;

export const defaultCharacterAnimationConfig = heroAnimationConfig;

/**
 * emoteId → clip name inside `/hero.glb`, derived from the shared EMOTES
 * catalog. Full-body dance clips are resolved by name (see `resolveClip`),
 * so they don't need dedicated entries on `CharacterAnimationConfig`.
 */
export const emoteAnimationClips: Record<string, string> = Object.fromEntries(
  Object.values(EMOTES).map((e) => [e.id, e.animClip]),
);

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
     * Playback length for upper-body casts (seconds).
     * When set, overrides totalCastDuration so release frames stay on beat.
     */
    upperAnimDurationSec?: number;
    /** Explicit upper-cast mixer timeScale (wins over upperAnimDurationSec). */
    upperTimeScale?: number;
    /** Freeze upper cast at this clip time (seconds) for channel holds. */
    upperHoldAtSec?: number;
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
    /** Loop full-body until cast clears (Groove channel). */
    fullBodyLoop?: boolean;
    /** Clip scrub start (seconds). */
    startAtSec?: number;
    /** Mixer timeScale during anticipation. */
    windupTimeScale?: number;
    /** Mixer timeScale once impact / travel begins. */
    airTimeScale?: number;
    /**
     * Swap to this full-body clip when impact begins (Blood Rush crouch → sprint).
     * Logical key on CharacterAnimationConfig or raw clip name.
     */
    /** Swap upper cast when castComboHit >= 2 (legacy two-clip release). */
    impactUpper?: keyof CharacterAnimationConfig;
    upperLoop?: boolean;
    impactUpperTimeScale?: number;
    /**
     * Keep the same upper clip; when castComboHit reaches this value, release
     * upperHoldAtSec and let the throw frames play (Fireball Casting Spell).
     */
    releaseHoldOnComboHit?: number;
    impactFullBody?: keyof CharacterAnimationConfig | string;
    /** Playback length for impactFullBody (seconds). */
    impactFullBodyAnimDurationSec?: number;
    /** Mixer timeScale for impactFullBody. */
    impactFullBodyTimeScale?: number;
    /** Loop impactFullBody while impact holds (Hand Shield idle). */
    impactFullBodyLoop?: boolean;
    /**
     * Play this full-body clip on recovery (Hand Shield End).
     * Logical key on CharacterAnimationConfig or raw clip name.
     */
    recoveryFullBody?: keyof CharacterAnimationConfig | string;
    /** Playback length for recoveryFullBody (seconds). */
    recoveryFullBodyAnimDurationSec?: number;
    /**
     * On recovery, seek the active upper cast forward to this time (seconds)
     * if earlier — Fireball early throw jumps to the casting frames (~143).
     */
    recoveryUpperSeekSec?: number;
    /** Clip time (sec) when the projectile leaves — start accelerating after. */
    recoveryUpperReleaseSec?: number;
    /** Mixer timeScale after release (Fireball follow-through). */
    recoveryUpperTimeScale?: number;
    /** Cancel upper cast once clip time reaches this (skip long end settle). */
    recoveryUpperEndSec?: number;
  }
> = {
  bolt: {
    upper: "castPrimary",
    upperTimeScale: BOLT_CAST.playbackRate,
  },
  grasp: { upper: "castPrimary" },
  chainJump: { upper: "castPrimary" },
  fireball: {
    upper: "castFireballCharge",
    upperTimeScale: FIREBALL_CAST.playbackRate,
    recoveryUpperSeekSec: fireballThrowSeekSec(),
    recoveryUpperReleaseSec: fireballReleaseSec(),
    recoveryUpperTimeScale: FIREBALL_CAST.followThroughTimeScale,
    recoveryUpperEndSec: fireballFollowThroughEndSec(),
  },
  poisonCloud: {
    upper: "castPoisonCloud",
    upperTimeScale: POISON_CLOUD_CAST.playbackRate,
  },
  smokeBomb: {
    upper: "castPoisonCloud",
    upperTimeScale: SMOKE_BOMB_CAST.playbackRate,
  },
  spikes: {
    upper: "castSpikes",
    upperAnimDurationSec: SPIKES_CAST.clipDurationSec / SPIKES_CAST.playbackRate,
  },
  frostMist: {
    upper: "castFrostMist",
    upperTimeScale: FROST_MIST_CAST.playbackRate,
    upperHoldAtSec: FROST_MIST_CAST.holdFrame / FROST_MIST_CAST.fps,
  },
  lifeLeech: {
    upper: "castFrostMist",
    upperTimeScale: LIFE_LEECH_CAST.playbackRate,
    upperHoldAtSec: LIFE_LEECH_CAST.holdFrame / LIFE_LEECH_CAST.fps,
  },
  healBeam: {
    upper: "castHealBeam",
    upperTimeScale: HEAL_BEAM_CAST.playbackRate,
    upperHoldAtSec: HEAL_BEAM_CAST.holdFrame / HEAL_BEAM_CAST.fps,
  },
  firewall: {
    upper: "castFirewall",
    upperTimeScale: FIREWALL_CAST.playbackRate,
  },
  holyGround: {
    upper: "castFirewall",
    upperTimeScale: HOLY_GROUND_CAST.playbackRate,
  },
  volcano: {
    upper: "castFirewall",
    upperTimeScale: VOLCANO_CAST.playbackRate,
  },
  protectionBubble: {
    upper: "castProtectionBubble",
    upperTimeScale: PROTECTION_BUBBLE_CAST.playbackRate,
  },
  shrooms: {
    /** Same Standing 1H Cast Spell 01 as Barrier. */
    upper: "castBarrier",
    upperTimeScale: SHROOM_CAST.playbackRate,
  },
  riftFissure: {
    /** Same Standing 1H Cast Spell 01 as Barrier. */
    upper: "castBarrier",
    upperTimeScale: RIFT_FISSURE_CAST.playbackRate,
  },
  magmaOrbs: {
    upper: "castMagmaOrbs",
    upperTimeScale: MAGMA_ORBS_CAST.playbackRate,
  },
  frostBall: {
    upper: "castFrost",
    upperTimeScale: FROST_BALL_CAST.playbackRate,
  },
  poisonDart: {
    upper: "castPoisonDart",
    upperTimeScale: POISON_DART_CAST.playbackRate,
  },
  silenceSweep: {
    upper: "castPoisonDart",
    upperTimeScale: POISON_DART_CAST.playbackRate,
  },
  iceLance: {
    upper: "castIceLance",
    upperTimeScale: ICE_LANCE_CAST.playbackRate,
  },
  barrier: {
    upper: "castBarrier",
    upperTimeScale: BARRIER_CAST.playbackRate,
  },
  counter: {
    fullBody: "castCounter",
    holdEndPoseOnRecovery: true,
    holdPoseAtSec: 0.05,
    /** Snap into pose; freeze for the rooted channel. */
    fullBodyAnimDurationSec: 0.15,
  },
  revenge: {
    fullBody: "castCounter",
    holdEndPoseOnRecovery: true,
    holdPoseAtSec: 0.05,
    fullBodyAnimDurationSec: 0.15,
  },
  handShield: {
    fullBody: "castBlockStart",
    playNaturalSpeed: true,
    fullBodyAnimDurationSec: HAND_SHIELD_CAST.startClipSec,
    impactFullBody: "castBlockIdle",
    impactFullBodyLoop: true,
    recoveryFullBody: "castBlockEnd",
    recoveryFullBodyAnimDurationSec: HAND_SHIELD_CAST.recoveryMs / 1000,
  },
  portal: {
    fullBody: "castPraying",
    holdEndPoseOnRecovery: true,
    holdPoseAtSec: 0.2,
    fullBodyAnimDurationSec: 0.35,
  },
  surge: { upper: "castPrimary" },
  decoy: {
    fullBody: "idleToCrouch",
    holdEndPoseOnRecovery: true,
    /** Standing To Crouched natural length (~0.67s). */
    fullBodyAnimDurationSec: 0.67,
  },
  gust: { upper: "castAoE" },
  groove: {
    fullBody: "jazzDance",
    fullBodyLoop: true,
    playNaturalSpeed: true,
  },
  smash: {
    fullBody: "jumpAttack",
    holdEndPoseOnRecovery: true,
    holdPoseAtSec: SMASH_JUMP_ATTACK.groundFrame / SMASH_JUMP_ATTACK.fps,
    startAtSec: SMASH_JUMP_ATTACK.startFrame / SMASH_JUMP_ATTACK.fps,
    windupTimeScale: SMASH_JUMP_ATTACK.windupRate,
    airTimeScale: SMASH_JUMP_ATTACK.playbackRate,
  },
  dash: { fullBody: "dash" },
  spiritForm: {
    fullBody: "crouchToSprint",
    fullBodyAnimDurationSec: 0.35,
  },
  bloodRush: {
    fullBody: "idleToCrouch",
    /** Natural crouch — clampWhenFinished holds the low pose for the rest of the 1s charge. */
    playNaturalSpeed: true,
    /** Skip Mixamo's first-frame hips hitch off idle. */
    startAtSec: 0.05,
    impactFullBody: "crouchToSprint",
    /** Compress ~0.53s clip into the travel window. */
    impactFullBodyTimeScale: 0.53 / (BLOOD_RUSH_CAST.travelMs / 1000),
    impactFullBodyAnimDurationSec: BLOOD_RUSH_CAST.travelMs / 1000,
  },
  crescent: {
    comboUpperOnce: "attack_combo",
  },
};
