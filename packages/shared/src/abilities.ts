import { combatMag } from "./combatMagnitude";
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
   * Channelled abilities (`cancelUntilPhase: "impact"`) cannot be cut by other casts —
   * only player cancel / hard interrupt (stun) ends them early.
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
  /**
   * While translating, apply `damage` + `applyOnHit` to units crossed
   * (once per cast). Used by Blood Rush.
   */
  hitAlongPath?: boolean;
};

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
  /** Optional per-hit damage (1-based index into this array; last entry repeats). */
  damageByHit?: number[];
}

/** Damage for a combo swing (1-based hit index). Falls back to `def.damage`. */
export function abilityComboHitDamage(def: AbilityDef, hitIndex1Based: number): number {
  const arr = def.combo?.damageByHit;
  if (arr && arr.length > 0) {
    const i = Math.max(0, Math.min(arr.length - 1, hitIndex1Based - 1));
    return arr[i]!;
  }
  return def.damage;
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
  { id: "f", label: "F", hint: "F", input: "f" },
] as const;

export type SpellSlotId = (typeof SPELL_SLOTS)[number]["id"];
export type SpellSlot = (typeof SPELL_SLOTS)[number];

/**
 * Combat fire path — prefer this over `def.id === "…"`.
 * `standard` uses shape (projectile / melee / aoe / dash / buff) + optional travel/aura.
 */
export type AbilityEffectKind =
  | "standard"
  | "spikeWave"
  | "coneChannel"
  | "silenceSweep"
  | "pulseHeal"
  | "healBeam"
  | "lifeLeech"
  | "decoy"
  | "firewall"
  | "volcano"
  | "poisonCloud"
  | "smokeBomb"
  | "holyGround"
  | "magmaOrbs"
  | "protectionBubble"
  | "shrooms"
  | "spiritForm"
  | "riftFissure"
  | "fireball";

/** Mechanical tags for talent matching (Tag Dictionary). */
export type SpellTag =
  | "Projectile"
  | "Explosion"
  | "Area"
  | "Nova"
  | "Cone"
  | "Line"
  | "Melee"
  | "Dash"
  | "Blink"
  | "Channel"
  | "Instant"
  | "Cast"
  | "Damage"
  | "Healing"
  | "HealOverTime"
  | "Shield"
  | "Self"
  | "Ally"
  | "SingleTarget"
  | "MultiHit"
  | "DamageOverTime"
  | "Debuff"
  | "Control"
  | "CrowdControl"
  | "Stun"
  | "Root"
  | "Silence"
  | "Fear"
  | "Slow"
  | "Knockback"
  | "Pull"
  | "Knockup"
  | "Movement"
  | "Haste"
  | "Defense"
  | "Defensive"
  | "Barrier"
  | "Summon"
  | "Obstacle"
  | "Wall"
  | "GroundEffect"
  | "Combo"
  | "Cooldown"
  | "Utility"
  | "Stealth"
  | "Reveal"
  | "Counter"
  | "Reflect"
  | "Pierce"
  | "Homing"
  | "Chain"
  | "Trap"
  | "Persistent"
  | "Buff"
  | "Cleanse"
  | "Purge"
  | "Interrupt"
  | "Resource"
  | "SpellSlot";

export interface AbilityDef {
  id: string;
  name: string;
  /** Armoury blurb — what the spell does in plain language. */
  description?: string;
  cooldownMs: number;
  range: number;
  shape: AbilityShape;
  /** Combat dispatcher key. Defaults to `standard` when omitted. */
  effectKind?: AbilityEffectKind;
  /** Tags for talent hooks (design + runtime matching). */
  tags?: readonly SpellTag[];
  damage: number;
  /** Instant heal amount per tick (self-centered AoE support spells). */
  heal?: number;
  /** Number of heal pulses over the channel (Groove). */
  healTicks?: number;
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
  /**
   * If set, a hit on a target at or below this HP fraction (0–1)
   * deals their remaining HP instead (execute). Blood Rush uses 0.25.
   */
  executeBelowHpFrac?: number;
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
  /**
   * Contact projectile that sticks (on hit) or drops (on miss/wall), then
   * explodes after `delayMs`. Impact still uses `damage` (direct / counterable);
   * the blast uses `detonate.damage` via raw AoE (not counterable).
   */
  detonate?: {
    delayMs: number;
    damage: number;
    radius: number;
  };
  /** Optional hit-chain before cooldown (LMB flurries). */
  combo?: AbilityCombo;
  /**
   * If true, this ability can cut another cast at any phase (e.g. Space/dash).
   * Already-fired projectiles/DoTs keep living; only caster cast phases are cleared.
   */
  interruptsOtherCasts?: boolean;
  /**
   * If true with `interruptsOtherCasts`, also cuts channels and `interruptible: false`
   * casts (Counter acts like a cancel).
   */
  cutsAnyCast?: boolean;
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
  /**
   * Essence cost to unlock in Spell Armoury.
   * Omit / 0 = starter (always owned with DEFAULT_LOADOUT).
   */
  unlockCostEssence?: number;
  /** Radial knockback distance (world units) on AoE/melee hit. */
  knockback?: number;
  /** Knockback translate duration in ms (default 220). */
  knockbackMs?: number;
  /**
   * Pull hit targets toward the effect origin / caster (world units).
   * Stops short of overlapping the caster (`pullStopDistance`).
   * When `leapToTarget` is true, the caster leaps toward the hit instead.
   */
  pull?: number;
  /** Pull / leap translate duration in ms (default 280). */
  pullMs?: number;
  /** Minimum distance from pull origin after the yank (default 1.2). */
  pullStopDistance?: number;
  /**
   * If true with `pull`, yank the caster to the hit target (Chain Jump)
   * instead of yanking the target to the caster (Grasp).
   */
  leapToTarget?: boolean;
  /** Ground-spike line: number of pops along aim (Spikes). */
  spikeCount?: number;
  /** Delay between consecutive spike pops (ms). */
  spikeStaggerMs?: number;
  /** Distance of the first spike in front of the caster. */
  spikeStart?: number;
  /**
   * Persistent ground zone lifetime (Firewall).
   * Ticks `damage` every `tickMs` while active.
   */
  zoneDurationMs?: number;
  /** Frost Mist / Silence Sweep: half-angle of the spray cone (radians). */
  coneHalfAngle?: number;
  /** Frost Mist: starting cone length before it expands to `range`. */
  mistStartRange?: number;
  /** Frost Mist: number of damage/chill ticks while spraying. */
  mistTicks?: number;
  /** Frost Mist: ms to ease cone from mistStartRange → range. */
  mistGrowMs?: number;
  /** Silence Sweep: how long the R→L blade travels across the cone (ms). */
  sweepMs?: number;
  /** Silence Sweep: half-angle of the thin leading blade (radians). */
  sweepBladeHalfAngle?: number;
  /**
   * Hold-to-confirm: impact is a channel; effect fires on `confirmCast` (key release),
   * not automatically when impact begins.
   */
  confirmOnRelease?: boolean;
  /**
   * Hold-to-channel: effect starts at impact and keeps going until player cancel.
   * Cooldown starts on cancel / hard interrupt (not when the channel begins).
   */
  holdChannel?: boolean;
  /** Wall ms from channel start to reach max blink range (Portal). */
  channelChargeMs?: number;
  /** Wall ms after max charge to confirm before auto-cancel (Portal). */
  channelCapGraceMs?: number;
  /** Minimum blink distance on an instant confirm (Portal). */
  channelMinRange?: number;
}

export const LOADOUT_SIZE = SPELL_SLOTS.length;

/** Baseline ~40% cast slow; per-spell timing overrides vary lightly by commitment. */
const DEFAULT_MOVE = {
  anticipation: 0.7,
  cast: 0.6,
  impact: 0.55,
  recovery: 0.9,
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
 * Standing 1H Cast Spell 01 (hero.glb) @ 30fps — ~2.3s / 69 frames.
 * Frame 24 ≈ barrier bubble lands.
 */
export const BARRIER_CAST = {
  fps: 30,
  releaseFrame: 24,
  clipDurationSec: 2.3,
  /** Natural Mixamo pace. */
  playbackRate: 1,
  /** Absorb HP charged over anticipation+cast, then held this long. */
  shieldStacks: combatMag(40),
  shieldDurationMs: 3000,
} as const;

function barrierReleaseWallMs(): number {
  return (
    (BARRIER_CAST.releaseFrame / BARRIER_CAST.fps / BARRIER_CAST.playbackRate) * 1000
  );
}

function barrierRecoveryWallMs(): number {
  return 160;
}

/**
 * Rift Fissure (Space) — Standing 1H Cast Spell 01 (same clip as Barrier).
 * First cast plants portal A (CD starts); 5s to plant B; pair lasts 10s.
 */
export const RIFT_FISSURE_CAST = {
  fps: BARRIER_CAST.fps,
  releaseFrame: BARRIER_CAST.releaseFrame,
  clipDurationSec: BARRIER_CAST.clipDurationSec,
  playbackRate: 1.25,
  unlockCostEssence: 120,
  /** Longer than Portal / Dash. */
  cooldownMs: 26000,
  /** Forward plant distance from caster feet. */
  placeForward: 2.1,
  /** Trigger / mouth radius — keep tight so you walk into the oval. */
  mouthRadius: 0.45,
  /** Enter slab half-width along portal right (× mouthRadius). */
  enterSideHalf: 1.0,
  /** Enter slab half-depth along portal facing (× mouthRadius) — thin face. */
  enterDepthHalf: 0.5,
  /**
   * Face-entry bias: require |alongFwd| >= |alongSide| * this so side scrapes
   * (walking into the left/right edge) do not teleport.
   */
  enterFaceBias: 0.85,
  /**
   * Walk-block pane half-depth along facing (× mouthRadius). Thin enough that
   * face entry still reaches the trigger before getting stuck; blocks side pass-through.
   */
  colliderDepthHalf: 0.2,
  /** Time after A to plant B. */
  armMs: 5000,
  /** Pair lifetime once B is planted (both mouths share this clock). */
  pairDurationMs: 10000,
  /**
   * Exit distance from mouth center along the exit face (Front↔Back link).
   * Must clear mouthRadius + playerHitRadius so the traveler does not
   * immediately re-trigger the exit portal.
   */
  exitPush: 1.2,
  /** Extra shove away from the exit mouth after landing. */
  exitShove: 0.45,
  /** Duration of the exit shove (ms). */
  exitShoveMs: 200,
  /** Per-traveler gate after a teleport (safety against ping-pong). */
  travelerCooldownMs: 750,
  recoveryMs: 160,
} as const;

function riftFissureReleaseWallMs(): number {
  return (
    (RIFT_FISSURE_CAST.releaseFrame /
      RIFT_FISSURE_CAST.fps /
      RIFT_FISSURE_CAST.playbackRate) *
    1000
  );
}

function riftFissureRecoveryWallMs(): number {
  return RIFT_FISSURE_CAST.recoveryMs;
}

/**
 * Spore Shrooms (LMB) — Standing 1H Cast Spell 01 @ 30fps.
 * Frame 18: shroom begins emerging. Frame 36: armed and triggerable.
 */
export const SHROOM_CAST = {
  fps: 30,
  spawnFrame: 18,
  effectiveFrame: 36,
  clipDurationSec: 2.3,
  playbackRate: 1.35,
  /** Cursor ground aim — plants at cursor, clamped to this max distance. */
  range: 7,
  /** Footpad that arms the step trigger. */
  triggerRadius: 0.9,
  /** Ally heal / enemy poison blast radius (VFX cloud). */
  blastRadius: 3.4,
  /** Poison apply radius — inset so hits stay inside the cloud visual. */
  poisonRadius: 2.5,
  /** Stage 1 → 2. */
  stage2Ms: 4000,
  /** Stage 1 → 3 (stage2 + stage-2 dwell). */
  stage3Ms: 10000,
  /** Despawn if never stepped on. */
  maxLifeMs: 32000,
  /** Max living plants per caster; oldest sinks when exceeded. */
  maxActive: 3,
  /** Cull / expire sink animation. */
  sinkMs: 480,
  /** Burst is poison-only on enemy trigger (no direct explode damage). */
  explodeDamage: 0,
  cooldownMs: 1000,
  unlockCostEssence: 90,
} as const;

function shroomSpawnWallMs(): number {
  return (
    (SHROOM_CAST.spawnFrame / SHROOM_CAST.fps / SHROOM_CAST.playbackRate) * 1000
  );
}

function shroomEffectiveWallMs(): number {
  return (
    (SHROOM_CAST.effectiveFrame / SHROOM_CAST.fps / SHROOM_CAST.playbackRate) *
    1000
  );
}

function shroomRecoveryWallMs(): number {
  return 200;
}

/**
 * Standing 1H Magic Attack 01 / magic_1h (hero.glb) @ 30fps.
 * Arm punch peaks ~0.85s (frame 26) — release there, not during windup.
 * playbackRate > 1 so the peak lands in a frost-like ~0.6s wall window.
 */
export const BOLT_CAST = {
  fps: 30,
  releaseFrame: 26,
  clipDurationSec: 2.333333,
  /** Faster poke — windup→punch compressed for M1 tempo. */
  playbackRate: 1.95,
  /** Forward from caster — muzzle flash + projectile spawn share this. */
  spawnOffset: 0.95,
  /** World Y for muzzle flash. */
  handY: 1.05,
} as const;

function boltReleaseWallMs(): number {
  return (
    (BOLT_CAST.releaseFrame / BOLT_CAST.fps / BOLT_CAST.playbackRate) * 1000
  );
}

function boltRecoveryWallMs(): number {
  return 70;
}

/**
 * Standing 1H Magic Attack 02 (hero.glb) @ 30fps.
 * Frame 19 = frost ball release.
 */
export const FROST_BALL_CAST = {
  fps: 30,
  releaseFrame: 19,
  clipDurationSec: 2.233333,
  /** 1 = natural Mixamo pace for windup→release. */
  playbackRate: 1,
  /** Forward from caster — prep orb + projectile spawn share this. */
  spawnOffset: 0.92,
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
 * Right Hook (hero.glb) @ 30fps — clip 1.1s (33 frames).
 * Projectile leaves at frame 11 of the original Mixamo clip (natural pace).
 */
export const POISON_DART_CAST = {
  fps: 30,
  releaseFrame: 11,
  clipDurationSec: 1.1,
  /** 1 = original Mixamo timing so frame 11 lines up with release. */
  playbackRate: 1,
  /** Closer to the body so short-range throws stay visible. */
  spawnOffset: 0.12,
  handY: 1.05,
} as const;

function poisonDartReleaseWallMs(): number {
  return (
    (POISON_DART_CAST.releaseFrame /
      POISON_DART_CAST.fps /
      POISON_DART_CAST.playbackRate) *
    1000
  );
}

function poisonDartRecoveryWallMs(): number {
  return 90;
}

/**
 * Silence Sweep (E) — Right Hook slash of cursed shadow.
 * Blade rotates right→left across a mid-range frontal cone.
 */
export const SILENCE_SWEEP_CAST = {
  unlockCostEssence: 90,
  cooldownMs: 11000,
  /** Mid-close frontal reach (shorter than Grasp / Frost Mist). */
  range: 5.5,
  /** Full frontal cone half-angle (~80°). */
  coneHalfAngle: 0.7,
  /** Thin leading blade half-angle. */
  sweepBladeHalfAngle: 0.2,
  /** True sweep travel time (R→L). */
  sweepMs: 280,
  silenceDurationMs: 3000,
  /** Reuse Right Hook release timing. */
  fps: POISON_DART_CAST.fps,
  releaseFrame: POISON_DART_CAST.releaseFrame,
  clipDurationSec: POISON_DART_CAST.clipDurationSec,
  playbackRate: POISON_DART_CAST.playbackRate,
} as const;

function silenceSweepReleaseWallMs(): number {
  return (
    (SILENCE_SWEEP_CAST.releaseFrame /
      SILENCE_SWEEP_CAST.fps /
      SILENCE_SWEEP_CAST.playbackRate) *
    1000
  );
}

function silenceSweepRecoveryWallMs(): number {
  return 110;
}

/**
 * Baseball Pitching (hero.glb) @ 30fps — clip ~5.23s.
 * Frame 24 = ice lance appears in the throwing hand.
 * Frame 64 = release / projectile spawn.
 * playbackRate compresses windup→throw while keeping those frame markers.
 */
export const ICE_LANCE_CAST = {
  fps: 30,
  spawnFrame: 24,
  releaseFrame: 64,
  clipDurationSec: 5.233333,
  playbackRate: 2.1,
  spawnOffset: 0.55,
  handY: 1.2,
} as const;

function iceLanceSpawnWallMs(): number {
  return (
    (ICE_LANCE_CAST.spawnFrame / ICE_LANCE_CAST.fps / ICE_LANCE_CAST.playbackRate) * 1000
  );
}

function iceLanceReleaseWallMs(): number {
  return (
    (ICE_LANCE_CAST.releaseFrame / ICE_LANCE_CAST.fps / ICE_LANCE_CAST.playbackRate) *
    1000
  );
}

function iceLanceRecoveryWallMs(): number {
  return 180;
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

/**
 * Standing 2H Magic Area Attack 01 @ 30fps — clip 3.0s (90 frames).
 * Firewall ignites at original frame 42; cancelable before that.
 */
export const FIREWALL_CAST = {
  fps: 30,
  releaseFrame: 42,
  clipDurationSec: 3,
  /** Faster windup; frame 42 still = ignition in clip time. */
  playbackRate: 1.75,
  zoneDurationMs: 7500,
  tickMs: 400,
} as const;

/**
 * Poison Cloud (E) — Standing Melee Attack Downward.
 * Frame 26: vial leaves the hand toward ground aim; cloud persists after impact.
 */
export const POISON_CLOUD_CAST = {
  fps: 30,
  releaseFrame: 26,
  /** Mixamo clip length (~69 frames @ 30fps). */
  clipDurationSec: 2.3,
  playbackRate: 1.35,
  zoneDurationMs: 5500,
  /** Stack pace — ~3 poison stacks if you stay for most of the zone. */
  tickMs: 1600,
  radius: 3,
  range: 9,
  /** Soft settle after the vial lands. */
  recoveryMs: 380,
  unlockCostEssence: 90,
  cooldownMs: 11000,
} as const;

/**
 * Smoke Bomb (Q) — Standing Melee Attack Downward.
 * Frame 28: grey smoke bursts at your feet and you crouch into cloak.
 */
export const SMOKE_BOMB_CAST = {
  fps: 30,
  releaseFrame: 28,
  clipDurationSec: 2.3,
  playbackRate: 1.35,
  /** Larger lingering cloud than Poison Cloud. */
  zoneDurationMs: 5000,
  tickMs: 1000,
  radius: 4.5,
  recoveryMs: 280,
  /** Cloak lasts while you stay in the cloud (refreshed each combat tick). */
  unlockCostEssence: 100,
  cooldownMs: 12000,
} as const;

/**
 * Holy Ground (R) — Standing 2H Magic Area Attack 01 (same clip as Firewall).
 * Consecrates a circle at your feet @ frame 42; allies inside gain resist + damage.
 */
export const HOLY_GROUND_CAST = {
  fps: FIREWALL_CAST.fps,
  releaseFrame: FIREWALL_CAST.releaseFrame,
  clipDurationSec: FIREWALL_CAST.clipDurationSec,
  playbackRate: FIREWALL_CAST.playbackRate,
  /** Shorter than CD so only one zone is live at a time. */
  zoneDurationMs: 6500,
  tickMs: 400,
  radius: 4.5,
  recoveryMs: 420,
  unlockCostEssence: 120,
  cooldownMs: 14000,
} as const;

/**
 * Volcano (F) — same Standing 2H Magic Area Attack 01 clip as Firewall.
 * Erupts at frame 42; rocks barrage for `zoneDurationMs` after emerge.
 */
export const VOLCANO_CAST = {
  fps: FIREWALL_CAST.fps,
  releaseFrame: FIREWALL_CAST.releaseFrame,
  clipDurationSec: FIREWALL_CAST.clipDurationSec,
  playbackRate: FIREWALL_CAST.playbackRate,
  /** Active rock-throw window after volcano finishes rising. */
  zoneDurationMs: 10000,
  /** ~1.5 rocks / sec. */
  rockIntervalMs: 650,
  /** Red circle + boulder arc lead time before impact. */
  telegraphMs: 1300,
  rockRingMin: 2.2,
  rockRingMax: 7.0,
  rockBlastRadius: 2.2,
  collideRadius: 1.35,
  /** How often bodies pressed against the volcano re-apply burning. */
  contactTickMs: 400,
  riseMs: 900,
  sinkMs: 800,
} as const;

/**
 * Protection Bubble (F) — Standing 2H Magic Area Attack 02 (falls back to 01 in hero.glb).
 * Locked cast; places a fixed dome that blocks inbound projectiles only.
 */
export const PROTECTION_BUBBLE_CAST = {
  fps: FIREWALL_CAST.fps,
  releaseFrame: FIREWALL_CAST.releaseFrame,
  clipDurationSec: FIREWALL_CAST.clipDurationSec,
  playbackRate: FIREWALL_CAST.playbackRate,
  /** Dome radius (XZ) — roomy enough to cast from inside. */
  radius: 4.75,
  /** Visual / collide grow-in. */
  formMs: 850,
  /** Fully formed protection window. */
  zoneDurationMs: 7000,
  /** Soft dissolve after active ends. */
  fadeMs: 550,
  cooldownMs: 20000,
  unlockCostEssence: 120,
  /** Absorb ticks while the dome is fully formed. */
  shieldTickMs: 250,
  shieldPerTick: combatMag(2),
  shieldCap: combatMag(30),
} as const;

/**
 * Magma Orbs (RMB) — Standing 2H Magic Attack 05 @ 30fps.
 * Frame 24: twin magma boulders start rising. Hold loft through frame 60,
 * then arc on round paths and collide into each other (explode).
 */
export const MAGMA_ORBS_CAST = {
  fps: 30,
  emergeFrame: 24,
  /** Orbs leave loft and begin curved flight. */
  launchFrame: 60,
  /** Head-on collide + detonate. */
  explodeFrame: 88,
  clipDurationSec: 3.566667,
  playbackRate: 1.55,
  /** Default meet distance when cursor aim is missing (mid of min/max). */
  meetRange: 7.5,
  /** Cursor distance clamped to this band — meet point follows aim. */
  meetRangeMin: 3.5,
  meetRangeMax: 9,
  /** How far ahead of the caster the orbs erupt (0 = hip line; negative = behind). */
  emergeAhead: -0.15,
  /** Left/right offset from the aim midline at emerge. */
  lateral: 1.25,
  /** Extra outward bow on flight Bezier control (world units). */
  arcBow: 2.4,
  /** Peak extra height during flight arc. */
  flightArcY: 1.85,
  /** XZ hit radius while orbs are in flight (after launch). */
  flightHitRadius: 0.7,
  blastRadius: 2.5,
  /** Visual blast overshoot so soft crater edges still cover the hit disc. */
  blastVfxMul: 1.45,
  cooldownMs: 7000,
  unlockCostEssence: 100,
} as const;

function magmaOrbsFrameWallMs(frame: number): number {
  return (
    (frame / MAGMA_ORBS_CAST.fps / MAGMA_ORBS_CAST.playbackRate) * 1000
  );
}

/**
 * Meet distance from cursor ground aim, clamped to [meetRangeMin, meetRangeMax].
 * Degenerate / missing aim falls back to the mid default.
 */
export function resolveMagmaOrbsMeetRange(
  owner: { x: number; z: number },
  aim?: { x: number; z: number } | null,
): number {
  const min = MAGMA_ORBS_CAST.meetRangeMin;
  const max = MAGMA_ORBS_CAST.meetRangeMax;
  if (
    !aim ||
    !Number.isFinite(aim.x) ||
    !Number.isFinite(aim.z)
  ) {
    return MAGMA_ORBS_CAST.meetRange;
  }
  const dist = Math.hypot(aim.x - owner.x, aim.z - owner.z);
  if (dist < 0.05) return min;
  return Math.min(max, Math.max(min, dist));
}

function magmaOrbsEmergeWallMs(): number {
  return magmaOrbsFrameWallMs(MAGMA_ORBS_CAST.emergeFrame);
}

function magmaOrbsLaunchWallMs(): number {
  return magmaOrbsFrameWallMs(MAGMA_ORBS_CAST.launchFrame);
}

function magmaOrbsExplodeWallMs(): number {
  return magmaOrbsFrameWallMs(MAGMA_ORBS_CAST.explodeFrame);
}

function magmaOrbsRecoveryWallMs(): number {
  return 450;
}

/**
 * Spirit Form (Space) — Yone-style unbound: leave husk, haste as spirit, snap back.
 */
export const SPIRIT_FORM_CAST = {
  formMs: 3500,
  hasteMoveMul: 1.35,
  /** Player nudge forward on split (world units). */
  splitForward: 1.2,
  /** Husk nudge backward on split (world units). */
  huskBack: 0.8,
  snapIframeMs: 120,
  /** Return dash speed (world units / second). */
  snapReturnSpeed: 70,
  snapReturnMinMs: 45,
  snapReturnMaxMs: 140,
  cooldownMs: 11000,
  unlockCostEssence: 100,
  /** Ground timer ring radius. */
  timerRingRadius: 0.55,
  /** Husk↔spirit tether hit radius (enemies crossing the link). */
  linkHitRadius: 0.18,
  /** Stun applied once per target when they touch the link. */
  linkStunMs: 700,
} as const;

/**
 * Hand Shield (RMB) — channel a frontal blue disc that shatters projectiles.
 * Anims: Standing Block Start → Idle (loop) → End.
 */
export const HAND_SHIELD_CAST = {
  /** Projectile-block channel once the shield is up. */
  channelMs: 3500,
  /** Standing Block Start natural length (sec). */
  startClipSec: 0.533,
  /** Standing Block Idle natural length (sec). */
  idleClipSec: 2.8,
  /** Standing Block End natural length (sec). */
  endClipSec: 1.333,
  /** Recovery wall time — End clip is compressed into this. */
  recoveryMs: 450,
  /** Disc center distance ahead of the caster (world units). */
  shieldForward: 0.22,
  /** Disc radius that catches inbound projectiles. */
  shieldRadius: 0.7,
  cooldownMs: 7000,
  unlockCostEssence: 100,
  /** Move mul while raising / holding the shield. */
  channelMoveMul: 0.55,
  /** Max turn rate while shielding (~63°/s) — slow aim, still steerable. */
  yawTurnRate: 1.1,
} as const;

/** Status + collider duration: channel hold through Block End recovery. */
export const HAND_SHIELD_ARMED_MS =
  HAND_SHIELD_CAST.channelMs + HAND_SHIELD_CAST.recoveryMs;

function spikesReleaseWallMs(): number {
  return (
    (SPIKES_CAST.releaseFrame / SPIKES_CAST.fps / SPIKES_CAST.playbackRate) * 1000
  );
}

function firewallReleaseWallMs(): number {
  return (
    (FIREWALL_CAST.releaseFrame /
      FIREWALL_CAST.fps /
      FIREWALL_CAST.playbackRate) *
    1000
  );
}

function firewallRecoveryWallMs(): number {
  /** Soft settle after the wall appears (clip continues in the background). */
  return 420;
}

function poisonCloudReleaseWallMs(): number {
  return (
    (POISON_CLOUD_CAST.releaseFrame /
      POISON_CLOUD_CAST.fps /
      POISON_CLOUD_CAST.playbackRate) *
    1000
  );
}

function poisonCloudRecoveryWallMs(): number {
  return POISON_CLOUD_CAST.recoveryMs;
}

function smokeBombReleaseWallMs(): number {
  return (
    (SMOKE_BOMB_CAST.releaseFrame /
      SMOKE_BOMB_CAST.fps /
      SMOKE_BOMB_CAST.playbackRate) *
    1000
  );
}

function smokeBombRecoveryWallMs(): number {
  return SMOKE_BOMB_CAST.recoveryMs;
}

function holyGroundReleaseWallMs(): number {
  return (
    (HOLY_GROUND_CAST.releaseFrame /
      HOLY_GROUND_CAST.fps /
      HOLY_GROUND_CAST.playbackRate) *
    1000
  );
}

function holyGroundRecoveryWallMs(): number {
  return HOLY_GROUND_CAST.recoveryMs;
}

function volcanoReleaseWallMs(): number {
  return (
    (VOLCANO_CAST.releaseFrame /
      VOLCANO_CAST.fps /
      VOLCANO_CAST.playbackRate) *
    1000
  );
}

function volcanoRecoveryWallMs(): number {
  return firewallRecoveryWallMs();
}

function protectionBubbleReleaseWallMs(): number {
  return (
    (PROTECTION_BUBBLE_CAST.releaseFrame /
      PROTECTION_BUBBLE_CAST.fps /
      PROTECTION_BUBBLE_CAST.playbackRate) *
    1000
  );
}

function protectionBubbleRecoveryWallMs(): number {
  return 420;
}

/**
 * Blood Rush (F) — crouch charge then ultra-fast low sprint.
 * Clips: Standing To Crouched (~0.67s), Crouched To Sprinting (~0.53s).
 */
export const BLOOD_RUSH_CAST = {
  /** Wall-clock crouch before auto-dash. */
  chargeMs: 1000,
  /** Translate window (wall) — very fast. */
  travelMs: 140,
  recoveryMs: 200,
  range: 9,
  /** Small contact hit before bleed. */
  damage: combatMag(6),
  /** Sweep radius along the path. */
  hitRadius: 0.75,
  /** Execute (remaining HP) when target is at/below this fraction. */
  executeBelowHpFrac: 0.2,
  unlockCostEssence: 100,
  cooldownMs: 20000,
} as const;

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

/**
 * Standing 2H Magic Attack 04 (hero.glb) @ 30fps — clip 101 frames (~3.367s).
 * Frame 32 = heal beam begins.
 */
export const HEAL_BEAM_CAST = {
  fps: 30,
  releaseFrame: 32,
  /** Freeze upper cast here while the beam channel ticks. */
  holdFrame: 48,
  clipDurationSec: 3.366667,
  /** Slight compress so frame 32 arrives a bit sooner. */
  playbackRate: 1.15,
  healPerTick: combatMag(7),
  healTicks: 8,
  /** 8 × 200ms ≈ 1.6s beam. */
  healTickMs: 200,
  /** Narrow line (≈8° half-angle). */
  beamHalfAngle: 0.14,
  range: 14,
} as const;

function healBeamReleaseWallMs(): number {
  return (
    (HEAL_BEAM_CAST.releaseFrame / HEAL_BEAM_CAST.fps / HEAL_BEAM_CAST.playbackRate) *
    1000
  );
}

/**
 * Fireball (F alt) — single clip `Casting Spell` (hero.glb, ~7.733s @ 30fps).
 * Charge scales linearly from appear → release. Early confirm seeks to the throw
 * frames, then the projectile waits until the release frame leaves the hands.
 * Frame 34 = ball appears, 143 = throw seek, 160 = leaves the hands.
 */
export const FIREBALL_CAST = {
  fps: 30,
  appearFrame: 34,
  /** On early confirm, jump Casting Spell here so the throw reads. */
  throwSeekFrame: 143,
  /** Projectile leaves the hands / auto-release at full linear charge. */
  releaseFrame: 160,
  /**
   * After the ball leaves, play the rest of Casting Spell this much faster.
   * Recovery length uses this so gameplay unlocks with the sped-up pose.
   */
  followThroughTimeScale: 2.5,
  /** Cut the clip here (skip the long end settle). */
  followThroughEndFrame: 188,
  /** Casting Spell duration from hero.glb. */
  clipDurationSec: 7.7333,
  /** Slightly faster windup + charge (anim + cast lock track this). */
  playbackRate: 1.2,
  speed: 17,
  /** Practically unlimited flight (wall / enemy ends it). */
  range: 90,
  /**
   * Forward distance used by createProjectile before stamp repositions.
   * Keep in sync with handPush — stamp rewrites to handPush + handSide.
   */
  spawnOffset: 0.22,
  /** Forward from right hand (small — ball sits beside the body). */
  handPush: 0.22,
  /** Out along the caster's left so the ball clears the torso mesh. */
  handSide: -0.42,
  handY: 1.15,
  /** Earliest confirm after the ball appears (channel start). */
  chargeMinMs: 350,
  /**
   * Flight contact radius fallback (stamp scales with charge via radiusMin/Max).
   * Keep below explode/burn size so charge size doesn't spawn-detonate.
   */
  flightHitRadius: 0.55,
  flightWallRadius: 0.48,
  /** Ignore collisions briefly after spawn so the throw clears the caster. */
  spawnArmingMs: 90,
  radiusMin: 0.38,
  radiusMax: 0.95,
  damageMin: combatMag(14),
  damageMax: combatMag(38),
  burnRadiusMin: 1.5,
  burnRadiusMax: 3.4,
  burnDurationMs: 1680,
  burnTickMs: 500,
  unlockCostEssence: 120,
  cooldownMs: 20000,
} as const;

export function fireballFrameWallMs(frame: number): number {
  return (frame / FIREBALL_CAST.fps / FIREBALL_CAST.playbackRate) * 1000;
}

/** Windup until the ball appears (frames 0–appear). */
export function fireballAppearWallMs(): number {
  return fireballFrameWallMs(FIREBALL_CAST.appearFrame);
}

/**
 * Linear charge window: appear → release (no plateau / grace at "max").
 * Charge 0 at channel start, 1 at auto-throw.
 */
export function fireballChargeWindowWallMs(): number {
  return fireballFrameWallMs(
    FIREBALL_CAST.releaseFrame - FIREBALL_CAST.appearFrame,
  );
}

/** @deprecated No grace — linear charge ends at release. Kept as 0 for callers. */
export function fireballChargeGraceWallMs(): number {
  return 0;
}

/** Full cast until the ball leaves (frames 0–release). */
export function fireballReleaseWallMs(): number {
  return fireballFrameWallMs(FIREBALL_CAST.releaseFrame);
}

export function fireballReleaseSec(): number {
  return (
    FIREBALL_CAST.releaseFrame /
    FIREBALL_CAST.fps /
    FIREBALL_CAST.playbackRate
  );
}

export function fireballFollowThroughEndSec(): number {
  return (
    FIREBALL_CAST.followThroughEndFrame /
    FIREBALL_CAST.fps /
    FIREBALL_CAST.playbackRate
  );
}

/** Wall ms for release → followThroughEnd at accelerated playback. */
export function fireballFollowThroughWallMs(): number {
  const frames =
    FIREBALL_CAST.followThroughEndFrame - FIREBALL_CAST.releaseFrame;
  return (
    fireballFrameWallMs(Math.max(0, frames)) /
    Math.max(0.1, FIREBALL_CAST.followThroughTimeScale)
  );
}

/** Follow-through after the ball leaves (sped-up, trimmed). */
export function fireballRecoveryWallMs(): number {
  return Math.max(120, fireballFollowThroughWallMs());
}

export function fireballThrowSeekSec(): number {
  return (
    FIREBALL_CAST.throwSeekFrame /
    FIREBALL_CAST.fps /
    FIREBALL_CAST.playbackRate
  );
}

/** Wall ms from throw seek → ball leaves the hands (early-confirm spawn delay). */
export function fireballThrowToReleaseWallMs(): number {
  return fireballFrameWallMs(
    FIREBALL_CAST.releaseFrame - FIREBALL_CAST.throwSeekFrame,
  );
}

/**
 * Approx Casting Spell frame from channel elapsed (channel starts at appear).
 * Used to delay projectile spawn until the release pose.
 */
export function fireballApproxClipFrame(elapsedMs: number): number {
  return (
    FIREBALL_CAST.appearFrame +
    (Math.max(0, elapsedMs) / 1000) *
      FIREBALL_CAST.fps *
      FIREBALL_CAST.playbackRate
  );
}

/**
 * Delay from confirm → projectile spawn so the ball leaves on the release frame.
 * Early confirms seek to throwSeek first; late/full charge may already be near release.
 */
export function fireballLaunchDelayWallMs(elapsedMs: number): number {
  const approx = fireballApproxClipFrame(elapsedMs);
  const fromFrame = Math.max(approx, FIREBALL_CAST.throwSeekFrame);
  return Math.max(
    0,
    fireballFrameWallMs(FIREBALL_CAST.releaseFrame - fromFrame),
  );
}

/**
 * Recovery after confirm: wait for launch (if early), then sped-up trimmed follow-through.
 */
export function fireballConfirmRecoveryWallMs(elapsedMs: number): number {
  return Math.max(
    120,
    fireballLaunchDelayWallMs(elapsedMs) + fireballFollowThroughWallMs(),
  );
}

export function fireballLerp(min: number, max: number, charge01: number): number {
  const t = Math.max(0, Math.min(1, charge01));
  return min + (max - min) * t;
}

/** Linear 0..1 over appear→release channel elapsed. */
export function fireballCharge01(elapsedMs: number): number {
  return Math.max(
    0,
    Math.min(1, elapsedMs / Math.max(1, fireballChargeWindowWallMs())),
  );
}

function healBeamChannelWallMs(): number {
  return HEAL_BEAM_CAST.healTicks * HEAL_BEAM_CAST.healTickMs;
}

/**
 * Life Leech (LMB) — Standing 2H Magic Attack 03 (hero.glb) @ 30fps.
 * Frame 34 = beam begins (same windup as Frost Mist).
 */
export const LIFE_LEECH_CAST = {
  fps: 30,
  releaseFrame: 34,
  /** Freeze upper cast here while the leech beam channels. */
  holdFrame: 58,
  clipDurationSec: 4.333333,
  playbackRate: 1.55,
  /** Flat damage per tick (combatMag → 40). */
  damagePerTick: combatMag(4),
  /** Fraction of damage dealt restored as self-heal. */
  healFrac: 0.4,
  damageTicks: 8,
  /** Gap between drain ticks while held. */
  tickMs: 400,
  /**
   * Safety cap for the hold channel (wall ms). Normal end is player release.
   * Authored value — scaled by CAST_EXECUTION_SCALE via timing.impactMs.
   */
  holdMaxMs: 120_000,
  /** Narrow short-range laser (≈8° half-angle). */
  beamHalfAngle: 0.14,
  range: 7.5,
} as const;

function lifeLeechReleaseWallMs(): number {
  return (
    (LIFE_LEECH_CAST.releaseFrame / LIFE_LEECH_CAST.fps / LIFE_LEECH_CAST.playbackRate) *
    1000
  );
}

function lifeLeechChannelWallMs(): number {
  return LIFE_LEECH_CAST.holdMaxMs;
}

/**
 * Jazz Dancing (hero.glb) — full-body Groove heal channel.
 * Clip ~2.77s loops while the heal aura stays up.
 */
export const GROOVE_CAST = {
  fps: 30,
  clipDurationSec: 2.766667,
  /** Heal pulses while channeling. */
  healTicks: 12,
  healPerTick: combatMag(8),
  /** Gap between heal ticks (12 × 550ms = 6.6s channel). */
  healTickMs: 550,
  /** Heal aura / dance channel wall time. */
  channelMs: 12 * 550,
  /** Solo pulse (nobody healed): absorb shield granted each tick. */
  soloShieldPerTick: combatMag(4),
  soloShieldDurationMs: 8000,
  anticipationMs: 120,
  castMs: 180,
  recoveryMs: 140,
} as const;

/** Authored ms that yield `wallMs` after CAST_EXECUTION_SCALE. */
function authoredForWallMs(wallMs: number): number {
  return wallMs / CAST_EXECUTION_SCALE;
}

/**
 * Revenge (Q) — Counter stance, then instant blink behind the attacker.
 * Character vanishes for `vanishMs`, then reappears at the landing spot.
 */
export const REVENGE_CAST = {
  /** Rooted deny window (matches Counter). */
  armedMs: 1200,
  /** How far behind the attacker to land. */
  behindDist: 1.45,
  /** Invisible window after the instant teleport (reappear after this). */
  vanishMs: 500,
} as const;

/** Minimal v0 kit — one ability per Battlerite slot. */
export const ABILITIES: Record<string, AbilityDef> = {
  /**
   * Bolt (LMB) — magic_1h (Standing 1H Magic Attack 01).
   * Projectile leaves at frame 26 (arm punch peak), at BOLT_CAST.playbackRate.
   */
  bolt: {
    id: "bolt",
    name: "Bolt",
    description: "Fast single-target magic bolt. Low cooldown primary poke.",
    cooldownMs: 300,
    range: 12,
    shape: "projectile",
    effectKind: "standard",
    tags: ["Projectile", "Damage", "SingleTarget", "Cast"],
    damage: combatMag(11),
    speed: 22,
    spawnOffset: BOLT_CAST.spawnOffset,
    allowedSlots: ["m1"],
    defaultSlot: "m1",
    timing: {
      anticipationMs: authoredForWallMs(80),
      castMs: authoredForWallMs(Math.max(16, boltReleaseWallMs() - 80)),
      impactMs: authoredForWallMs(80),
      recoveryMs: authoredForWallMs(boltRecoveryWallMs()),
      anticipationMoveMul: 0.75,
      castMoveMul: 0.65,
      impactMoveMul: 0.7,
      recoveryMoveMul: 0.95,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
  },
  /**
   * Spore Shrooms (LMB) — plant a growing mushroom at ground aim.
   * Ally step → rejuvenation AoE. Enemy step → poison AoE.
   * Anim: Standing 1H Cast Spell 01 — emerges @ 18, armed @ 36.
   */
  shrooms: {
    id: "shrooms",
    unlockCostEssence: SHROOM_CAST.unlockCostEssence,
    name: "Spore Shrooms",
    description:
      "Plant up to 3 mushrooms (oldest sinks when you plant another). They grow through three stages. An ally who steps on one gains rejuvenation (stacks = stage); an enemy step bursts a poison cloud.",
    cooldownMs: SHROOM_CAST.cooldownMs,
    range: SHROOM_CAST.range,
    shape: "aoe",
    effectKind: "shrooms",
    tags: [
      "Area",
      "GroundEffect",
      "Trap",
      "Healing",
      "HealOverTime",
      "DamageOverTime",
      "Debuff",
      "Ally",
      "Persistent",
      "Cast",
    ],
    damage: SHROOM_CAST.explodeDamage,
    radius: SHROOM_CAST.triggerRadius,
    zoneDurationMs: SHROOM_CAST.maxLifeMs,
    allowedSlots: ["m1"],
    timing: {
      anticipationMs: authoredForWallMs(shroomSpawnWallMs()),
      castMs: authoredForWallMs(
        Math.max(16, shroomEffectiveWallMs() - shroomSpawnWallMs()),
      ),
      impactMs: authoredForWallMs(100),
      recoveryMs: authoredForWallMs(shroomRecoveryWallMs()),
      anticipationMoveMul: 0.75,
      castMoveMul: 0.65,
      impactMoveMul: 0.7,
      recoveryMoveMul: 0.95,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
  },
  /**
   * Ice Lance (LMB alt) — Baseball Pitching. Spike appears at frame 24, thrown
   * at 64. Sticks on hit (direct impact), or drops on miss; explodes after 1.4s
   * for a second non-direct blast.
   */
  iceLance: {
    id: "iceLance",
    unlockCostEssence: 80,
    name: "Ice Lance",
    description:
      "Hurl an ice spike. Direct impact sticks it to the target; after 1.4 seconds it detonates for a frost blast. Misses plant in the ground and explode the same way.",
    cooldownMs: 750,
    range: 14,
    shape: "projectile",
    effectKind: "standard",
    tags: ["Projectile", "Damage", "SingleTarget", "Explosion", "Area", "Cast"],
    damage: combatMag(12),
    speed: 28,
    radius: 0.4,
    spawnOffset: ICE_LANCE_CAST.spawnOffset,
    detonate: {
      delayMs: 1400,
      damage: combatMag(10),
      radius: 2.0,
    },
    allowedSlots: ["m1"],
    defaultSlot: "m1",
    timing: {
      anticipationMs: authoredForWallMs(iceLanceSpawnWallMs()),
      castMs: authoredForWallMs(iceLanceReleaseWallMs() - iceLanceSpawnWallMs()),
      impactMs: authoredForWallMs(80),
      recoveryMs: authoredForWallMs(iceLanceRecoveryWallMs()),
      anticipationMoveMul: 0.75,
      castMoveMul: 0.65,
      impactMoveMul: 0.7,
      recoveryMoveMul: 0.95,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
  },
  /** Close-range magical slash — 3 quick hits, then CD (or CD if chain stops early). */
  crescent: {
    id: "crescent",
    unlockCostEssence: 80,
    name: "Crescent",
    description:
      "Close-range slash combo — three quick hits. Chain swings or stop early to start cooldown.",
    cooldownMs: 550,
    range: 2.2,
    shape: "melee",
    effectKind: "standard",
    tags: ["Melee", "Damage", "MultiHit", "Combo", "Instant"],
    damage: combatMag(11),
    /** Tight frontal slash — was 2.0 and felt like a wide AoE. */
    radius: 1.15,
    allowedSlots: ["m1"],
    defaultSlot: "m1",
    combo: {
      hits: 3,
      continueWindowMs: 220,
      moveMul: 0.65,
      damageByHit: [combatMag(7), combatMag(7), combatMag(11)],
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
    name: "Jump Slam",
    description:
      "Leap to your aim and slam the ground. Airborne iframes; stuns enemies on landing.",
    cooldownMs: 7000,
    range: 4.0,
    shape: "aoe",
    effectKind: "standard",
    tags: ["Area", "Damage", "Movement", "Stun", "Control", "Cast"],
    damage: combatMag(12),
    radius: 2.2,
    allowedSlots: ["m2"],
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
      distance: 4.0,
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
    unlockCostEssence: 100,
    name: "Frost Ball",
    description:
      "Slow drifting frost orb with a ground aura. Ticks damage and refreshes slow on anyone standing in the disc until it expires.",
    cooldownMs: 7000,
    range: 12.5,
    shape: "projectile",
    effectKind: "standard",
    tags: ["Projectile", "Area", "Damage", "DamageOverTime", "Debuff", "GroundEffect", "Persistent", "Cast"],
    damage: combatMag(3),
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
      anticipationMoveMul: 0.65,
      castMoveMul: 0.55,
      impactMoveMul: 0.5,
      recoveryMoveMul: 0.85,
      canCancelAnticipation: true,
      /** Cancel through windup until the ball spawns at impact. */
      cancelUntilPhase: "cast",
    },
    applyAuraSlow: [{ statusId: "slowed", durationMs: 1200, chance: 1 }],
  },
  /**
   * Poison Dart (RMB) — fast Right Hook throw.
   * combatMag(4) hit + poison stacks (shared DoT).
   */
  poisonDart: {
    id: "poisonDart",
    unlockCostEssence: 80,
    name: "Poison Dart",
    description:
      "Snap a venomous dart with a right hook. Light impact, then Poisoned (stacks up to 3, shared with Spikes).",
    cooldownMs: 4500,
    range: 11,
    shape: "projectile",
    effectKind: "standard",
    tags: ["Projectile", "Damage", "DamageOverTime", "Debuff", "SingleTarget", "Cast"],
    damage: combatMag(4),
    speed: 28,
    spawnOffset: POISON_DART_CAST.spawnOffset,
    allowedSlots: ["m2"],
    timing: {
      /** Windup to original frame 11 (~367ms wall). */
      anticipationMs: authoredForWallMs(50),
      castMs: authoredForWallMs(Math.max(16, poisonDartReleaseWallMs() - 50)),
      impactMs: authoredForWallMs(80),
      recoveryMs: authoredForWallMs(poisonDartRecoveryWallMs()),
      anticipationMoveMul: 0.75,
      castMoveMul: 0.65,
      impactMoveMul: 0.7,
      recoveryMoveMul: 0.95,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "poisoned", chance: 1 }],
  },
  /**
   * Magma Orbs (RMB) — twin fireballs erupt, rise, then arc to a cursor-ranged
   * meet point (clamped) and explode. Prep slows movement but does not root.
   */
  magmaOrbs: {
    id: "magmaOrbs",
    unlockCostEssence: MAGMA_ORBS_CAST.unlockCostEssence,
    name: "Magma Orbs",
    description:
      "Smash the earth and raise two magma orbs. They loft, then swing on curved paths to your cursor (within range) — stopped by walls, enemies clipped in flight catch fire. One orb reaching the meet point deals a half blast; both colliding deals full damage.",
    cooldownMs: MAGMA_ORBS_CAST.cooldownMs,
    /** Max meet distance (cursor aim clamped to min..max). */
    range: MAGMA_ORBS_CAST.meetRangeMax,
    shape: "aoe",
    effectKind: "magmaOrbs",
    tags: ["Projectile", "Explosion", "Area", "Damage", "Debuff", "Cast"],
    damage: combatMag(26),
    radius: MAGMA_ORBS_CAST.blastRadius,
    allowedSlots: ["m2"],
    timing: {
      anticipationMs: authoredForWallMs(magmaOrbsEmergeWallMs()),
      castMs: authoredForWallMs(
        Math.max(16, magmaOrbsLaunchWallMs() - magmaOrbsEmergeWallMs()),
      ),
      impactMs: authoredForWallMs(
        Math.max(16, magmaOrbsExplodeWallMs() - magmaOrbsLaunchWallMs()),
      ),
      recoveryMs: authoredForWallMs(magmaOrbsRecoveryWallMs()),
      /** Prep slows — never roots. */
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      /** Locked once the orbs launch. */
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "burning", chance: 1 }],
  },
  /**
   * Electrical augment (Space) — short cast, then +60% move for 3s.
   * Listed before dash so it is the default Space loadout pick.
   */
  surge: {
    id: "surge",
    name: "Surge",
    description: "Crackling self-buff — burst of move speed. Can interrupt your other casts.",
    cooldownMs: 10000,
    range: 0,
    shape: "buff",
    effectKind: "standard",
    tags: ["Buff", "Self", "Movement", "Instant"],
    damage: 0,
    allowedSlots: ["space"],
    defaultSlot: "space",
    timing: {
      anticipationMs: 70,
      castMs: 90,
      impactMs: 60,
      recoveryMs: 100,
      anticipationMoveMul: 0.75,
      castMoveMul: 0.65,
      impactMoveMul: 0.7,
      recoveryMoveMul: 0.95,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnSelf: [{ statusId: "surged", durationMs: 3000 }],
    interruptsOtherCasts: true,
  },
  /**
   * Spirit Form (Space) — leave a husk, surge forward as spirit with haste.
   * Recast or timer snaps you back to the husk.
   */
  spiritForm: {
    id: "spiritForm",
    unlockCostEssence: SPIRIT_FORM_CAST.unlockCostEssence,
    name: "Spirit Form",
    description:
      "Split from your body — leave a husk behind and rush forward as a spirit with bonus move speed. The link between you and your husk stuns enemies that pass through it. Recast Space or wait for the timer to snap back to your husk.",
    cooldownMs: SPIRIT_FORM_CAST.cooldownMs,
    range: SPIRIT_FORM_CAST.splitForward,
    shape: "buff",
    effectKind: "spiritForm",
    tags: ["Movement", "Haste", "Buff", "Self", "Blink", "Dash", "CrowdControl"],
    damage: 0,
    allowedSlots: ["space"],
    timing: {
      anticipationMs: 40,
      castMs: 80,
      impactMs: 120,
      recoveryMs: 100,
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    /** Small forward nudge on split (matches server commitSpiritForm). */
    travel: {
      mode: "translate",
      distance: SPIRIT_FORM_CAST.splitForward,
      durationMs: 100,
    },
    applyOnSelf: [
      {
        statusId: "spiritFormed",
        durationMs: SPIRIT_FORM_CAST.formMs,
      },
    ],
    iFrames: {
      startMs: 0,
      durationMs: SPIRIT_FORM_CAST.snapIframeMs,
    },
    interruptsOtherCasts: true,
  },
  /**
   * Rift Fissure (Space) — plant two linked walk-through portals.
   * Anim: Standing 1H Cast Spell 01. CD starts on first plant; 5s to place the second.
   */
  riftFissure: {
    id: "riftFissure",
    unlockCostEssence: RIFT_FISSURE_CAST.unlockCostEssence,
    name: "Rift Fissure",
    description:
      "Tear open a rift in front of you, then a second within 5 seconds. Walking into either portal exits the other — allies and enemies alike. Portals stay open for 10 seconds.",
    cooldownMs: RIFT_FISSURE_CAST.cooldownMs,
    range: RIFT_FISSURE_CAST.placeForward,
    shape: "aoe",
    effectKind: "riftFissure",
    tags: ["Blink", "Area", "GroundEffect", "Persistent", "Cast", "Movement"],
    damage: 0,
    radius: RIFT_FISSURE_CAST.mouthRadius,
    zoneDurationMs: RIFT_FISSURE_CAST.pairDurationMs,
    allowedSlots: ["space"],
    timing: {
      anticipationMs: authoredForWallMs(80),
      castMs: authoredForWallMs(Math.max(16, riftFissureReleaseWallMs() - 80)),
      impactMs: authoredForWallMs(120),
      recoveryMs: authoredForWallMs(riftFissureRecoveryWallMs()),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    interruptsOtherCasts: true,
  },
  /**
   * Hand Shield (RMB) — raise a blue disc in front of your hand.
   * Blocks projectiles for 3.5s. Cancel anytime. Standing Block Start/Idle/End.
   */
  handShield: {
    id: "handShield",
    unlockCostEssence: HAND_SHIELD_CAST.unlockCostEssence,
    name: "Hand Shield",
    description:
      "Raise a blue shield in front of your hand. Enemy projectiles that hit the disc shatter. Channel for 3.5s — cancel anytime. Blocks through the drop animation.",
    cooldownMs: HAND_SHIELD_CAST.cooldownMs,
    range: 0,
    shape: "buff",
    effectKind: "standard",
    tags: ["Channel", "Defense", "Barrier", "Self", "Cast"],
    damage: 0,
    allowedSlots: ["m2"],
    timing: {
      anticipationMs: 100,
      castMs: Math.max(
        16,
        Math.round(HAND_SHIELD_CAST.startClipSec * 1000) - 100,
      ),
      impactMs: HAND_SHIELD_CAST.channelMs,
      recoveryMs: HAND_SHIELD_CAST.recoveryMs,
      anticipationMoveMul: HAND_SHIELD_CAST.channelMoveMul,
      castMoveMul: HAND_SHIELD_CAST.channelMoveMul,
      impactMoveMul: HAND_SHIELD_CAST.channelMoveMul,
      recoveryMoveMul: 0.85,
      canCancelAnticipation: true,
      /** Cancel allowed through the whole hold. */
      cancelUntilPhase: "impact",
    },
    /** Only player cancel / stun ends the channel — Surge/Dash cannot cut it. */
    interruptible: false,
    /**
     * Armed on channel start — stays through Block End recovery
     * (`HAND_SHIELD_ARMED_MS`) so the disappear anim still blocks.
     */
  },
  /**
   * Barrier — short cast, blue absorb bubble (combatMag(40) HP / 3s).
   * Anim: Standing 1H Cast Spell 01.
   */
  barrier: {
    id: "barrier",
    name: "Barrier",
    description:
      `Locked cast — absorb bubble charges to ${combatMag(40)} shield over the windup (3s once complete). Damage during cast only eats what you've built so far.`,
    cooldownMs: 14000,
    range: 0,
    shape: "buff",
    effectKind: "standard",
    tags: ["Buff", "Self", "Defense", "Shield", "Cast"],
    damage: 0,
    allowedSlots: ["r"],
    defaultSlot: "r",
    timing: {
      anticipationMs: authoredForWallMs(90),
      castMs: authoredForWallMs(Math.max(16, barrierReleaseWallMs() - 90)),
      impactMs: authoredForWallMs(100),
      recoveryMs: authoredForWallMs(barrierRecoveryWallMs()),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      /** Locked cast — no cancel through windup/release. */
      canCancelAnticipation: false,
    },
    /** Surge/Dash/etc. cannot cut this cast. */
    interruptible: false,
    /**
     * Absorb ramps 0→combatMag(40) during anticipation+cast (server PendingBarrier).
     * applyOnSelf is unused — CombatSystem owns the charge so mid-cast damage
     * only eats what has been built so far.
     */
  },
  /**
   * Counter (Q) — Female Dance Pose, rooted 1.2s. Cancel anytime.
   * Next melee / direct projectile hit is denied → +20% move, +20% dmg, 40% resist for 3s.
   * Ground AoE (smash, gust, spikes, mist…) does not trigger; crescent does.
   */
  counter: {
    id: "counter",
    name: "Counter",
    description:
      "Plant into a dance stance and glow for 1.2s (no movement). Cancel anytime. The next direct hit (melee or projectile — not ground AoE) is denied, then you gain +20% move speed, +20% damage, and 40% damage resistance for 3s.",
    cooldownMs: 12000,
    range: 0,
    shape: "buff",
    effectKind: "standard",
    tags: ["Buff", "Self", "Defense", "Counter", "Channel"],
    damage: 0,
    allowedSlots: ["q"],
    defaultSlot: "q",
    timing: {
      /** Windup + hold = 1.2s rooted counter window. */
      anticipationMs: 40,
      castMs: 60,
      impactMs: 1100,
      recoveryMs: 80,
      anticipationMoveMul: 0,
      castMoveMul: 0,
      impactMoveMul: 0,
      recoveryMoveMul: 1,
      canCancelAnticipation: true,
      /** Cancel allowed through the whole hold. */
      cancelUntilPhase: "impact",
    },
    /** Only player cancel (or a successful counter) ends the stance — Surge/Dash cannot cut it. */
    interruptible: false,
    /** Q cuts whatever you're casting (including channels), then opens Counter. */
    interruptsOtherCasts: true,
    cutsAnyCast: true,
    /**
     * Armed at cast begin (CombatSystem) so root + glow start immediately.
     * applyOnSelf unused for the window itself.
     */
  },
  /**
   * Revenge (Q) — same stance window as Counter, red glow.
   * On deny: teleport behind the attacker. No riposte buffs (for now).
   */
  revenge: {
    id: "revenge",
    unlockCostEssence: 100,
    name: "Revenge",
    description:
      "Plant into a dance stance and glow red for 1.2s (no movement). Cancel anytime. The next direct hit (melee or projectile — not ground AoE) is denied — you vanish, blink behind the attacker, then reappear.",
    cooldownMs: 12000,
    range: 0,
    shape: "buff",
    effectKind: "standard",
    tags: ["Buff", "Self", "Defense", "Counter", "Channel", "Movement"],
    damage: 0,
    allowedSlots: ["q"],
    timing: {
      anticipationMs: 40,
      castMs: 60,
      impactMs: 1100,
      recoveryMs: 80,
      anticipationMoveMul: 0,
      castMoveMul: 0,
      impactMoveMul: 0,
      recoveryMoveMul: 1,
      canCancelAnticipation: true,
      cancelUntilPhase: "impact",
    },
    interruptible: false,
    interruptsOtherCasts: true,
    cutsAnyCast: true,
  },
  dash: {
    id: "dash",
    unlockCostEssence: 60,
    name: "Dash",
    description: "Dive forward with brief iframes, then a short haste. Cuts other casts.",
    cooldownMs: 10000,
    range: 5,
    shape: "dash",
    effectKind: "standard",
    tags: ["Dash", "Movement", "Defense", "Buff", "Instant"],
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
   * Teleport (Space) — hold to channel a blink. Landing circle pushes out with charge;
   * release confirms. At max range, 1s grace then cancel. CD only on teleport.
   */
  portal: {
    id: "portal",
    unlockCostEssence: 120,
    name: "Teleport",
    description:
      "Hold Space to plant and channel. A landing marker slides farther with charge — release to blink there. At max range you have a second to confirm or the cast cancels. Cooldown starts on any successful blink.",
    cooldownMs: 11000,
    range: 10,
    shape: "dash",
    effectKind: "standard",
    tags: ["Blink", "Channel", "Movement", "Self"],
    damage: 0,
    allowedSlots: ["space"],
    confirmOnRelease: true,
    channelChargeMs: 1000,
    channelCapGraceMs: 1000,
    channelMinRange: 1,
    timing: {
      anticipationMs: 40,
      castMs: 60,
      // Wall: charge + grace (scaled via authoredForWallMs).
      impactMs: authoredForWallMs(1000 + 1000),
      recoveryMs: 120,
      anticipationMoveMul: 0,
      castMoveMul: 0,
      impactMoveMul: 0,
      recoveryMoveMul: 0.85,
      canCancelAnticipation: true,
      cancelUntilPhase: "impact",
    },
    travel: {
      mode: "instant",
      distance: 10,
    },
    iFrames: {
      startMs: 0,
      durationMs: 100,
    },
    interruptible: false,
    interruptsOtherCasts: true,
  },
  /**
   * Decoy (Q) — clone appears instantly (hides the cast), then caster crouches into cloak.
   * Invisible to enemies / ghost to self for 2s; any cast or interact reveals.
   * Still takes damage while cloaked.
   */
  decoy: {
    id: "decoy",
    unlockCostEssence: 100,
    name: "Decoy",
    description:
      "Spawn an identical clone that walks to your aim point (or stands still), then cloak for a short time. Invisible to enemies / ghost to yourself. Casting or interacting reveals you; you can still take damage.",
    cooldownMs: 14000,
    range: 0,
    shape: "buff",
    effectKind: "decoy",
    tags: ["Summon", "Stealth", "Utility", "Self", "Cast"],
    damage: 0,
    allowedSlots: ["q"],
    // Timed to Standing To Crouched (~0.67s @ natural speed).
    timing: {
      anticipationMs: 40,
      castMs: 420,
      impactMs: 100,
      recoveryMs: 180,
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: false,
    },
    applyOnSelf: [{ statusId: "cloaked", durationMs: 2000 }],
  },
  /**
   * Push Back — circular push wave. Equippable on Q.
   * Hits shove targets outward, then slow them briefly.
   */
  gust: {
    id: "gust",
    unlockCostEssence: 80,
    name: "Push Back",
    description:
      "Circular push wave at your feet. Knocks enemies outward, then slows them briefly.",
    cooldownMs: 10000,
    range: 0,
    shape: "aoe",
    effectKind: "standard",
    tags: ["Area", "Nova", "Damage", "Knockback", "Debuff", "Control", "Cast"],
    damage: combatMag(12),
    radius: 5.0,
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
      anticipationMoveMul: 0.65,
      castMoveMul: 0.55,
      impactMoveMul: 0.5,
      recoveryMoveMul: 0.85,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "slowed", durationMs: 1000, chance: 1 }],
  },
  /**
   * Grasp (E) — dark stretching arm / hand yank.
   * Anim: Standing 1H Magic Attack 01.
   */
  grasp: {
    id: "grasp",
    name: "Grasp",
    description:
      "Stretch a dark hand forward and yank an enemy toward you. Light damage, then slows them briefly.",
    cooldownMs: 10000,
    range: 12,
    shape: "projectile",
    effectKind: "standard",
    tags: ["Projectile", "Damage", "Pull", "Debuff", "Control", "SingleTarget", "Cast"],
    damage: combatMag(5),
    speed: 26,
    radius: 0.55,
    spawnOffset: 0.42,
    pull: 8,
    pullMs: 320,
    pullStopDistance: 1.35,
    allowedSlots: ["e"],
    // Timed to Standing 1H Magic Attack 01 (~2.33s) at a snappy combat pace.
    timing: {
      anticipationMs: 260,
      castMs: 180,
      impactMs: 200,
      recoveryMs: 280,
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "slowed", durationMs: 2000, chance: 1 }],
  },
  /**
   * Life Leech (LMB) — short-range drain stream.
   * Anim: Standing 2H Magic Attack 03 — beam starts @ frame 34.
   */
  lifeLeech: {
    id: "lifeLeech",
    unlockCostEssence: 100,
    name: "Life Leech",
    description:
      "Hold to channel a short red–green drain stream. Enemies in the line take damage each tick; you heal for 40% of damage dealt. Release to end — cooldown starts then.",
    cooldownMs: 2000,
    range: LIFE_LEECH_CAST.range,
    shape: "aoe",
    effectKind: "lifeLeech",
    tags: ["Line", "Channel", "Damage", "Healing", "Self", "Cast"],
    damage: LIFE_LEECH_CAST.damagePerTick,
    healTicks: LIFE_LEECH_CAST.damageTicks,
    tickMs: LIFE_LEECH_CAST.tickMs,
    coneHalfAngle: LIFE_LEECH_CAST.beamHalfAngle,
    allowedSlots: ["m1"],
    holdChannel: true,
    timing: {
      anticipationMs: authoredForWallMs(90),
      castMs: authoredForWallMs(Math.max(16, lifeLeechReleaseWallMs() - 90)),
      impactMs: authoredForWallMs(lifeLeechChannelWallMs()),
      recoveryMs: authoredForWallMs(160),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "impact",
    },
    /** Channel — Surge/Dash/etc. cannot cut; release / stun ends it. */
    interruptible: false,
  },
  /**
   * Chain Jump (E) — grasp mirror: hook flies out, then you leap to the foe.
   * Same range/timing/speed as Grasp; roots the target briefly on hit.
   */
  chainJump: {
    id: "chainJump",
    unlockCostEssence: 100,
    name: "Chain Hook",
    description:
      "Fling a chain hook forward. On hit, leap to the enemy and bind them in chains for half a second.",
    cooldownMs: 10000,
    range: 12,
    shape: "projectile",
    effectKind: "standard",
    tags: ["Projectile", "Damage", "Pull", "Dash", "Debuff", "Control", "SingleTarget", "Cast"],
    damage: combatMag(5),
    /** Faster hook than Grasp so the leap feels snappier. */
    speed: 40,
    radius: 0.55,
    spawnOffset: 0.42,
    pull: 8,
    pullMs: 320,
    pullStopDistance: 1.35,
    leapToTarget: true,
    allowedSlots: ["e"],
    // Same cast pacing as Grasp (Standing 1H Magic Attack 01).
    timing: {
      anticipationMs: 260,
      castMs: 180,
      impactMs: 200,
      recoveryMs: 280,
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "chained", durationMs: 500, chance: 1 }],
  },
  /**
   * Spikes (E) — staggered poison needles along the aim line.
   * Anim: Standing 1H Magic Attack 03 — first spike @ frame 30.
   * Applies shared `poisoned` DoT (same status as Poison Dart).
   */
  spikes: {
    id: "spikes",
    unlockCostEssence: 80,
    name: "Spikes",
    description:
      "Venomous spikes erupt from the ground in a fast staggered line. Narrow path, long reach; applies Poisoned (stacks with Poison Dart).",
    cooldownMs: 4000,
    range: 10,
    shape: "aoe",
    effectKind: "spikeWave",
    tags: ["Line", "GroundEffect", "Damage", "DamageOverTime", "Debuff", "MultiHit", "Cast"],
    damage: combatMag(4),
    /** Hit width per spike — keep the corridor tight. */
    radius: 0.55,
    spikeCount: 9,
    spikeStaggerMs: 32,
    spikeStart: 0.85,
    allowedSlots: ["e"],
    defaultSlot: "e",
    timing: {
      anticipationMs: authoredForWallMs(70),
      castMs: authoredForWallMs(Math.max(16, spikesReleaseWallMs() - 70)),
      impactMs: authoredForWallMs(220),
      recoveryMs: authoredForWallMs(140),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "poisoned", chance: 1 }],
  },
  /**
   * Poison Cloud (E) — smash-throw a vial at ground aim (clamped to range).
   * Anim: Standing Melee Attack Downward — vial leaves @ frame 26.
   * Lingering green cloud: stacks Poisoned + 20% Miasma slow while inside (no direct damage).
   */
  poisonCloud: {
    id: "poisonCloud",
    unlockCostEssence: POISON_CLOUD_CAST.unlockCostEssence,
    name: "Poison Cloud",
    description:
      "Hurl a poison vial at your aim. On impact it bursts into a toxic cloud that slows enemies by 20% and stacks Poisoned while they stand in it.",
    cooldownMs: POISON_CLOUD_CAST.cooldownMs,
    range: POISON_CLOUD_CAST.range,
    shape: "aoe",
    effectKind: "poisonCloud",
    tags: [
      "Area",
      "GroundEffect",
      "DamageOverTime",
      "Debuff",
      "Slow",
      "Persistent",
      "Cast",
      "Explosion",
    ],
    /** Status-only zone — shared `poisoned` DoT carries the damage. */
    damage: 0,
    radius: POISON_CLOUD_CAST.radius,
    tickMs: POISON_CLOUD_CAST.tickMs,
    zoneDurationMs: POISON_CLOUD_CAST.zoneDurationMs,
    allowedSlots: ["e"],
    timing: {
      anticipationMs: authoredForWallMs(80),
      castMs: authoredForWallMs(Math.max(16, poisonCloudReleaseWallMs() - 80)),
      impactMs: authoredForWallMs(160),
      recoveryMs: authoredForWallMs(poisonCloudRecoveryWallMs()),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [
      { statusId: "poisoned", chance: 1 },
      { statusId: "poisonMiasma", chance: 1 },
    ],
  },
  /**
   * Silence (E) — Right Hook cursed-shadow arc.
   * Thin blade sweeps right→left across a mid-range cone; silence only (no damage).
   */
  silenceSweep: {
    id: "silenceSweep",
    unlockCostEssence: SILENCE_SWEEP_CAST.unlockCostEssence,
    name: "Silence",
    description:
      "Hook a crescent of cursed shadow across the field in front of you. Enemies caught in the sweep are Silenced — casts interrupt and stay blocked for a few seconds.",
    cooldownMs: SILENCE_SWEEP_CAST.cooldownMs,
    range: SILENCE_SWEEP_CAST.range,
    shape: "aoe",
    effectKind: "silenceSweep",
    tags: ["Cone", "Silence", "Debuff", "Control", "CrowdControl", "Area", "Interrupt", "Cast"],
    damage: 0,
    coneHalfAngle: SILENCE_SWEEP_CAST.coneHalfAngle,
    sweepMs: SILENCE_SWEEP_CAST.sweepMs,
    sweepBladeHalfAngle: SILENCE_SWEEP_CAST.sweepBladeHalfAngle,
    allowedSlots: ["e"],
    timing: {
      anticipationMs: authoredForWallMs(50),
      castMs: authoredForWallMs(Math.max(16, silenceSweepReleaseWallMs() - 50)),
      impactMs: authoredForWallMs(SILENCE_SWEEP_CAST.sweepMs),
      recoveryMs: authoredForWallMs(silenceSweepRecoveryWallMs()),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [
      {
        statusId: "silenced",
        durationMs: SILENCE_SWEEP_CAST.silenceDurationMs,
        chance: 1,
      },
    ],
  },
  /**
   * Smoke Bomb (Q) — smash-plant at your feet (Standing Melee Attack Downward @ frame 28).
   * Grey smoke weakens enemies (−20% defense) while you crouch into cloak.
   */
  smokeBomb: {
    id: "smokeBomb",
    unlockCostEssence: SMOKE_BOMB_CAST.unlockCostEssence,
    name: "Smoke Bomb",
    description:
      "Smash a smoke bomb at your feet. A thick grey cloud weakens enemies (they take 20% more damage). You stay cloaked while you remain in the smoke — leave or cast to reveal.",
    cooldownMs: SMOKE_BOMB_CAST.cooldownMs,
    range: 0,
    shape: "aoe",
    effectKind: "smokeBomb",
    tags: [
      "Area",
      "GroundEffect",
      "Debuff",
      "Stealth",
      "Self",
      "Persistent",
      "Cast",
      "Nova",
    ],
    damage: 0,
    radius: SMOKE_BOMB_CAST.radius,
    tickMs: SMOKE_BOMB_CAST.tickMs,
    zoneDurationMs: SMOKE_BOMB_CAST.zoneDurationMs,
    allowedSlots: ["q"],
    timing: {
      anticipationMs: authoredForWallMs(80),
      castMs: authoredForWallMs(Math.max(16, smokeBombReleaseWallMs() - 80)),
      impactMs: authoredForWallMs(160),
      recoveryMs: authoredForWallMs(smokeBombRecoveryWallMs()),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "weakened", chance: 1 }],
    /** Cloak duration is driven by the live smoke zone (see CombatSystem). */
    applyOnSelf: [{ statusId: "cloaked" }],
  },
  /**
   * Holy Ground (R) — consecrate a circle at your feet.
   * Anim: Standing 2H Magic Area Attack 01 — lands @ frame 42 (cancel before).
   * Allies (and you) standing in it gain +60% resistance and +30% damage.
   */
  holyGround: {
    id: "holyGround",
    unlockCostEssence: HOLY_GROUND_CAST.unlockCostEssence,
    name: "Holy Ground",
    description:
      "Consecrate the ground beneath you. Allies standing in the circle gain 60% damage resistance and deal 30% more damage for as long as they remain inside.",
    cooldownMs: HOLY_GROUND_CAST.cooldownMs,
    range: 0,
    shape: "aoe",
    effectKind: "holyGround",
    tags: [
      "Area",
      "GroundEffect",
      "Buff",
      "Ally",
      "Self",
      "Persistent",
      "Cast",
      "Nova",
    ],
    damage: 0,
    radius: HOLY_GROUND_CAST.radius,
    tickMs: HOLY_GROUND_CAST.tickMs,
    zoneDurationMs: HOLY_GROUND_CAST.zoneDurationMs,
    allowedSlots: ["r"],
    timing: {
      anticipationMs: authoredForWallMs(100),
      castMs: authoredForWallMs(Math.max(16, holyGroundReleaseWallMs() - 100)),
      impactMs: authoredForWallMs(180),
      recoveryMs: authoredForWallMs(holyGroundRecoveryWallMs()),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "holyBlessed", chance: 1 }],
  },
  /**
   * Firewall (R) — stationary fire wall perpendicular to aim.
   * Anim: Standing 2H Magic Area Attack 01 — ignites @ frame 42 (cancel before).
   * Draws from center out to both edges; burns in place for several seconds.
   */
  firewall: {
    id: "firewall",
    unlockCostEssence: 120,
    name: "Firewall",
    description:
      "Crack the earth and raise a wall of flame. Ignites at the climax of the cast — cancel anytime before then. The wall draws from its center to both edges and scorches anyone who stands in it.",
    cooldownMs: 14000,
    /** Full wall length (center → each edge = half). */
    range: 13,
    shape: "aoe",
    effectKind: "firewall",
    tags: ["Line", "GroundEffect", "Area", "Damage", "DamageOverTime", "Debuff", "Persistent", "Cast"],
    /** Damage per zone tick. */
    damage: combatMag(4),
    /** Hit thickness of the wall corridor. */
    radius: 0.9,
    /** Segment count along the wall for hit checks. */
    spikeCount: 15,
    /** Distance in front of caster to the wall midline. */
    spikeStart: 3.2,
    tickMs: FIREWALL_CAST.tickMs,
    zoneDurationMs: FIREWALL_CAST.zoneDurationMs,
    allowedSlots: ["r"],
    timing: {
      anticipationMs: authoredForWallMs(100),
      castMs: authoredForWallMs(Math.max(16, firewallReleaseWallMs() - 100)),
      impactMs: authoredForWallMs(180),
      recoveryMs: authoredForWallMs(firewallRecoveryWallMs()),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      /** Locked once the wall ignites (impact). */
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "burning", chance: 1 }],
  },
  /**
   * Fireball (F alt) — linear charge appear→release; F/LMB throws early.
   * Early confirm seeks Casting Spell to the throw frames (~143).
   */
  fireball: {
    id: "fireball",
    unlockCostEssence: FIREBALL_CAST.unlockCostEssence,
    name: "Fireball",
    description:
      "Gather a fireball (F). Charge grows until release — press F or LMB early to throw a smaller blast, or wait for full power. Explodes on enemies or walls and leaves a burning circle.",
    cooldownMs: FIREBALL_CAST.cooldownMs,
    range: FIREBALL_CAST.range,
    shape: "projectile",
    effectKind: "fireball",
    tags: [
      "Projectile",
      "Explosion",
      "Area",
      "Damage",
      "DamageOverTime",
      "Debuff",
      "GroundEffect",
      "Cast",
      "Channel",
    ],
    damage: FIREBALL_CAST.damageMax,
    speed: FIREBALL_CAST.speed,
    radius: FIREBALL_CAST.radiusMax,
    spawnOffset: FIREBALL_CAST.spawnOffset,
    zoneDurationMs: FIREBALL_CAST.burnDurationMs,
    tickMs: FIREBALL_CAST.burnTickMs,
    /** Near-instant plant fuse — impact damage comes from the detonation blast. */
    detonate: {
      delayMs: 40,
      damage: FIREBALL_CAST.damageMax,
      radius: FIREBALL_CAST.burnRadiusMax,
    },
    allowedSlots: ["f"],
    defaultSlot: "f",
    confirmOnRelease: true,
    /** Linear appear→release; no max-hold grace. */
    channelChargeMs: fireballChargeWindowWallMs(),
    channelCapGraceMs: 0,
    interruptible: false,
    timing: {
      /** Frames 0–appear — windup until the ball shows in the hands. */
      anticipationMs: authoredForWallMs(fireballAppearWallMs()),
      castMs: authoredForWallMs(80),
      /** Linear charge — confirm / auto-release at the end. */
      impactMs: authoredForWallMs(fireballChargeWindowWallMs()),
      recoveryMs: authoredForWallMs(fireballRecoveryWallMs()),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: false,
      cancelUntilPhase: "impact",
    },
    applyOnHit: [{ statusId: "burning", chance: 1 }],
  },
  /**
   * Volcano (F) — place a erupting volcano at ground aim (clamped to range).
   * Anim: Standing 2H Magic Area Attack 01 — erupts @ frame 42 (cancel before).
   * Throws flaming rocks for several seconds; impacts burn.
   */
  volcano: {
    id: "volcano",
    unlockCostEssence: 140,
    name: "Volcano",
    description:
      "Crack the earth at your aim and raise a volcano. It shoves bodies aside as it emerges, burns anyone pressed against it, blocks the ground while active, and rains flaming rocks that shatter on impact and leave foes burning.",
    cooldownMs: 20000,
    /** Max place distance from caster. */
    range: 10,
    shape: "aoe",
    effectKind: "volcano",
    tags: ["Area", "GroundEffect", "Damage", "Debuff", "Persistent", "Cast", "Explosion"],
    /** Damage per rock impact. */
    damage: combatMag(14),
    /** Movement-blocking volcano body radius. */
    radius: VOLCANO_CAST.collideRadius,
    tickMs: VOLCANO_CAST.rockIntervalMs,
    zoneDurationMs: VOLCANO_CAST.zoneDurationMs,
    allowedSlots: ["f"],
    timing: {
      anticipationMs: authoredForWallMs(100),
      castMs: authoredForWallMs(Math.max(16, volcanoReleaseWallMs() - 100)),
      impactMs: authoredForWallMs(180),
      recoveryMs: authoredForWallMs(volcanoRecoveryWallMs()),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    applyOnHit: [{ statusId: "burning", chance: 1 }],
  },
  /**
   * Protection Bubble (F) — locked cast, dome at cast origin.
   * Blocks inbound projectiles; outbound casts from inside still leave.
   * Anim: Standing 2H Magic Area Attack 02 (01 fallback in hero.glb).
   */
  protectionBubble: {
    id: "protectionBubble",
    unlockCostEssence: PROTECTION_BUBBLE_CAST.unlockCostEssence,
    name: "Protection Bubble",
    description:
      "Weave a large dome at your feet. While it stands, enemy projectiles shatter on the outside and you and allies inside gain absorb over time — you can still cast out from within. Locked cast; the shield forms where you started the spell.",
    cooldownMs: PROTECTION_BUBBLE_CAST.cooldownMs,
    range: 0,
    shape: "aoe",
    effectKind: "protectionBubble",
    tags: ["Area", "Defense", "Barrier", "Persistent", "Cast", "Self", "Ally"],
    damage: 0,
    radius: PROTECTION_BUBBLE_CAST.radius,
    zoneDurationMs: PROTECTION_BUBBLE_CAST.zoneDurationMs,
    allowedSlots: ["f"],
    timing: {
      anticipationMs: authoredForWallMs(100),
      castMs: authoredForWallMs(Math.max(16, protectionBubbleReleaseWallMs() - 100)),
      impactMs: authoredForWallMs(180),
      recoveryMs: authoredForWallMs(protectionBubbleRecoveryWallMs()),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      /** Locked — cannot cancel once started. */
      canCancelAnticipation: false,
    },
    interruptible: false,
  },
  /**
   * Blood Rush (F) — crouch 1s, then sprint-dash. Units clipped take a nick + bleed.
   * Unlockable F; Heal Beam stays the default.
   */
  bloodRush: {
    id: "bloodRush",
    unlockCostEssence: BLOOD_RUSH_CAST.unlockCostEssence,
    name: "Blood Rush",
    description:
      "Drop into a crouch for a second, then explode forward in a low sprint. Enemies you pass through take a small hit and start bleeding. Executes foes at or below 25% health.",
    cooldownMs: BLOOD_RUSH_CAST.cooldownMs,
    range: BLOOD_RUSH_CAST.range,
    shape: "dash",
    effectKind: "standard",
    tags: ["Dash", "Movement", "Damage", "Debuff", "DamageOverTime", "Melee"],
    damage: BLOOD_RUSH_CAST.damage,
    radius: BLOOD_RUSH_CAST.hitRadius,
    executeBelowHpFrac: BLOOD_RUSH_CAST.executeBelowHpFrac,
    allowedSlots: ["f"],
    timing: {
      // Split the 1s crouch charge across anticipation + cast.
      anticipationMs: authoredForWallMs(BLOOD_RUSH_CAST.chargeMs * 0.25),
      castMs: authoredForWallMs(BLOOD_RUSH_CAST.chargeMs * 0.75),
      impactMs: authoredForWallMs(BLOOD_RUSH_CAST.travelMs),
      recoveryMs: authoredForWallMs(BLOOD_RUSH_CAST.recoveryMs),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "cast",
    },
    travel: {
      mode: "translate",
      distance: BLOOD_RUSH_CAST.range,
      durationMs: authoredForWallMs(BLOOD_RUSH_CAST.travelMs),
      hitAlongPath: true,
    },
    iFrames: {
      startMs: authoredForWallMs(BLOOD_RUSH_CAST.chargeMs),
      durationMs: authoredForWallMs(BLOOD_RUSH_CAST.travelMs + 40),
    },
    applyOnHit: [{ statusId: "bleeding", chance: 1 }],
    interruptsOtherCasts: true,
  },
  /**
   * Frost Mist (R) — expanding ice spray cone.
   * Anim: Standing 2H Magic Attack 03 — mist starts @ frame 34.
   * Progressive chill: +10% per tick onto current slow (20% if unsowed); root at 100%.
   */
  frostMist: {
    id: "frostMist",
    unlockCostEssence: 120,
    name: "Frost Mist",
    description:
      "Spray an expanding cone of frost. Ticks damage and deepens chill — stacking onto whatever slow they already have — until they freeze solid at the feet.",
    cooldownMs: 14000,
    range: 11,
    shape: "aoe",
    effectKind: "coneChannel",
    tags: ["Cone", "Channel", "Area", "Damage", "Debuff", "Control", "Root", "DamageOverTime"],
    damage: combatMag(3),
    /** Max half-angle once fully spread (~40°). */
    coneHalfAngle: 0.7,
    mistStartRange: 3.2,
    mistTicks: FROST_MIST_CAST.mistTicks,
    mistGrowMs: FROST_MIST_CAST.mistGrowMs,
    tickMs: FROST_MIST_CAST.mistTickMs,
    allowedSlots: ["r"],
    timing: {
      anticipationMs: authoredForWallMs(90),
      castMs: authoredForWallMs(Math.max(16, frostMistReleaseWallMs() - 90)),
      impactMs: authoredForWallMs(frostMistSprayWallMs()),
      recoveryMs: authoredForWallMs(160),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "impact",
    },
    /** Channel — Surge/Dash/etc. cannot cut; cancel still works. */
    interruptible: false,
  },
  /**
   * Heal Beam (F) — narrow forward heal channel.
   * Anim: Standing 2H Magic Attack 04 — beam starts @ frame 32.
   */
  healBeam: {
    id: "healBeam",
    name: "Heal Beam",
    description:
      "Channel a narrow beam of light. Allies and practice dummies in the line are healed each tick. Cancel anytime after the beam starts.",
    cooldownMs: 20000,
    range: HEAL_BEAM_CAST.range,
    shape: "aoe",
    effectKind: "healBeam",
    tags: ["Line", "Channel", "Healing", "Ally", "Cast"],
    damage: 0,
    heal: HEAL_BEAM_CAST.healPerTick,
    healTicks: HEAL_BEAM_CAST.healTicks,
    tickMs: HEAL_BEAM_CAST.healTickMs,
    coneHalfAngle: HEAL_BEAM_CAST.beamHalfAngle,
    allowedSlots: ["f"],
    timing: {
      anticipationMs: authoredForWallMs(90),
      castMs: authoredForWallMs(Math.max(16, healBeamReleaseWallMs() - 90)),
      impactMs: authoredForWallMs(healBeamChannelWallMs()),
      recoveryMs: authoredForWallMs(160),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "impact",
    },
    /** Channel — Surge/Dash/etc. cannot cut; cancel still works. */
    interruptible: false,
  },
  /**
   * Groove (R) — Jazz Dancing heal channel.
   * Self-centered AoE heals in ticks while aura + dance stay up (~6.6s; cancel anytime).
   * Others get full ticks; caster gets half of total HP restored to others. 40% DR while channeling.
   * Lonely pulses (no HP restored to others) grant combatMag(4) absorb shield for 8s (stacks).
   */
  groove: {
    id: "groove",
    unlockCostEssence: 100,
    name: "Groove",
    description:
      `Break into a jazz groove and pulse healing — allies and dummies get full ticks; you receive half of the total healed to others. If a pulse heals nobody, gain a ${combatMag(4)} HP shield for 8s (stacks). 40% damage resistance while channeling. Cancel anytime.`,
    cooldownMs: 14000,
    range: 0,
    shape: "aoe",
    effectKind: "pulseHeal",
    tags: ["Healing", "Area", "Channel", "Ally", "Self", "Shield", "Defense"],
    damage: 0,
    heal: GROOVE_CAST.healPerTick,
    healTicks: GROOVE_CAST.healTicks,
    tickMs: GROOVE_CAST.healTickMs,
    radius: 7,
    allowedSlots: ["r"],
    timing: {
      anticipationMs: authoredForWallMs(GROOVE_CAST.anticipationMs),
      castMs: authoredForWallMs(GROOVE_CAST.castMs),
      impactMs: authoredForWallMs(GROOVE_CAST.channelMs),
      recoveryMs: authoredForWallMs(GROOVE_CAST.recoveryMs),
      anticipationMoveMul: 0.7,
      castMoveMul: 0.6,
      impactMoveMul: 0.55,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
      cancelUntilPhase: "impact",
    },
    /** Channel — Surge/Dash/etc. cannot cut; cancel still works. */
    interruptible: false,
  },
};

/** Ordered by SPELL_SLOTS: LMB, RMB, Space, Q, E, R, F */
export const DEFAULT_LOADOUT: readonly string[] = SPELL_SLOTS.map((slot) =>
  defaultAbilityForSlot(slot.id),
);

/** True for the seven default loadout picks (always unlocked). */
export function isStarterLoadoutAbility(abilityId: string): boolean {
  return (DEFAULT_LOADOUT as readonly string[]).includes(abilityId);
}

/** Essence needed to unlock; 0 = already free / starter. */
export function abilityUnlockCostEssence(abilityId: string): number {
  if (isStarterLoadoutAbility(abilityId)) return 0;
  const def = ABILITIES[abilityId];
  if (!def) return 0;
  return Math.max(0, def.unlockCostEssence ?? 80);
}

export function canEquipInSlot(abilityId: string, slotId: SpellSlotId): boolean {
  const def = ABILITIES[abilityId];
  return Boolean(def?.allowedSlots.includes(slotId));
}

/** Combat fire path for an ability (id-agnostic). */
export function abilityEffectKind(def: AbilityDef | undefined): AbilityEffectKind {
  return def?.effectKind ?? "standard";
}

/**
 * Hits that can trigger an armed Counter.
 * Melee (crescent) and contact projectiles yes; Jump Slam yes; other ground AoE / aura ticks no.
 */
export function abilityTriggersCounter(
  def: AbilityDef | undefined,
  abilityId?: string,
): boolean {
  // NPC melee (Wave Assault zombies) — no AbilityDef, still count as direct hits.
  if (abilityId === "zombie_melee") return true;
  if (!def || !(def.damage > 0)) return false;
  if (def.id === "smash") return true;
  if (def.shape === "melee") return true;
  if (def.shape === "projectile" && !def.aura) return true;
  return false;
}

/** True when the ability carries every listed tag. */
export function abilityHasTags(
  def: AbilityDef | undefined,
  ...need: SpellTag[]
): boolean {
  if (!def?.tags?.length) return need.length === 0;
  const set = new Set(def.tags);
  return need.every((t) => set.has(t));
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
  if (st.mechanic === "shield" && app.stacks && app.stacks > 0) {
    bits.push(`${app.stacks} shield`);
  } else if (app.stacks && app.stacks > 1) {
    bits.push(`×${app.stacks}`);
  }
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
  } else if (def.combo?.damageByHit?.length) {
    parts.push(`${def.combo.damageByHit.join("/")} dmg`);
  } else if (def.combo && def.damage > 0) {
    parts.push(`${def.damage}×${def.combo.hits} dmg`);
  } else if (def.heal != null && def.heal > 0) {
    const ticks = def.healTicks ?? 1;
    parts.push(ticks > 1 ? `${def.heal}×${ticks} heal` : `${def.heal} heal`);
  } else if (def.damage > 0) {
    parts.push(`${def.damage} dmg`);
  }
  if (def.detonate) {
    parts.push(
      `fuse ${formatSeconds(def.detonate.delayMs)} → ${def.detonate.damage} blast r${def.detonate.radius}`,
    );
  }

  if (def.radius != null && def.radius > 0 && !def.detonate) {
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
  if (def.confirmOnRelease && def.channelChargeMs) {
    parts.push(`charge ${formatSeconds(def.channelChargeMs)}`);
  }
  if (def.knockback) {
    parts.push(`knockback ${def.knockback}`);
  }
  if (def.executeBelowHpFrac != null && def.executeBelowHpFrac > 0) {
    parts.push(`execute ≤${Math.round(def.executeBelowHpFrac * 100)}%`);
  }
  if (def.pull) {
    parts.push(def.leapToTarget ? `leap ${def.pull}` : `pull ${def.pull}`);
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
  /** First entry in the Armoury list for this slot. */
  const first = abilitiesForSlot(slotId)[0];
  return first?.id ?? "bolt";
}

/**
 * Produce a loadout aligned to SPELL_SLOTS.
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

/**
 * Whether `interrupter` may soft-cut an in-progress `current` cast.
 * Counter (`cutsAnyCast`) acts like cancel — channels and locked casts included.
 */
export function canInterruptOtherCast(
  interrupter: AbilityDef | undefined,
  current: AbilityDef | undefined,
  opts?: { sameAbility?: boolean },
): boolean {
  if (!interrupter?.interruptsOtherCasts) return false;
  if (opts?.sameAbility) return false;
  if (interrupter.cutsAnyCast) return true;
  if (current?.interruptible === false) return false;
  if (isChannelAbility(current)) return false;
  return true;
}

/**
 * Channelled abilities keep resolving during impact (mist ticks, heal pulses, …).
 * Other casts cannot cut them — only player cancel or hard interrupt.
 */
export function isChannelAbility(def: AbilityDef | undefined): boolean {
  return def?.timing.cancelUntilPhase === "impact";
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
