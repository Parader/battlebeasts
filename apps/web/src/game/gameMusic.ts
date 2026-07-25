import { assetUrl } from "./assetUrl";
import { getMusicOutputVolume, subscribeAudioSettings } from "./audioSettings";

/** Encode each path segment so spaces work in web + Electron. */
function publicAssetUrl(path: string): string {
  const clean = path.replace(/^\//, "");
  const encoded = clean
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return assetUrl(encoded);
}

export const VILLAGE_MUSIC_URL = publicAssetUrl("sounds/mage village.mp3");

/** Authored bed level so 100% user music isn't harsh. */
const MUSIC_BED = 0.45;
const FADE_MS = 900;

let audio: HTMLAudioElement | null = null;
let fadeRaf = 0;
let unlockBound = false;
let wantPlaying = false;
/** 0 while fading out to pause; 1 while audible / fading in. */
let fadeGain = 0;

function musicTargetVolume(): number {
  return Math.min(1, getMusicOutputVolume() * MUSIC_BED * fadeGain);
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
    audio.src = VILLAGE_MUSIC_URL;
  }
  return audio;
}

function cancelFade() {
  if (fadeRaf) {
    cancelAnimationFrame(fadeRaf);
    fadeRaf = 0;
  }
}

function applyVolumeNow() {
  getAudio().volume = musicTargetVolume();
}

function fadeFadeGain(targetGain: number, onDone?: () => void) {
  cancelFade();
  const startGain = fadeGain;
  const t0 = performance.now();

  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / FADE_MS);
    const eased = t * t * (3 - 2 * t);
    fadeGain = startGain + (targetGain - startGain) * eased;
    applyVolumeNow();
    if (t < 1) {
      fadeRaf = requestAnimationFrame(tick);
      return;
    }
    fadeGain = targetGain;
    applyVolumeNow();
    fadeRaf = 0;
    onDone?.();
  };
  fadeRaf = requestAnimationFrame(tick);
}

function bindUnlockOnce() {
  if (unlockBound) return;
  unlockBound = true;
  const unlock = () => {
    if (!wantPlaying) return;
    void tryPlay();
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

async function tryPlay(): Promise<void> {
  const el = getAudio();
  try {
    if (el.paused) await el.play();
    fadeFadeGain(1);
  } catch {
    // Autoplay blocked until a user gesture — unlock listeners will retry.
    bindUnlockOnce();
  }
}

// Live volume changes from settings while music is up.
subscribeAudioSettings(() => {
  if (!wantPlaying && fadeGain <= 0.001) return;
  applyVolumeNow();
});

/** Fetch + decode into the shared Audio element (hub preload step). */
export async function preloadVillageMusic(): Promise<void> {
  const el = getAudio();
  if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;

  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed to load ${VILLAGE_MUSIC_URL}`));
    };
    const cleanup = () => {
      el.removeEventListener("canplaythrough", onReady);
      el.removeEventListener("error", onError);
    };
    el.addEventListener("canplaythrough", onReady, { once: true });
    el.addEventListener("error", onError, { once: true });
    el.load();
  });
}

/** Loop village music (hub). No-ops safely if still loading / autoplay-blocked. */
export function playVillageMusic(): void {
  wantPlaying = true;
  bindUnlockOnce();
  void tryPlay();
}

/** Fade out and pause (arena / leave play). */
export function stopVillageMusic(): void {
  wantPlaying = false;
  const el = getAudio();
  if (el.paused && fadeGain <= 0.001) return;
  fadeFadeGain(0, () => {
    el.pause();
  });
}
