import { frostChillSlowPercent, getStatus, type StatusApplication } from "./statuses";

export type AbilityShape = "projectile" | "aoe" | "dash" | "melee" | "buff";

/**
 * Spell lifecycle — mirrors combat animation beats:
 * Anticipation → Cast → Impact pose → Recovery
 */
export type CastPhaseId = "anticipation" | "cast" | "impact" | "recovery";

/**
 * Per-spell timing + movement modifiers.
 * - anticipation: wind-up (arm back, torso twist); cancelable (default). No effect yet.
 * - cast: committed forward acceleration toward release. No effect yet.
 * - impact: effect resolves at phase start (projectile / hit / travel). Hold silhouette.
 * - recovery: return to combat stance / idle.
 */
export interface AbilityTiming {
  anticipationMs: number;
  castMs: number;
  impactMs: number;
  recoveryMs: number;
  /** Movement speed multiplier during anticipation (1 = normal). */
  anticipationMoveMul?: number;
  /** Movement speed multiplier during cast. */
  castMoveMul?: number;
  /** Movement speed multiplier during impact pose. */
  impactMoveMul?: number;
  /** Movement speed multiplier during recovery. */
  recoveryMoveMul?: number;
  /** Cancel allowed only in anticipation (default true). Prefer `cancelUntilPhase`. */
  canCancelAnticipation?: boolean;
  /**
   * Latest phase where player cancel is allowed (inclusive).
   * Default `"anticipation"`. Use `"cast"` until the effect fires; `"impact"` for
   * channelled sprays (e.g. Frost Mist) that stay cancelable while ticking.
   */
  cancelUntilPhase?: "anticipation" | "cast" | "impact";
  /** Block starting other abilities until recovery ends (default true). */
  blocksOtherCasts?: boolean;
}

/**
 * Displacement applied when the cast effect fires.
 * - none: no forced move
 * - instant: teleport (blink)
 * - translate: lerp over durationMs (default for dash)
 */
export type TravelMode = "none" | "instant" | "translate";

export interface AbilityTravel {
  mode: TravelMode;
  /** World units; defaults to ability.range. */
  distance?: number;
  /**
   * Translate duration in ms (ignored for instant).
   * Defaults to timing.impactMs (travel runs with the impact pose).
   */
  durationMs?: number;
  /**
   * Wait this long after impact begins before leaving the ground (unscaled ms).
   * Lets the jump anim plant / crouch before the hop + translate start.
   */
  takeoffDelayMs?: number;
  /**
   * Defer melee/AoE damage + FX until translate completes (landing).
   * Travel still starts at impact begin; cooldown still stamps then.
   */
  effectOnArrive?: boolean;
  /**
   * Horizontal progress remapping over the translate window.
   * `leap` = soft takeoff/land (smoothstep) matched to a ballistic hop.
   */
  progressEase?: "linear" | "leap";
}

/**
 * Invulnerability window relative to cast start (anticipation begin,
 * or first non-zero phase if anticipation is skipped).
 * Example: { startMs: 40, durationMs: 160 } → iframes from t=40ms for 160ms.
 */
export interface AbilityIFrames {
  startMs: number;
  durationMs: number;
}

/**
 * Multi-press / hold chain (e.g. M1 crescent): fire up to `hits` swings,
 * then start cooldown. Stopping mid-chain also starts cooldown; next cast
 * always begins at hit 1.
 */
export interface AbilityCombo {
  /** Swings before full cooldown (must be > 1). */
  hits: number;
  /** Ms after a swing finishes to start the next before CD locks. */
  continueWindowMs: number;
  /**
   * Steady move speed while the chain is live (casting or continue window).
   * Avoids per-phase stop/start jerks on multi-hit M1s.
   */
  moveMul?: number;
}

/**
 * Battlerite-style hotbar (v0).
 * Shift+cast / EX variants come later — not wired yet.
 */
export const SPELL_SLOTS = [
  { id: "m1", label: "LMB", hint: "Left click", input: "mouse0" },
  { id: "m2", label: "RMB", hint: "Right click", input: "mouse2" },
  { id: "space", label: "Space", hint: "Movement", input: "space" },
  { id: "q", label: "Q", hint: "Q", input: "q" },
  { id: "e", label: "E", hint: "E", input: "e" },
  { id: "r", label: "R", hint: "R", input: "r" },
] as const;

export type SpellSlotId = (typeof SPELL_SLOTS)[number]["id"];
export type SpellSlot = (typeof SPELL_SLOTS)[number];

export interface AbilityDef {
  id: string;
  name: string;
  /** Armoury blurb — what the spell does in plain language. */
  description?: string;
  cooldownMs: number;
  range: number;
  shape: AbilityShape;
  damage: number;
  radius?: number;
  speed?: number;
  timing: AbilityTiming;
  /** Projectile spawn distance in front of caster (world units). */
  spawnOffset?: number;
  /** Forced displacement (dash / charge). */
  travel?: AbilityTravel;
  /** Optional invulnerability frames during the cast. */
  iFrames?: AbilityIFrames;
  /** Statuses applied to hit targets when the effect resolves. */
  applyOnHit?: StatusApplication[];
  /** Statuses applied to caster when the effect resolves. */
  applyOnSelf?: StatusApplication[];
  /**
   * Traveling aura projectile: ticks damage in `radius` and applies
   * `applyAuraSlow` in `slowRadius` without despawning on contact.
   */
  aura?: boolean;
  /** Outer slow shell radius (aura projectiles). */
  slowRadius?: number;
  /** Aura tick interval in ms (damage + slow refresh). */
  tickMs?: number;
  /** Statuses refreshed on targets inside `slowRadius` each aura tick. */
  applyAuraSlow?: StatusApplication[];
  /** Optional hit-chain before cooldown (LMB flurries). */
  combo?: AbilityCombo;
  /**
   * If true, this ability can cut another cast at any phase (e.g. Space/dash).
   * Already-fired projectiles/DoTs keep living; only caster cast phases are cleared.
   */
  interruptsOtherCasts?: boolean;
  /**
   * If false, interruptors cannot cut this cast (default true = interruptible).
   */
  interruptible?: boolean;
  /**
   * Hotbar slots this spell may be equipped in.
   * Q-only spells cannot appear in R, etc.
   */
  allowedSlots: SpellSlotId[];
  /** Preferred slot when building the default kit (omit for alternate picks). */
  defaultSlot?: SpellSlotId;
  /** Radial knockback distance (world units) on AoE/melee hit. */
  knockback?: number;
  /** Knockback translate duration in ms (default 220). */
  knockbackMs?: number;
  /**
   * Pull hit targets toward the effect origin / caster (world units).
   * Stops short of overlapping the caster (`pullStopDistance`).
   */
  pull?: number;
  /** Pull translate duration in ms (default 280). */
  pullMs?: number;
  /** Minimum distance from pull origin after the yank (default 1.2). */
  pullStopDistance?: number;
  /** Ground-spike line: number of pops along aim (Spikes). */
  spikeCount?: number;
  /** Delay between consecutive spike pops (ms). */
  spikeStaggerMs?: number;
  /** Distance of the first spike in front of the caster. */
  spikeStart?: number;
  /** Frost Mist: half-angle of the spray cone (radians). */
  coneHalfAngle?: number;
  /** Frost Mist: starting cone length before it expands to `range`. */
  mistStartRange?: number;
  /** Frost Mist: number of damage/chill ticks while spraying. */
  mistTicks?: number;
  /** Frost Mist: ms to ease cone from mistStartRange → range. */
  mistGrowMs?: number;
}

export const LOADOUT_SIZE = SPELL_SLOTS.length;

const DEFAULT_MOVE = {
  anticipation: 0.75,
  cast: 0.45,
  impact: 0.25,
  recovery: 0.85,
} as const;

/**
 * Global scale for cast phase lockouts + matching anim duration.
 * Does not affect projectile `speed`, cooldowns, or damage.
 * 0.6 ≈ 40% faster wind-up / recovery.
 */
export const CAST_EXECUTION_SCALE = 0.6;

function scaledCastMs(ms: number): number {
  return Math.max(0, ms * CAST_EXECUTION_SCALE);
}

/**
 * Jump Attack (hero.glb) markers @ 30fps.
 * Frame 19 = leave ground, 47 = landing begin, 54 = grounded.
 * Windup (start→jump) can run hotter than air (jump→ground) so the cast
 * feels responsive without changing the leap itself.
 */
export const SMASH_JUMP_ATTACK = {
  fps: 30,
  /** Skip the slowest crouch settle — cast starts closer to the jump. */
  startFrame: 8,
  jumpFrame: 19,
  landFrame: 47,
  groundFrame: 54,
  clipDurationSec: 3.833333,
  /** Air / land playback (frames 19→54). */
  playbackRate: 3,
  /** Plant / windup playback (start→19) — snappier commit. */
  windupRate: 5.5,
} as const;

/**
 * magic_aoe (hero.glb) @ 30fps — clip is 3.3s (99 frames).
 * Suck finishes at frame 48; blow / push effect triggers at frame 54.
 * playbackRate compresses the whole cast (anim + VFX + lockout) together.
 */
export const GUST_AOE_CAST = {
  fps: 30,
  /** Inward pull starts (clip start). */
  suckStartFrame: 0,
  /** Inward pull finishes — air fully gathered. */
  suckEndFrame: 48,
  /** Outward blast / gameplay impact. */
  blowFrame: 54,
  /** Measured from hero.glb `magic_aoe`. */
  clipDurationSec: 3.3,
  /** Snappy combat pace (~0.95s full cast; blow ~0.52s). */
  playbackRate: 3.45,
} as const;

function smashSegmentWallMs(fromFrame: number, toFrame: number, rate: number): number {
  const frames = Math.max(0, toFrame - fromFrame);
  return (frames / SMASH_JUMP_ATTACK.fps / Math.max(0.01, rate)) * 1000;
}

function gustFrameWallMs(frame: number): number {
  return (
    (frame / GUST_AOE_CAST.fps / Math.max(0.01, GUST_AOE_CAST.playbackRate)) * 1000
  );
}

function gustRecoveryWallMs(): number {
  const blowWall = gustFrameWallMs(GUST_AOE_CAST.blowFrame);
  const impactHold = 160 / GUST_AOE_CAST.playbackRate;
  const totalWall = (GUST_AOE_CAST.clipDurationSec / GUST_AOE_CAST.playbackRate) * 1000;
  return Math.max(80, totalWall - blowWall - impactHold);
}

function gustAnticipationWallMs(): number {
  return 120 / GUST_AOE_CAST.playbackRate;
}

function gustImpactHoldWallMs(): number {
  return 160 / GUST_AOE_CAST.playbackRate;
}

/**
 * Standing 1H Magic Attack 02 (hero.glb) @ 30fps.
 * Frame 19 = frost ball release.
 */
export const FROST_BALL_CAST = {
  fps: 30,
  releaseFrame: 19,
  clipDurationSec: 2.233333,
  /** Mildly sped windup→release (1 = natural Mixamo pace). */
  playbackRate: 1.35,
  /** Forward from caster — prep orb + projectile spawn share this. */
  spawnOffset: 0.58,
  /** World Y for hand charge / projectile orb. */
  handY: 1.18,
} as const;

function frostBallReleaseWallMs(): number {
  return (
    (FROST_BALL_CAST.releaseFrame / FROST_BALL_CAST.fps / FROST_BALL_CAST.playbackRate) * 1000
  );
}

function frostBallRecoveryWallMs(): number {
  // Keep a brief settle after release — long Mixamo tail blocked follow-up casts.
  return 100;
}

/**
 * Standing 1H Magic Attack 03 (hero.glb) @ 30fps — clip ~2.33s (70 frames).
 * Frame 30 = first venom spike erupts.
 */
export const SPIKES_CAST = {
  fps: 30,
  releaseFrame: 30,
  clipDurationSec: 2.333333,
  /** Compress windup→eruption; keep readable root pop. */
  playbackRate: 1.75,
} as const;

function spikesReleaseWallMs(): number {
  return (
    (SPIKES_CAST.releaseFrame / SPIKES_CAST.fps / SPIKES_CAST.playbackRate) * 1000
  );
}

/**
 * Standing 2H Magic Attack 03 (hero.glb) @ 30fps — clip ~4.33s (130 frames).
 * Frame 34 = frost mist spray begins.
 */
export const FROST_MIST_CAST = {
  fps: 30,
  releaseFrame: 34,
  /** Freeze the 2H cast here while the mist channel keeps spraying. */
  holdFrame: 58,
  clipDurationSec: 4.333333,
  /** Compress windup; keep a readable spray channel after release. */
  playbackRate: 1.55,
  mistTickMs: 250,
  /** Wall-clock to ease from start → full cone (fluid, not stepped). */
  mistGrowMs: 180,
  /**
   * Total spray ticks — after grow, hold fully formed ~2.5–3s
   * (11 × 250ms ≈ 2.75s at full size).
   */
  mistTicks: 14,
} as const;

function frostMistReleaseWallMs(): number {
  return (
    (FROST_MIST_CAST.releaseFrame / FROST_MIST_CAST.fps / FROST_MIST_CAST.playbackRate) *
    1000
  );
}

function frostMistSprayWallMs(): number {
  return FROST_MIST_CAST.mistTicks * FROST_MIST_CAST.mistTickMs;
}

/** Authored ms that yield `wallMs` after CAST_EXECUTION_SCALE. */
function authoredForWallMs(wallMs: number): number {
  return wallMs / CAST_EXECUTION_SCALE;
}

/** Minimal v0 kit — one ability per Battlerite slot. */
export const ABILITIES: Record<string, AbilityDef> = {
  bolt: {
    id: "bolt",
    name: "Bolt",
    description: "Fast single-target magic bolt. Low cooldown primary poke.",
    cooldownMs: 350,
    range: 12,
    shape: "projectile",
    damage: 18,
    speed: 22,
    spawnOffset: 0.32,
    allowedSlots: ["m1"],
    defaultSlot: "m1",
    // ~1.0s window → clip 2.3s plays ~2.3× (snappy, not 8×)
    timing: {
      anticipationMs: 280,
      castMs: 220,
      impactMs: 200,
      recoveryMs: 300,
      anticipationMoveMul: 0.9,
      castMoveMul: 0.65,
      impactMoveMul: 0.55,
      recoveryMoveMul: 1,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
  },
  /** Close-range magical slash — 3 quick hits, then CD (or CD if chain stops early). */
  crescent: {
    id: "crescent",
    name: "Crescent",
    description:
      "Close-range slash combo — three quick hits. Chain swings or stop early to start cooldown.",
    cooldownMs: 550,
    range: 2.2,
    shape: "melee",
    damage: 11,
    /** Tight frontal slash — was 2.0 and felt like a wide AoE. */
    radius: 1.15,
    allowedSlots: ["m1"],
    defaultSlot: "m1",
    combo: {
      hits: 3,
      continueWindowMs: 220,
      moveMul: 0.72,
    },
    timing: {
      anticipationMs: 110,
      castMs: 90,
      impactMs: 155,
      recoveryMs: 155,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
  },
  smash: {
    id: "smash",
    name: "Leap Slam",
    description:
      "Leap to your aim and slam the ground. Airborne iframes; stuns enemies on landing.",
    cooldownMs: 5500,
    range: 2.8,
    shape: "aoe",
    damage: 12,
    radius: 1.9,
    allowedSlots: ["m2"],
    defaultSlot: "m2",
    // Windup start→19 (fast), air 19→54 (unchanged rate), then 150ms pose hold.
    timing: {
      anticipationMs: authoredForWallMs(
        smashSegmentWallMs(
          SMASH_JUMP_ATTACK.startFrame,
          SMASH_JUMP_ATTACK.jumpFrame,
          SMASH_JUMP_ATTACK.windupRate,
        ),
      ),
      castMs: 0,
      impactMs: authoredForWallMs(
        smashSegmentWallMs(
          SMASH_JUMP_ATTACK.jumpFrame,
          SMASH_JUMP_ATTACK.groundFrame,
          SMASH_JUMP_ATTACK.playbackRate,
        ),
      ),
      /** Hold grounded pose (~150ms wall). */
      recoveryMs: authoredForWallMs(150),
      anticipationMoveMul: 0,
      castMoveMul: 0,
      impactMoveMul: 0,
      recoveryMoveMul: 0.45,
      canCancelAnticipation: false,
    },
    travel: {
      mode: "translate",
      distance: 2.8,
      takeoffDelayMs: 0,
      durationMs: authoredForWallMs(
        smashSegmentWallMs(
          SMASH_JUMP_ATTACK.jumpFrame,
          SMASH_JUMP_ATTACK.groundFrame,
          SMASH_JUMP_ATTACK.playbackRate,
        ),
      ),
      effectOnArrive: true,
      progressEase: "leap",
    },
    iFrames: {
      startMs: authoredForWallMs(
        smashSegmentWallMs(
          SMASH_JUMP_ATTACK.startFrame,
          SMASH_JUMP_ATTACK.jumpFrame,
          SMASH_JUMP_ATTACK.windupRate,
        ),
      ),
      durationMs: authoredForWallMs(
        smashSegmentWallMs(
          SMASH_JUMP_ATTACK.jumpFrame,
          SMASH_JUMP_ATTACK.groundFrame,
          SMASH_JUMP_ATTACK.playbackRate,
        ),
      ),
    },
    interruptible: false,
    applyOnHit: [{ statusId: "stunned", durationMs: 1000, chance: 1 }],
  },
  frostBall: {
    id: "frostBall",
    name: "Frost Ball",
    description:
      "Slow drifting frost orb with a ground aura. Ticks damage and refreshes slow on anyone standing in the disc until it expires.",
    cooldownMs: 2800,
    range: 12.5,
    shape: "projectile",
    damage: 3,
    speed: 3.5,
    /** Damage + slow share the same aura radius (matches frost disc visual). */
    radius: 3.9,
    slowRadius: 3.9,
    tickMs: 250,
    aura: true,
    spawnOffset: FROST_BALL_CAST.spawnOffset,
    allowedSlots: ["m2"],
    defaultSlot: "m2",
    timing: {
      anticipationMs: authoredForWallMs(100),
      castMs: authoredForWallMs(Math.max(16, frostBallReleaseWallMs() - 100)),
      impactMs: authoredForWallMs(80),
      recoveryMs: authoredForWallMs(frostBallRecoveryWallMs()),
      anticipationMoveMul: 0.55,
      castMoveMul: 0.35,
      impactMoveMul: 0.45,
      recoveryMoveMul: 0.95,
      canCancelAnticipation: true,
      /** Cancel through windup until the ball spawns at impact. */
      cancelUntilPhase: "cast",
    },
    applyAuraSlow: [{ statusId: "slowed", durationMs: 1200, chance: 1 }],
  },
  /**
   * Electrical augment (Space) — short cast, then +60% move for 3s.
   * Listed before dash so it is the default Space loadout pick.
   */
  surge: {
    id: "surge",
    name: "Surge",
    description: "Crackling self-buff — burst of move speed. Can interrupt your other casts.",
    cooldownMs: 7000,
    range: 0,
    shape: "buff",
    damage: 0,
    allowedSlots: ["space"],
    defaultSlot: "space",
    timing: {
      anticipationMs: 70,
      castMs: 90,
      impactMs: 60,
      recoveryMs: 100,
      anticipationMoveMul: 0.9,
      castMoveMul: 0.85,
      impactMoveMul: 1,
      recoveryMoveMul: 1,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnSelf: [{ statusId: "surged", durationMs: 3000 }],
    interruptsOtherCasts: true,
  },
  dash: {
    id: "dash",
    name: "Dash",
    description: "Dive forward with brief iframes, then a short haste. Cuts other casts.",
    cooldownMs: 4000,
    range: 5,
    shape: "dash",
    damage: 0,
    speed: 18,
    allowedSlots: ["space"],
    defaultSlot: "space",
    // Dive clip ~1.63s; ~0.50s lock after CAST_EXECUTION_SCALE (~3.3×).
    // Travel across impact; short soft recovery (no i-frames).
    timing: {
      anticipationMs: 90,
      castMs: 60,
      impactMs: 560,
      recoveryMs: 110,
      anticipationMoveMul: 0.1,
      castMoveMul: 0,
      impactMoveMul: 0,
      recoveryMoveMul: 0.8,
      canCancelAnticipation: false,
    },
    travel: {
      mode: "translate",
      durationMs: 560,
    },
    // i-frames cover wind-up + most of the dive; drop before get-up.
    iFrames: {
      startMs: 30,
      durationMs: 520,
    },
    applyOnSelf: [{ statusId: "hasted", durationMs: 900 }],
    interruptsOtherCasts: true,
  },
  /**
   * Decoy (Q) — clone appears instantly (hides the cast), then caster crouches into cloak.
   * Invisible to enemies / ghost to self for 2s; any cast or interact reveals.
   * Still takes damage while cloaked.
   */
  decoy: {
    id: "decoy",
    name: "Decoy",
    description:
      "Spawn an identical clone that drifts with your move (or stands still), then cloak for a short time. Invisible to enemies / ghost to yourself. Casting or interacting reveals you; you can still take damage.",
    cooldownMs: 8000,
    range: 0,
    shape: "buff",
    damage: 0,
    allowedSlots: ["q"],
    defaultSlot: "q",
    // Timed to Standing To Crouched (~0.67s @ natural speed).
    timing: {
      anticipationMs: 40,
      castMs: 420,
      impactMs: 100,
      recoveryMs: 180,
      anticipationMoveMul: 0.55,
      castMoveMul: 0.35,
      impactMoveMul: 0.45,
      recoveryMoveMul: 0.75,
      canCancelAnticipation: false,
    },
    applyOnSelf: [{ statusId: "cloaked", durationMs: 2000 }],
  },
  /**
   * Gust (Q) — circular push wave. Alternate Q pick (Decoy is default).
   * Hits shove targets outward, then slow them briefly.
   */
  gust: {
    id: "gust",
    name: "Gust",
    description:
      "Circular push wave at your feet. Knocks enemies outward, then slows them briefly.",
    cooldownMs: 6000,
    range: 0,
    shape: "aoe",
    damage: 12,
    radius: 3.5,
    knockback: 9.5,
    knockbackMs: 320,
    allowedSlots: ["q"],
    // magic_aoe: suck ends @48, blow @54 — wall times scale with playbackRate
    timing: {
      anticipationMs: authoredForWallMs(gustAnticipationWallMs()),
      castMs: authoredForWallMs(
        Math.max(16, gustFrameWallMs(GUST_AOE_CAST.blowFrame) - gustAnticipationWallMs()),
      ),
      impactMs: authoredForWallMs(gustImpactHoldWallMs()),
      recoveryMs: authoredForWallMs(gustRecoveryWallMs()),
      anticipationMoveMul: 0.25,
      castMoveMul: 0.1,
      impactMoveMul: 0,
      recoveryMoveMul: 0.55,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "slowed", durationMs: 1000, chance: 1 }],
  },
  /**
   * Grasp (E) — dark stretching arm / hand yank.
   * Anim: magic_1h (Standing 1H Magic Attack 01).
   */
  grasp: {
    id: "grasp",
    name: "Grasp",
    description:
      "Stretch a dark hand forward and yank an enemy toward you. Light damage, then slows them briefly.",
    cooldownMs: 7000,
    range: 12,
    shape: "projectile",
    damage: 5,
    speed: 26,
    radius: 0.55,
    spawnOffset: 0.42,
    pull: 8,
    pullMs: 320,
    pullStopDistance: 1.35,
    allowedSlots: ["e"],
    defaultSlot: "e",
    // Timed to magic_1h (~2.33s) at a snappy combat pace.
    timing: {
      anticipationMs: 260,
      castMs: 180,
      impactMs: 200,
      recoveryMs: 280,
      anticipationMoveMul: 0.55,
      castMoveMul: 0.35,
      impactMoveMul: 0.4,
      recoveryMoveMul: 0.85,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "slowed", durationMs: 2000, chance: 1 }],
  },
  /**
   * Spikes (E) — staggered poison needles along the aim line.
   * Anim: Standing 1H Magic Attack 03 — first spike @ frame 30.
   */
  spikes: {
    id: "spikes",
    name: "Spikes",
    description:
      "Venomous spikes erupt from the ground in a fast staggered line. Narrow path, long reach; poisons anyone caught.",
    cooldownMs: 5500,
    range: 10,
    shape: "aoe",
    damage: 4,
    /** Hit width per spike — keep the corridor tight. */
    radius: 0.55,
    spikeCount: 9,
    spikeStaggerMs: 32,
    spikeStart: 0.85,
    allowedSlots: ["e"],
    timing: {
      anticipationMs: authoredForWallMs(70),
      castMs: authoredForWallMs(Math.max(16, spikesReleaseWallMs() - 70)),
      impactMs: authoredForWallMs(220),
      recoveryMs: authoredForWallMs(140),
      anticipationMoveMul: 0.55,
      castMoveMul: 0.35,
      impactMoveMul: 0.45,
      recoveryMoveMul: 0.95,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "spikeVenom", chance: 1 }],
  },
  /**
   * Frost Mist (R) — expanding ice spray cone.
   * Anim: Standing 2H Magic Attack 03 — mist starts @ frame 34.
   * Progressive chill: +10% per tick onto current slow (20% if unsowed); root at 100%.
   */
  frostMist: {
    id: "frostMist",
    name: "Frost Mist",
    description:
      "Spray an expanding cone of frost. Ticks damage and deepens chill — stacking onto whatever slow they already have — until they freeze solid at the feet.",
    cooldownMs: 12000,
    range: 11,
    shape: "aoe",
    damage: 3,
    /** Max half-angle once fully spread (~40°). */
    coneHalfAngle: 0.7,
    mistStartRange: 3.2,
    mistTicks: FROST_MIST_CAST.mistTicks,
    mistGrowMs: FROST_MIST_CAST.mistGrowMs,
    tickMs: FROST_MIST_CAST.mistTickMs,
    allowedSlots: ["r"],
    defaultSlot: "r",
    timing: {
      anticipationMs: authoredForWallMs(90),
      castMs: authoredForWallMs(Math.max(16, frostMistReleaseWallMs() - 90)),
      impactMs: authoredForWallMs(frostMistSprayWallMs()),
      recoveryMs: authoredForWallMs(160),
      anticipationMoveMul: 0.5,
      castMoveMul: 0.4,
      impactMoveMul: 0.35,
      recoveryMoveMul: 0.8,
      canCancelAnticipation: true,
      cancelUntilPhase: "impact",
    },
  },
  rupture: {
    id: "rupture",
    name: "Rupture",
    description:
      "Long-windup ground rupture at range. Heavy burst damage; applies bleed and a chance to poison.",
    cooldownMs: 10000,
    range: 10,
    shape: "aoe",
    damage: 40,
    radius: 2.8,
    allowedSlots: ["r"],
    // ~1.5s → AoE clip ~2.2×
    timing: {
      anticipationMs: 450,
      castMs: 300,
      impactMs: 350,
      recoveryMs: 400,
      anticipationMoveMul: 0.2,
      castMoveMul: 0.05,
      impactMoveMul: 0,
      recoveryMoveMul: 0.5,
      canCancelAnticipation: true,
    },
    applyOnHit: [
      { statusId: "bleeding", stacks: 1 },
      { statusId: "poisoned", stacks: 1, chance: 0.5 },
    ],
  },
};

/** Ordered by SPELL_SLOTS: LMB, RMB, Space, Q, E, R */
export const DEFAULT_LOADOUT: readonly string[] = SPELL_SLOTS.map((slot) => {
  const found = Object.values(ABILITIES).find((a) => a.defaultSlot === slot.id);
  return found?.id ?? "bolt";
});

export function canEquipInSlot(abilityId: string, slotId: SpellSlotId): boolean {
  const def = ABILITIES[abilityId];
  return Boolean(def?.allowedSlots.includes(slotId));
}

/** True when the ability chains multiple swings before cooldown. */
export function isComboAbility(def: AbilityDef | undefined): boolean {
  return (def?.combo?.hits ?? 0) > 1;
}

/** Choosable spells for a hotbar slot (Spells UI catalog). */
export function abilitiesForSlot(slotId: SpellSlotId): AbilityDef[] {
  return Object.values(ABILITIES).filter((a) => a.allowedSlots.includes(slotId));
}

function formatSeconds(ms: number): string {
  const s = ms / 1000;
  if (Number.isInteger(s)) return `${s}s`;
  return `${parseFloat(s.toFixed(2))}s`;
}

function formatStatusApp(app: StatusApplication): string | null {
  const st = getStatus(app.statusId);
  if (!st) return app.statusId;
  const dur = app.durationMs ?? st.durationMs;
  const bits: string[] = [st.name];
  if (st.id === "frostChill") {
    const stacks = Math.max(1, app.stacks ?? 1);
    bits.push(`${frostChillSlowPercent(stacks)}% chill`);
  } else if (typeof st.moveMul === "number" && st.moveMul !== 1) {
    if (st.moveMul < 1) {
      bits.push(`${Math.round((1 - st.moveMul) * 100)}% slow`);
    } else {
      bits.push(`+${Math.round((st.moveMul - 1) * 100)}% move`);
    }
  }
  if (st.mechanic === "stun") bits.push("stun");
  if (st.mechanic === "stealth") bits.push("stealth");
  if (st.mechanic === "dot" && st.damagePerTick && st.tickMs) {
    bits.push(`${st.damagePerTick} dmg / ${formatSeconds(st.tickMs)}`);
  }
  if (app.stacks && app.stacks > 1) bits.push(`×${app.stacks}`);
  if (typeof app.chance === "number" && app.chance < 1) {
    bits.push(`${Math.round(app.chance * 100)}%`);
  }
  bits.push(formatSeconds(dur));
  return bits.join(" ");
}

/**
 * Compact mechanical line for the Spells armoury — derived from live ability data
 * so numbers stay in sync with combat.
 */
export function formatAbilityArmoryStats(def: AbilityDef): string {
  const parts: string[] = [`CD ${formatSeconds(def.cooldownMs)}`];

  if (def.aura && def.damage > 0 && def.tickMs) {
    parts.push(`${def.damage} dmg / ${formatSeconds(def.tickMs)}`);
  } else if (def.combo && def.damage > 0) {
    parts.push(`${def.damage}×${def.combo.hits} dmg`);
  } else if (def.damage > 0) {
    parts.push(`${def.damage} dmg`);
  }

  if (def.radius != null && def.radius > 0) {
    parts.push(`AoE ${def.radius}`);
  }
  if (def.spikeCount && def.spikeCount > 1) {
    parts.push(`${def.spikeCount} spikes`);
  }
  if (def.mistTicks && def.mistTicks > 1) {
    parts.push(`${def.mistTicks} ticks`);
  }
  if (def.coneHalfAngle != null && def.coneHalfAngle > 0) {
    parts.push(`cone ${Math.round((def.coneHalfAngle * 2 * 180) / Math.PI)}°`);
  }
  if (def.slowRadius != null && def.slowRadius > 0 && def.slowRadius !== def.radius) {
    parts.push(`slow r${def.slowRadius}`);
  }
  if (def.range > 0 && def.shape !== "buff" && def.shape !== "aoe") {
    parts.push(`range ${def.range}`);
  } else if (def.shape === "aoe" && def.range > 0) {
    parts.push(`range ${def.range}`);
  }
  if (def.knockback) {
    parts.push(`knockback ${def.knockback}`);
  }
  if (def.pull) {
    parts.push(`pull ${def.pull}`);
  }
  if (def.travel?.mode === "translate" || def.shape === "dash") {
    const dist = def.travel?.distance ?? def.range;
    if (dist > 0) parts.push(`travel ${dist}`);
  }
  if (def.iFrames) {
    parts.push(`iframes ${formatSeconds(def.iFrames.durationMs)}`);
  }

  for (const app of def.applyOnHit ?? []) {
    const line = formatStatusApp(app);
    if (line) parts.push(line);
  }
  for (const app of def.applyAuraSlow ?? []) {
    const line = formatStatusApp(app);
    if (line) parts.push(`aura ${line}`);
  }
  for (const app of def.applyOnSelf ?? []) {
    const line = formatStatusApp(app);
    if (line) parts.push(`self ${line}`);
  }

  return parts.join(" · ");
}

function defaultAbilityForSlot(slotId: SpellSlotId): string {
  const preferred = Object.values(ABILITIES).find(
    (a) => a.defaultSlot === slotId && a.allowedSlots.includes(slotId),
  );
  if (preferred) return preferred.id;
  const any = abilitiesForSlot(slotId)[0];
  return any?.id ?? "bolt";
}

/**
 * Produce a length-6 loadout aligned to SPELL_SLOTS.
 * Each index must be an ability allowed in that slot; illegal entries are replaced.
 */
export function normalizeLoadout(abilityIds: string[] | null | undefined): string[] {
  const raw = abilityIds ?? [];
  const out: string[] = [];
  for (let i = 0; i < LOADOUT_SIZE; i++) {
    const slotId = SPELL_SLOTS[i]!.id;
    const candidate = raw[i];
    if (candidate && canEquipInSlot(candidate, slotId)) {
      out.push(candidate);
    } else {
      out.push(defaultAbilityForSlot(slotId));
    }
  }
  return out;
}

export function abilityAtSlot(loadout: string[], slotIndex: number): AbilityDef | undefined {
  const id = loadout[slotIndex];
  return id ? ABILITIES[id] : undefined;
}

export function slotIndexForInput(input: SpellSlot["input"]): number {
  return SPELL_SLOTS.findIndex((s) => s.input === input);
}

export function moveMulForPhase(def: AbilityDef, phase: CastPhaseId): number {
  const t = def.timing;
  if (phase === "anticipation") return t.anticipationMoveMul ?? DEFAULT_MOVE.anticipation;
  if (phase === "cast") return t.castMoveMul ?? DEFAULT_MOVE.cast;
  if (phase === "impact") return t.impactMoveMul ?? DEFAULT_MOVE.impact;
  return t.recoveryMoveMul ?? DEFAULT_MOVE.recovery;
}

/**
 * Authoritative move multiplier during a cast.
 * Combo abilities use a steady `combo.moveMul` (no per-phase spikes).
 */
export function resolveCastMoveMul(def: AbilityDef, phase: CastPhaseId): number {
  if (def.combo?.moveMul != null) return def.combo.moveMul;
  return moveMulForPhase(def, phase);
}

/** Move mul while a combo continue window is open (between swings). */
export function resolveComboContinueMoveMul(def: AbilityDef | undefined): number {
  return def?.combo?.moveMul ?? 1;
}

/**
 * 0-based VFX / pose variant from 1-based `castComboHit` / FX `comboHit`.
 * Falls back to 0 when missing.
 */
export function comboSwingVariant(comboHit: number | undefined, poseCount = 3): number {
  if (!comboHit || comboHit < 1) return 0;
  return (comboHit - 1) % Math.max(1, poseCount);
}

/**
 * Whether the player may cancel during this phase.
 * Recovery is never cancelable. Impact only when `cancelUntilPhase: "impact"`.
 */
export function canPlayerCancelCast(
  def: AbilityDef,
  phase: CastPhaseId | string,
): boolean {
  if (phase !== "anticipation" && phase !== "cast" && phase !== "impact") return false;
  if (def.timing.canCancelAnticipation === false && !def.timing.cancelUntilPhase) {
    return false;
  }
  const until = def.timing.cancelUntilPhase ?? "anticipation";
  if (until === "anticipation") return phase === "anticipation";
  if (until === "cast") return phase === "anticipation" || phase === "cast";
  return phase === "anticipation" || phase === "cast" || phase === "impact";
}

/** Total lockout from anticipation through end of recovery. */
export function totalCastDurationMs(def: AbilityDef): number {
  return (
    phaseDurationMs(def, "anticipation") +
    phaseDurationMs(def, "cast") +
    phaseDurationMs(def, "impact") +
    phaseDurationMs(def, "recovery")
  );
}

/**
 * Wall-clock length of a full combo chain (all hits + continue windows between them).
 * Used to time multi-hit clips (e.g. DualWeaponCombo) to the complete Crescent.
 */
export function comboChainDurationMs(def: AbilityDef): number {
  const hits = Math.max(1, def.combo?.hits ?? 1);
  const swingMs = totalCastDurationMs(def);
  if (hits <= 1 || !def.combo) return swingMs;
  return hits * swingMs + (hits - 1) * def.combo.continueWindowMs;
}

/** Phase duration helper (0 means skip). Includes global CAST_EXECUTION_SCALE. */
export function phaseDurationMs(def: AbilityDef, phase: CastPhaseId): number {
  const t = def.timing;
  if (phase === "anticipation") return scaledCastMs(t.anticipationMs);
  if (phase === "cast") return scaledCastMs(t.castMs);
  if (phase === "impact") return scaledCastMs(t.impactMs);
  return scaledCastMs(t.recoveryMs);
}

const PHASE_ORDER: CastPhaseId[] = ["anticipation", "cast", "impact", "recovery"];

/** Next phase with duration > 0, or null if cast should end. */
export function nextCastPhase(def: AbilityDef, current: CastPhaseId | null): CastPhaseId | null {
  const start = current ? PHASE_ORDER.indexOf(current) + 1 : 0;
  for (let i = Math.max(0, start); i < PHASE_ORDER.length; i++) {
    const phase = PHASE_ORDER[i]!;
    if (phaseDurationMs(def, phase) > 0) return phase;
  }
  return null;
}

/** Resolve travel config (dash defaults to translate over impact). */
export function resolveTravel(def: AbilityDef): AbilityTravel {
  if (def.travel) return def.travel;
  if (def.shape === "dash") {
    // Unscaled authored ms — travelDurationMs applies CAST_EXECUTION_SCALE
    return { mode: "translate", durationMs: def.timing.impactMs };
  }
  return { mode: "none" };
}

export function travelDistance(def: AbilityDef): number {
  const travel = resolveTravel(def);
  return travel.distance ?? def.range;
}

export function travelDurationMs(def: AbilityDef): number {
  const travel = resolveTravel(def);
  if (travel.mode !== "translate") return 0;
  const raw = travel.durationMs ?? def.timing.impactMs;
  // Explicit travel.durationMs is authored in unscaled ms — scale for global snappiness
  return Math.max(16, scaledCastMs(raw));
}

/** Scaled ms after impact start before translate / hop leave the ground. */
export function travelTakeoffDelayMs(def: AbilityDef): number {
  const raw = resolveTravel(def).takeoffDelayMs ?? 0;
  return Math.max(0, scaledCastMs(raw));
}

/** Remap linear 0..1 travel time → path progress for the ability's ease. */
export function travelProgress01(def: AbilityDef, linear01: number): number {
  const t = Math.max(0, Math.min(1, linear01));
  const ease = resolveTravel(def).progressEase ?? "linear";
  if (ease === "leap") return leapTravelProgress(t);
  return t;
}

/**
 * Horizontal leap pacing — mostly constant airspeed (gentle ends only).
 */
export function leapTravelProgress(t01: number): number {
  const t = Math.max(0, Math.min(1, t01));
  // Mild smoothstep — avoid a long mid-air coast
  return t * t * (3 - 2 * t);
}

/**
 * Vertical leap envelope (0..1 height).
 * Near-triangular arc with almost no apex hang. Ascent is the shorter beat;
 * descent gets more of the air window so the fall isn't rushed.
 * Feet return to ground only at t=1.
 */
export function leapHopNormalized(t01: number): number {
  const t = Math.max(0, Math.min(1, t01));
  if (t <= 0 || t >= 1) return 0;

  // ~30% up matches Jump Attack hips peak (~frame 31 of air 19→54).
  const apex = 0.34;
  if (t <= apex) {
    const u = t / apex;
    return Math.pow(u, 1.1);
  }
  const u = (t - apex) / (1 - apex);
  // Mild gravity on the way down (not a linear snap).
  return 1 - Math.pow(u, 1.25);
}

/** True if elapsedMs since cast start is inside the i-frame window. */
export function isInIFrameWindow(def: AbilityDef, elapsedSinceCastStartMs: number): boolean {
  const ifr = def.iFrames;
  if (!ifr || ifr.durationMs <= 0) return false;
  const t = elapsedSinceCastStartMs;
  const start = scaledCastMs(ifr.startMs);
  const end = start + scaledCastMs(ifr.durationMs);
  return t >= start && t < end;
}
