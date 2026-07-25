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

export const BOLT_CAST_URL = publicAssetUrl("sounds/bolt_cast.wav");
export const BOLT_HIT_URL = publicAssetUrl("sounds/bolt_hit.wav");
export const SLAM_HIT_URL = publicAssetUrl("sounds/slam_hit.wav");

/** Authored bed — max footstep level vs full Effects×Master. */
const FOOTSTEP_BED = 0.48;
/** Global spell SFX bed (cast/hit/etc.) vs Effects×Master. */
const SPELL_SFX_BED = 0.5;
/** Relative beds within the spell bus (tune later). */
const BOLT_CAST_BED = 1;
const BOLT_HIT_BED = 1;
const SLAM_HIT_BED = 1;
/** Cast sample is ~2.4s but only ~0.46s is audible. */
const BOLT_CAST_PLAY_SEC = 0.5;
/**
 * Hit sample peaks early (~0.05s). Play from near the peak; keep the window short.
 */
const BOLT_HIT_PEAK_SEC = 0.05;
const BOLT_HIT_LEAD_SEC = 0.02;
const BOLT_HIT_PLAY_SEC = 0.35;
/** Slam peaks immediately; play the body, skip the long quiet tail (~3.2s file). */
const SLAM_HIT_PLAY_SEC = 1.0;

const MOVE_EPS = 0.4;
const STEP_INTERVAL_FAST = 0.34;
const STEP_INTERVAL_SLOW = 0.48;

let audioCtx: AudioContext | null = null;
let footstepBuffers: AudioBuffer[] = [];
let boltCastBuffer: AudioBuffer | null = null;
let boltHitBuffer: AudioBuffer | null = null;
let slamHitBuffer: AudioBuffer | null = null;
let lastVariant = -1;
let stepAcc = 0;
let footstepsPreloaded = false;
let boltPreloaded = false;
let slamPreloaded = false;
let unlockBound = false;

/** Active cast one-shots keyed by owner session id (stop on cancel / release). */
const activeBoltCast = new Map<string, AudioBufferSourceNode>();
let activeBoltHit: AudioBufferSourceNode | null = null;
let activeSlamHit: AudioBufferSourceNode | null = null;

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

/** Decode bolt cast + hit SFX. */
export async function preloadBoltSfx(): Promise<void> {
  if (boltPreloaded && boltCastBuffer && boltHitBuffer) return;
  bindUnlockOnce();
  getCtx();
  const [cast, hit] = await Promise.all([decodeUrl(BOLT_CAST_URL), decodeUrl(BOLT_HIT_URL)]);
  boltCastBuffer = cast;
  boltHitBuffer = hit;
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

export async function preloadCombatSfx(): Promise<void> {
  await Promise.all([preloadFootstepSfx(), preloadBoltSfx(), preloadSlamSfx()]);
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

/** Start bolt cast sound for a caster (restarts if already playing). */
export function playBoltCastSfx(ownerId: string): void {
  stopBoltCastSfx(ownerId);
  const ctx = ensureRunningCtx();
  const buf = boltCastBuffer;
  if (!ctx || !buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * BOLT_CAST_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.onended = () => {
    if (activeBoltCast.get(ownerId) === src) activeBoltCast.delete(ownerId);
  };
  activeBoltCast.set(ownerId, src);
  const dur = Math.min(BOLT_CAST_PLAY_SEC, buf.duration);
  src.start(0, 0, dur);
}

/** Stop bolt cast sound early (cancel / interrupt / projectile release). */
export function stopBoltCastSfx(ownerId: string): void {
  const src = activeBoltCast.get(ownerId);
  if (!src) return;
  activeBoltCast.delete(ownerId);
  try {
    src.stop();
  } catch {
    // already stopped
  }
}

function stopBoltHitSfx(): void {
  if (!activeBoltHit) return;
  try {
    activeBoltHit.stop();
  } catch {
    // already stopped
  }
  activeBoltHit = null;
}

/**
 * Play bolt impact — aligned to the sample's loud peak, short window, one voice.
 */
export function playBoltHitSfx(): void {
  const ctx = ensureRunningCtx();
  const buf = boltHitBuffer;
  if (!ctx || !buf) return;

  stopBoltHitSfx();

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = effectsGain(SPELL_SFX_BED * BOLT_HIT_BED);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.onended = () => {
    if (activeBoltHit === src) activeBoltHit = null;
  };
  activeBoltHit = src;

  // Clamp offset so a shorter replacement sample still plays audible audio.
  const maxOffset = Math.max(0, buf.duration - 0.04);
  const offset = Math.max(0, Math.min(maxOffset, BOLT_HIT_PEAK_SEC - BOLT_HIT_LEAD_SEC));
  const dur = Math.max(0.04, Math.min(BOLT_HIT_PLAY_SEC, buf.duration - offset));
  src.start(0, offset, dur);
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
