import { getEffectOutputVolume } from "./audioSettings";
import { assetUrl } from "./assetUrl";

/** Encode each path segment so spaces work in web + Electron. */
function publicAssetUrl(path: string): string {
  const clean = path.replace(/^\//, "");
  const encoded = clean
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return assetUrl(encoded);
}

export const FOOTSTEP_URLS = [
  publicAssetUrl("sounds/footnote.wav"),
  publicAssetUrl("sounds/footnote2.wav"),
] as const;

export const SLAM_HIT_URL = publicAssetUrl("sounds/spells/slam_hit.wav");
export const ICE_HIT_URL = publicAssetUrl("sounds/spells/ice_hit.wav");
/** Ice Lance throw / windup. */
export const ICE_DRAW_URL = publicAssetUrl("sounds/spells/draw_ice.wav");
/** Runic Shard throw (former ice_draw). */
export const RUNIC_SHARD_CAST_URL = publicAssetUrl("sounds/spells/ice_draw.wav");
export const DRAIN_LIFE_URL = publicAssetUrl("sounds/spells/drain_life.wav");
export const ORBITING_WISP_URL = publicAssetUrl("sounds/spells/orbiting_wisp.wav");
export const ORBITING_WISP_HIT_URL = publicAssetUrl("sounds/spells/impact.wav");
export const VOID_THROW_URL = publicAssetUrl("sounds/spells/void_throw.wav");
export const VOID_HIT_URL = publicAssetUrl("sounds/spells/void_hit.wav");
export const VOID_EXPLOSION_URL = publicAssetUrl("sounds/spells/void_explosion.wav");
export const HEAL_URL = publicAssetUrl("sounds/spells/heal.wav");
export const HEAL_POP_URL = publicAssetUrl("sounds/spells/heal_pop.wav");
export const SHROOM_HIT_URL = publicAssetUrl("sounds/spells/shroom_hit.wav");
export const VOID_DISC_SPIN_URLS = [
  publicAssetUrl("sounds/spells/spin_1.wav"),
  publicAssetUrl("sounds/spells/spin_2.wav"),
] as const;
export const ELECTRICITY_LOOP_URL = publicAssetUrl("sounds/spells/electricity_loop.wav");
export const ELECTRIC_HIT_URL = publicAssetUrl("sounds/spells/electric_hit.wav");
export const CRESCENT_SWING_URLS = [
  publicAssetUrl("sounds/spells/wind_hit.wav"),
  publicAssetUrl("sounds/spells/wind_hit_2.wav"),
  publicAssetUrl("sounds/spells/wind_hit_3.wav"),
] as const;

/** Authored bed — max footstep level vs full Effects×Master. */
const FOOTSTEP_BED = 0.48;
/** Global spell SFX bed (cast/hit/etc.) vs Effects×Master. */
const SPELL_SFX_BED = 0.5;
/** Relative beds within the spell bus (tune later). */
const BOLT_CAST_BED = 0.625;
const SLAM_HIT_BED = 1;
const ICE_HIT_BED = 1.15;
const ICE_DRAW_BED = 0.2;
const RUNIC_SHARD_CAST_BED = 0.6;
const DRAIN_LIFE_BED = 1.05;
const ORBITING_WISP_BED = 1.1;
const ORBITING_WISP_HIT_BED = 1;
const VOID_THROW_BED = 0.3;
const VOID_HIT_BED = 0.35;
const VOID_EXPLOSION_BED = 0.84;
const ARC_THREAD_LOOP_BED = 0.4375;
const ARC_THREAD_HIT_BED = 0.4375;
/** Bolt impact stays on the previous Arc Thread hit level. */
const BOLT_HIT_BED = 0.625;
const CRESCENT_SWING_BED = 0.3;
const CRESCENT_HIT_BED = 0.3;
const SHROOM_HEAL_BED = 0.7;
const SHROOM_HEAL_POP_BED = 1;
/** heal_pop.wav peaks near 4.5% inside a 19s file — lift it to a normal 1.0 bed. */
const SHROOM_HEAL_POP_MAKEUP = 6.7;
const SHROOM_HEAL_POP_PLAY_SEC = 0.5;
const SHROOM_HIT_BED = 0.7;
const VOID_DISC_SPIN_BED = 0.75;
/** Void Disc body hit — same clip as the Orbiting Wisp cast, quieter. */
const VOID_DISC_HIT_BED = 0.8;
/** Short slice of electricity_loop for Bolt cast/flight (thread uses the full loop). */
const BOLT_ELECTRIC_CAST_SEC = 0.2;
/** Skip the loop’s quiet fade-in so a short slice is still audible. */
const BOLT_ELECTRIC_CAST_OFFSET_SEC = 0.12;
/** Hold full level until this many seconds into the cast window, then fade to end. */
const BOLT_ELECTRIC_CAST_FADE_START_SEC = 0.12;
/** Fade when cutting Arc Thread tether / interrupting Bolt cast. */
const ELECTRIC_LOOP_STOP_FADE_SEC = 0.12;
/** electric_hit: skip lead-in silence, cut before the long quiet tail. */
const ELECTRIC_HIT_OFFSET_SEC = 0.1;
const ELECTRIC_HIT_PLAY_SEC = 0.25;
/** Hold full level until this many seconds into the play window, then fade to end. */
const ELECTRIC_HIT_FADE_START_SEC = 0.18;
/** Crescent wind hits — skip tiny lead-in, fade the tail (cast + impact share the pool). */
const CRESCENT_SWING_OFFSET_SEC = 0.05;
const CRESCENT_SWING_PLAY_SEC = 0.28;
const CRESCENT_SWING_FADE_START_SEC = 0.16;
/** Slam peaks immediately; play the body, skip the long quiet tail (~3.2s file). */
const SLAM_HIT_PLAY_SEC = 1.0;
/** Ice Lance explode — play the ice crack body. */
const ICE_HIT_PLAY_SEC = 1.0;
/** Ice Lance cast draw — full clip (~2.7s draw_ice). */
const ICE_DRAW_PLAY_SEC = 2.8;
/** Runic Shard throw — former ice_draw (~1.17s). */
const RUNIC_SHARD_CAST_PLAY_SEC = 1.2;

const MOVE_EPS = 0.4;
const STEP_INTERVAL_FAST = 0.34;
const STEP_INTERVAL_SLOW = 0.48;

let audioCtx: AudioContext | null = null;
let footstepBuffers: AudioBuffer[] = [];
let slamHitBuffer: AudioBuffer | null = null;
let iceHitBuffer: AudioBuffer | null = null;
let iceDrawBuffer: AudioBuffer | null = null;
let runicShardCastBuffer: AudioBuffer | null = null;
let drainLifeBuffer: AudioBuffer | null = null;
let orbitingWispBuffer: AudioBuffer | null = null;
let orbitingWispHitBuffer: AudioBuffer | null = null;
let voidThrowBuffer: AudioBuffer | null = null;
let voidHitBuffer: AudioBuffer | null = null;
let voidExplosionBuffer: AudioBuffer | null = null;
let healBuffer: AudioBuffer | null = null;
let healPopBuffer: AudioBuffer | null = null;
let shroomHitBuffer: AudioBuffer | null = null;
let voidDiscSpinBuffers: AudioBuffer[] = [];
let electricityLoopBuffer: AudioBuffer | null = null;
let electricHitBuffer: AudioBuffer | null = null;
let crescentSwingBuffers: AudioBuffer[] = [];
let lastVariant = -1;
let lastCrescentSwingVariant = -1;
let stepAcc = 0;
let footstepsPreloaded = false;
let boltPreloaded = false;
let slamPreloaded = false;
let iceHitPreloaded = false;
let iceDrawPreloaded = false;
let runicShardCastPreloaded = false;
let drainLifePreloaded = false;
let orbitingWispPreloaded = false;
let voidThrowPreloaded = false;
let voidHitPreloaded = false;
let voidExplosionPreloaded = false;
let shroomSfxPreloaded = false;
let voidDiscSpinPreloaded = false;
let arcThreadPreloaded = false;
let crescentPreloaded = false;
let unlockBound = false;

/** Active cast one-shots keyed by owner session id (stop on cancel / release). */
const activeBoltCast = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
/** Arc Thread tether loop keyed by owner (stop on discharge / break / cancel). */
const activeArcThreadLoop = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
/** Life Leech channel drain loop keyed by owner. */
const activeDrainLifeLoop = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
let activeSlamHit: AudioBufferSourceNode | null = null;
let activeElectricHit: AudioBufferSourceNode | null = null;
let activeCrescentSwing: AudioBufferSourceNode | null = null;

function effectsGain(bed: number): number {
  return Math.min(1, getEffectOutputVolume() * bed);
}

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function bindUnlockOnce() {
  if (unlockBound) return;
  unlockBound = true;
  const resume = () => {
    const ctx = audioCtx;
    if (ctx && ctx.state === "suspended") void ctx.resume();
  };
  window.addEventListener("pointerdown", resume, { passive: true });
  window.addEventListener("keydown", resume);
}

async function decodeUrl(url: string): Promise<AudioBuffer> {
  const ctx = getCtx();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  const raw = await res.arrayBuffer();
  return ctx.decodeAudioData(raw.slice(0));
}

function ensureRunningCtx(): AudioContext | null {
  const ctx = audioCtx;
  if (!ctx) return null;
  if (ctx.state === "suspended") {
    bindUnlockOnce();
    void ctx.resume();
  }
  return ctx;
}

function pickVariant(): number {
  const n = footstepBuffers.length;
  if (n <= 1) return 0;
  let v = Math.floor(Math.random() * n);
  if (v === lastVariant) {
    v = (v + 1 + Math.floor(Math.random() * (n - 1))) % n;
  }
  lastVariant = v;
  return v;
}

function playStep(): void {
  const ctx = ensureRunningCtx();
  if (!ctx || footstepBuffers.length === 0) return;

  const buf = footstepBuffers[pickVariant()];
  if (!buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(FOOTSTEP_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

/** Decode footstep WAVs via Web Audio (IEEE-float safe). */
export async function preloadFootstepSfx(): Promise<void> {
  if (footstepsPreloaded && footstepBuffers.length === FOOTSTEP_URLS.length) return;
  bindUnlockOnce();
  getCtx();
  footstepBuffers = await Promise.all(FOOTSTEP_URLS.map((url) => decodeUrl(url)));
  footstepsPreloaded = true;
}

/** Bolt shares Arc Thread electric assets (short loop slice + hit). */
export async function preloadBoltSfx(): Promise<void> {
  await preloadArcThreadSfx();
  boltPreloaded = true;
}

/** Decode Leap Slam landing SFX. */
export async function preloadSlamSfx(): Promise<void> {
  if (slamPreloaded && slamHitBuffer) return;
  bindUnlockOnce();
  getCtx();
  slamHitBuffer = await decodeUrl(SLAM_HIT_URL);
  slamPreloaded = true;
}

/** Decode Arc Thread tether loop + discharge hit (also used by Bolt). */
export async function preloadArcThreadSfx(): Promise<void> {
  if (arcThreadPreloaded && electricityLoopBuffer && electricHitBuffer) return;
  bindUnlockOnce();
  getCtx();
  const [loop, hit] = await Promise.all([
    decodeUrl(ELECTRICITY_LOOP_URL),
    decodeUrl(ELECTRIC_HIT_URL),
  ]);
  electricityLoopBuffer = loop;
  electricHitBuffer = hit;
  arcThreadPreloaded = true;
}

export async function preloadCombatSfx(): Promise<void> {
  await Promise.all([
    preloadFootstepSfx(),
    preloadArcThreadSfx(),
    preloadSlamSfx(),
    preloadIceHitSfx(),
    preloadIceDrawSfx(),
    preloadRunicShardCastSfx(),
    preloadDrainLifeSfx(),
    preloadOrbitingWispSfx(),
    preloadSoulMarkSfx(),
    preloadCrescentSfx(),
    preloadShroomSfx(),
    preloadVoidDiscSpinSfx(),
  ]);
  boltPreloaded = true;
}

/** Decode ice shatter / Runic Shard explosion SFX. */
export async function preloadIceHitSfx(): Promise<void> {
  if (iceHitPreloaded && iceHitBuffer) return;
  bindUnlockOnce();
  getCtx();
  iceHitBuffer = await decodeUrl(ICE_HIT_URL);
  iceHitPreloaded = true;
}

/** Decode Ice Lance throw SFX (draw_ice). */
export async function preloadIceDrawSfx(): Promise<void> {
  if (iceDrawPreloaded && iceDrawBuffer) return;
  bindUnlockOnce();
  getCtx();
  iceDrawBuffer = await decodeUrl(ICE_DRAW_URL);
  iceDrawPreloaded = true;
}

/** Decode Runic Shard throw SFX (ice_draw). */
export async function preloadRunicShardCastSfx(): Promise<void> {
  if (runicShardCastPreloaded && runicShardCastBuffer) return;
  bindUnlockOnce();
  getCtx();
  runicShardCastBuffer = await decodeUrl(RUNIC_SHARD_CAST_URL);
  runicShardCastPreloaded = true;
}

/** Decode Orbiting Wisp summon and enemy-hit impact. */
export async function preloadOrbitingWispSfx(): Promise<void> {
  if (orbitingWispPreloaded && orbitingWispBuffer && orbitingWispHitBuffer) return;
  bindUnlockOnce();
  getCtx();
  const [cast, hit] = await Promise.all([
    decodeUrl(ORBITING_WISP_URL),
    decodeUrl(ORBITING_WISP_HIT_URL),
  ]);
  orbitingWispBuffer = cast;
  orbitingWispHitBuffer = hit;
  orbitingWispPreloaded = true;
}

/** Decode Soul Mark throw, hit, and stack consume. */
export async function preloadSoulMarkSfx(): Promise<void> {
  if (
    voidThrowPreloaded &&
    voidThrowBuffer &&
    voidHitPreloaded &&
    voidHitBuffer &&
    voidExplosionPreloaded &&
    voidExplosionBuffer
  ) {
    return;
  }
  bindUnlockOnce();
  getCtx();
  const [throwBuf, hitBuf, boomBuf] = await Promise.all([
    decodeUrl(VOID_THROW_URL),
    decodeUrl(VOID_HIT_URL),
    decodeUrl(VOID_EXPLOSION_URL),
  ]);
  voidThrowBuffer = throwBuf;
  voidHitBuffer = hitBuf;
  voidExplosionBuffer = boomBuf;
  voidThrowPreloaded = true;
  voidHitPreloaded = true;
  voidExplosionPreloaded = true;
}

/** Decode Life Leech channel drain loop. */
export async function preloadDrainLifeSfx(): Promise<void> {
  if (drainLifePreloaded && drainLifeBuffer) return;
  bindUnlockOnce();
  getCtx();
  drainLifeBuffer = await decodeUrl(DRAIN_LIFE_URL);
  drainLifePreloaded = true;
}

/** Decode Crescent wind hits (cycled 1→2→3 for cast + impact). */
export async function preloadCrescentSfx(): Promise<void> {
  if (crescentPreloaded && crescentSwingBuffers.length === CRESCENT_SWING_URLS.length) {
    return;
  }
  bindUnlockOnce();
  getCtx();
  crescentSwingBuffers = await Promise.all(CRESCENT_SWING_URLS.map((url) => decodeUrl(url)));
  crescentPreloaded = true;
}

function pickCrescentWindVariant(): number {
  const n = crescentSwingBuffers.length;
  if (n <= 0) return 0;
  const v = (lastCrescentSwingVariant + 1) % n;
  lastCrescentSwingVariant = v;
  return v;
}

function playCrescentWindSfx(bed: number): void {
  const buf = crescentSwingBuffers[pickCrescentWindVariant()] ?? null;
  playTrimmedOneShot({
    buf,
    bed,
    offsetSec: CRESCENT_SWING_OFFSET_SEC,
    playSec: CRESCENT_SWING_PLAY_SEC,
    fadeStartSec: CRESCENT_SWING_FADE_START_SEC,
    getActive: () => activeCrescentSwing,
    setActive: (src) => {
      activeCrescentSwing = src;
    },
  });
}

/**
 * Drive local footstep one-shots from avatar locomotion.
 * Call every frame with planar speed (world units/sec).
 */
export function tickFootsteps(speed: number, dt: number, opts?: { muted?: boolean }): void {
  if (opts?.muted || !(dt > 0) || speed < MOVE_EPS) {
    stepAcc = 0;
    return;
  }
  if (footstepBuffers.length === 0) return;

  const speed01 = Math.min(1, speed / 6);
  const interval = STEP_INTERVAL_SLOW + (STEP_INTERVAL_FAST - STEP_INTERVAL_SLOW) * speed01;
  stepAcc += dt;
  if (stepAcc < interval) return;
  stepAcc %= interval;
  playStep();
}

export function resetFootsteps(): void {
  stepAcc = 0;
}

function fadeStopSource(
  entry: { src: AudioBufferSourceNode; gain: GainNode },
  fadeSec: number,
  immediate = false,
): void {
  const ctx = audioCtx;
  if (!ctx || immediate || fadeSec <= 0) {
    try {
      entry.src.stop();
    } catch {
      // already stopped
    }
    return;
  }
  const now = ctx.currentTime;
  const g = entry.gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(Math.max(0.0001, g.value), now);
  g.linearRampToValueAtTime(0.0001, now + fadeSec);
  try {
    entry.src.stop(now + fadeSec);
  } catch {
    // already stopped
  }
}

/** Start bolt cast sound — short slice of electricity_loop (not a sustained tether). */
export function playBoltCastSfx(ownerId: string): void {
  stopBoltCastSfx(ownerId, true);
  const ctx = ensureRunningCtx();
  const buf = electricityLoopBuffer;
  if (!ctx || !buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  const level = effectsGain(SPELL_SFX_BED * BOLT_CAST_BED);
  const offset = Math.min(BOLT_ELECTRIC_CAST_OFFSET_SEC, Math.max(0, buf.duration - 0.01));
  const dur = Math.min(BOLT_ELECTRIC_CAST_SEC, Math.max(0.01, buf.duration - offset));
  const fadeStart = Math.min(BOLT_ELECTRIC_CAST_FADE_START_SEC, Math.max(0, dur - 0.01));
  const t0 = ctx.currentTime;
  gain.gain.setValueAtTime(level, t0);
  gain.gain.setValueAtTime(level, t0 + fadeStart);
  gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.onended = () => {
    if (activeBoltCast.get(ownerId)?.src === src) activeBoltCast.delete(ownerId);
  };
  activeBoltCast.set(ownerId, { src, gain });
  src.start(0, offset, dur);
}

/** Stop bolt cast sound early (cancel / interrupt / projectile release). */
export function stopBoltCastSfx(ownerId: string, immediate = false): void {
  const entry = activeBoltCast.get(ownerId);
  if (!entry) return;
  activeBoltCast.delete(ownerId);
  fadeStopSource(entry, ELECTRIC_LOOP_STOP_FADE_SEC, immediate);
}

/**
 * Bolt impact — same electric_hit one-shot as Arc Thread discharge.
 */
export function playBoltHitSfx(): void {
  playArcThreadHitSfx(BOLT_HIT_BED);
}

function stopSlamHitSfx(): void {
  if (!activeSlamHit) return;
  try {
    activeSlamHit.stop();
  } catch {
    // already stopped
  }
  activeSlamHit = null;
}

/** Leap Slam landing impact (peaks immediately; trimmed tail). */
export function playSlamHitSfx(): void {
  const ctx = ensureRunningCtx();
  const buf = slamHitBuffer;
  if (!ctx || !buf) return;

  stopSlamHitSfx();

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * SLAM_HIT_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.onended = () => {
    if (activeSlamHit === src) activeSlamHit = null;
  };
  activeSlamHit = src;
  const dur = Math.min(SLAM_HIT_PLAY_SEC, buf.duration);
  src.start(0, 0, dur);
}

/** Ice shatter / Runic Shard explosion (also Ice Lance detonate for now). */
export function playIceHitSfx(): void {
  const ctx = ensureRunningCtx();
  const buf = iceHitBuffer;
  if (!ctx || !buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * ICE_HIT_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  const dur = Math.min(ICE_HIT_PLAY_SEC, buf.duration);
  src.start(0, 0, dur);
}

/** Ice Lance throw — draw_ice (overlaps on rapid casts). */
export function playIceDrawSfx(): void {
  const ctx = ensureRunningCtx();
  const buf = iceDrawBuffer;
  if (!ctx || !buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * ICE_DRAW_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  const dur = Math.min(ICE_DRAW_PLAY_SEC, buf.duration);
  src.start(0, 0, dur);
}

/** Runic Shard throw — ice_draw. */
export function playRunicShardCastSfx(): void {
  const ctx = ensureRunningCtx();
  const buf = runicShardCastBuffer;
  if (!ctx || !buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * RUNIC_SHARD_CAST_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  const dur = Math.min(RUNIC_SHARD_CAST_PLAY_SEC, buf.duration);
  src.start(0, 0, dur);
}

function playOrbitingWispBuffer(bed: number): void {
  const ctx = ensureRunningCtx();
  const buf = orbitingWispBuffer;
  if (!ctx || !buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * bed);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(0, 0, buf.duration);
}

/** Orbiting Wisp summon. Overlaps when several wisps are cast in a row. */
export function playOrbitingWispSfx(): void {
  playOrbitingWispBuffer(ORBITING_WISP_BED);
}

/** Orbiting Wisp connecting with an enemy. */
export function playOrbitingWispHitSfx(): void {
  const ctx = ensureRunningCtx();
  const buf = orbitingWispHitBuffer;
  if (!ctx || !buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * ORBITING_WISP_HIT_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(0, 0, buf.duration);
}

/** Void Disc body hit — Orbiting Wisp cast clip. */
export function playVoidDiscHitSfx(): void {
  playOrbitingWispBuffer(VOID_DISC_HIT_BED);
}

/** Soul Mark throw. */
export function playSoulMarkThrowSfx(): void {
  const ctx = ensureRunningCtx();
  const buf = voidThrowBuffer;
  if (!ctx || !buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * VOID_THROW_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(0, 0, buf.duration);
}

/** Soul Mark body hit. */
export function playSoulMarkHitSfx(): void {
  const ctx = ensureRunningCtx();
  const buf = voidHitBuffer;
  if (!ctx || !buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * VOID_HIT_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(0, 0, buf.duration);
}

/** Decode Spore Shroom cast heal, walk-on pop, and enemy burst. */
export async function preloadShroomSfx(): Promise<void> {
  if (shroomSfxPreloaded && healBuffer && healPopBuffer && shroomHitBuffer) return;
  bindUnlockOnce();
  getCtx();
  const [heal, pop, hit] = await Promise.all([
    decodeUrl(HEAL_URL),
    decodeUrl(HEAL_POP_URL),
    decodeUrl(SHROOM_HIT_URL),
  ]);
  healBuffer = heal;
  healPopBuffer = pop;
  shroomHitBuffer = hit;
  shroomSfxPreloaded = true;
}

function playShroomOneShot(buf: AudioBuffer | null, bed: number): void {
  const ctx = ensureRunningCtx();
  if (!ctx || !buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * bed);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(0, 0, buf.duration);
}

/** Spore Shroom plant / cast. */
export function playShroomHealSfx(): void {
  playShroomOneShot(healBuffer, SHROOM_HEAL_BED);
}

/** Ally steps on a shroom. */
export function playShroomHealPopSfx(): void {
  const ctx = ensureRunningCtx();
  const buf = healPopBuffer;
  if (!ctx || !buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * SHROOM_HEAL_POP_BED) * SHROOM_HEAL_POP_MAKEUP;
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(0, 0, Math.min(SHROOM_HEAL_POP_PLAY_SEC, buf.duration));
}

/** Enemy pops a shroom. */
export function playShroomHitSfx(): void {
  playShroomOneShot(shroomHitBuffer, SHROOM_HIT_BED);
}

/** Decode Void Disc spin whooshes (outbound = 1, return = 2). */
export async function preloadVoidDiscSpinSfx(): Promise<void> {
  if (voidDiscSpinPreloaded && voidDiscSpinBuffers.length === VOID_DISC_SPIN_URLS.length) return;
  bindUnlockOnce();
  getCtx();
  voidDiscSpinBuffers = await Promise.all(VOID_DISC_SPIN_URLS.map((url) => decodeUrl(url)));
  voidDiscSpinPreloaded = true;
}

/** Void Disc spin. Index 0 is the throw, 1 is the turn back. */
export function playVoidDiscSpinSfx(index: 0 | 1): void {
  const ctx = ensureRunningCtx();
  const buf = voidDiscSpinBuffers[index] ?? null;
  if (!ctx || !buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * VOID_DISC_SPIN_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(0, 0, buf.duration);
}

/** Soul Mark stack consume / Soul Rupture. */
export function playSoulMarkExplosionSfx(): void {
  const ctx = ensureRunningCtx();
  const buf = voidExplosionBuffer;
  if (!ctx || !buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * VOID_EXPLOSION_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(0, 0, buf.duration);
}

/** Start Life Leech channel drain loop (until release / cancel). */
export function playDrainLifeLoopSfx(ownerId: string): void {
  stopDrainLifeLoopSfx(ownerId, true);
  const ctx = ensureRunningCtx();
  const buf = drainLifeBuffer;
  if (!ctx || !buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * DRAIN_LIFE_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.onended = () => {
    if (activeDrainLifeLoop.get(ownerId)?.src === src) activeDrainLifeLoop.delete(ownerId);
  };
  activeDrainLifeLoop.set(ownerId, { src, gain });
  src.start(0);
}

/** Stop Life Leech channel drain loop. */
export function stopDrainLifeLoopSfx(ownerId: string, immediate = false): void {
  const entry = activeDrainLifeLoop.get(ownerId);
  if (!entry) return;
  activeDrainLifeLoop.delete(ownerId);
  fadeStopSource(entry, ELECTRIC_LOOP_STOP_FADE_SEC, immediate);
}

/** Start Arc Thread tether crackle (loops until stop / discharge). */
export function playArcThreadLoopSfx(ownerId: string): void {
  stopArcThreadLoopSfx(ownerId, true);
  const ctx = ensureRunningCtx();
  const buf = electricityLoopBuffer;
  if (!ctx || !buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * ARC_THREAD_LOOP_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.onended = () => {
    if (activeArcThreadLoop.get(ownerId)?.src === src) activeArcThreadLoop.delete(ownerId);
  };
  activeArcThreadLoop.set(ownerId, { src, gain });
  src.start(0);
}

/** Stop Arc Thread tether loop (discharge / break / cancel / natural end). */
export function stopArcThreadLoopSfx(ownerId: string, immediate = false): void {
  const entry = activeArcThreadLoop.get(ownerId);
  if (!entry) return;
  activeArcThreadLoop.delete(ownerId);
  fadeStopSource(entry, ELECTRIC_LOOP_STOP_FADE_SEC, immediate);
}

function stopElectricHitSfx(): void {
  if (!activeElectricHit) return;
  try {
    activeElectricHit.stop();
  } catch {
    // already stopped
  }
  activeElectricHit = null;
}

/** Arc Thread discharge / explosion one-shot. */
export function playArcThreadHitSfx(bed = ARC_THREAD_HIT_BED): void {
  const ctx = ensureRunningCtx();
  const buf = electricHitBuffer;
  if (!ctx || !buf) return;

  stopElectricHitSfx();

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  const level = effectsGain(SPELL_SFX_BED * bed);
  const offset = Math.min(ELECTRIC_HIT_OFFSET_SEC, Math.max(0, buf.duration - 0.01));
  const dur = Math.min(ELECTRIC_HIT_PLAY_SEC, Math.max(0.01, buf.duration - offset));
  const fadeStart = Math.min(ELECTRIC_HIT_FADE_START_SEC, Math.max(0, dur - 0.01));
  const t0 = ctx.currentTime;
  gain.gain.setValueAtTime(level, t0);
  gain.gain.setValueAtTime(level, t0 + fadeStart);
  gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.onended = () => {
    if (activeElectricHit === src) activeElectricHit = null;
  };
  activeElectricHit = src;
  src.start(0, offset, dur);
}

function playTrimmedOneShot(opts: {
  buf: AudioBuffer | null;
  bed: number;
  offsetSec: number;
  playSec: number;
  fadeStartSec: number;
  getActive: () => AudioBufferSourceNode | null;
  setActive: (src: AudioBufferSourceNode | null) => void;
}): void {
  const ctx = ensureRunningCtx();
  const buf = opts.buf;
  if (!ctx || !buf) return;

  const prev = opts.getActive();
  if (prev) {
    try {
      prev.stop();
    } catch {
      // already stopped
    }
    opts.setActive(null);
  }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  const level = effectsGain(SPELL_SFX_BED * opts.bed);
  const offset = Math.min(opts.offsetSec, Math.max(0, buf.duration - 0.01));
  const dur = Math.min(opts.playSec, Math.max(0.01, buf.duration - offset));
  const fadeStart = Math.min(opts.fadeStartSec, Math.max(0, dur - 0.01));
  const t0 = ctx.currentTime;
  gain.gain.setValueAtTime(level, t0);
  gain.gain.setValueAtTime(level, t0 + fadeStart);
  gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.onended = () => {
    if (opts.getActive() === src) opts.setActive(null);
  };
  opts.setActive(src);
  src.start(0, offset, dur);
}

/** Crescent cast miss/swoop — next wind_hit in 1→2→3 order. */
export function playCrescentSwingSfx(): void {
  playCrescentWindSfx(CRESCENT_SWING_BED);
}

/** Crescent contact — same wind pool (one shot; cast swing is skipped on hit). */
export function playCrescentHitSfx(): void {
  playCrescentWindSfx(CRESCENT_HIT_BED);
}
