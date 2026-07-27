import { assetUrl } from "./assetUrl";
import { getAmbianceOutputVolume, subscribeAudioSettings } from "./audioSettings";

/** Encode each path segment so spaces work in web + Electron. */
function publicAssetUrl(path: string): string {
  const clean = path.replace(/^\//, "");
  const encoded = clean
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return assetUrl(encoded);
}

export type AmbianceTrackId = "village" | "arena";

export const AMBIANCE_URLS: Record<AmbianceTrackId, string> = {
  village: publicAssetUrl("sounds/mage village ambiance.mp3"),
  arena: publicAssetUrl("sounds/sand arena ambiance.mp3"),
};

/** Authored bed so 100% ambiance isn't harsh under music. */
const AMBIANCE_BED = 0.55;
const FADE_MS = 1100;

type TrackRuntime = {
  el: HTMLAudioElement;
  fadeGain: number;
  fadeRaf: number;
  wantPlaying: boolean;
};

const tracks: Partial<Record<AmbianceTrackId, TrackRuntime>> = {};
let unlockBound = false;
let activeTrack: AmbianceTrackId | null = null;

function ambianceTargetVolume(fadeGain: number): number {
  return Math.min(1, getAmbianceOutputVolume() * AMBIANCE_BED * fadeGain);
}

function getTrack(id: AmbianceTrackId): TrackRuntime {
  let t = tracks[id];
  if (!t) {
    const el = new Audio();
    el.loop = true;
    el.preload = "auto";
    el.volume = 0;
    el.src = AMBIANCE_URLS[id];
    t = { el, fadeGain: 0, fadeRaf: 0, wantPlaying: false };
    tracks[id] = t;
  }
  return t;
}

function cancelFade(t: TrackRuntime) {
  if (t.fadeRaf) {
    cancelAnimationFrame(t.fadeRaf);
    t.fadeRaf = 0;
  }
}

function applyVolume(t: TrackRuntime) {
  t.el.volume = ambianceTargetVolume(t.fadeGain);
}

function fadeFadeGain(t: TrackRuntime, targetGain: number, onDone?: () => void) {
  cancelFade(t);
  const startGain = t.fadeGain;
  const t0 = performance.now();

  const tick = (now: number) => {
    const u = Math.min(1, (now - t0) / FADE_MS);
    const eased = u * u * (3 - 2 * u);
    t.fadeGain = startGain + (targetGain - startGain) * eased;
    applyVolume(t);
    if (u < 1) {
      t.fadeRaf = requestAnimationFrame(tick);
      return;
    }
    t.fadeGain = targetGain;
    applyVolume(t);
    t.fadeRaf = 0;
    onDone?.();
  };
  t.fadeRaf = requestAnimationFrame(tick);
}

function bindUnlockOnce() {
  if (unlockBound) return;
  unlockBound = true;
  const unlock = () => {
    if (!activeTrack) return;
    const t = tracks[activeTrack];
    if (!t?.wantPlaying) return;
    void tryPlay(activeTrack);
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

async function tryPlay(id: AmbianceTrackId): Promise<void> {
  const t = getTrack(id);
  try {
    if (t.el.paused) await t.el.play();
    fadeFadeGain(t, 1);
  } catch {
    bindUnlockOnce();
  }
}

function stopTrack(id: AmbianceTrackId, opts?: { immediate?: boolean }) {
  const t = tracks[id];
  if (!t) return;
  t.wantPlaying = false;
  if (opts?.immediate) {
    cancelFade(t);
    t.fadeGain = 0;
    applyVolume(t);
    t.el.pause();
    return;
  }
  if (t.el.paused && t.fadeGain <= 0.001) return;
  fadeFadeGain(t, 0, () => {
    t.el.pause();
  });
}

subscribeAudioSettings(() => {
  for (const t of Object.values(tracks)) {
    if (!t) continue;
    if (!t.wantPlaying && t.fadeGain <= 0.001) continue;
    applyVolume(t);
  }
});

async function preloadTrack(id: AmbianceTrackId): Promise<void> {
  const t = getTrack(id);
  if (t.el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;

  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed to load ${AMBIANCE_URLS[id]}`));
    };
    const cleanup = () => {
      t.el.removeEventListener("canplaythrough", onReady);
      t.el.removeEventListener("error", onError);
    };
    t.el.addEventListener("canplaythrough", onReady, { once: true });
    t.el.addEventListener("error", onError, { once: true });
    t.el.load();
  });
}

/** Hub village ambiance preload. */
export async function preloadVillageAmbiance(): Promise<void> {
  await preloadTrack("village");
}

/** Arena / PvP ambiance preload. */
export async function preloadArenaAmbiance(): Promise<void> {
  await preloadTrack("arena");
}

/**
 * Switch looping ambiance bed. Pass `null` to fade out.
 * Hub uses `"village"`; arena uses `"arena"`; loading gate uses `null`.
 */
export function setAmbianceTrack(track: AmbianceTrackId | null): void {
  if (track === activeTrack) {
    if (track) {
      const t = getTrack(track);
      t.wantPlaying = true;
      bindUnlockOnce();
      void tryPlay(track);
    }
    return;
  }

  const prev = activeTrack;
  activeTrack = track;

  if (prev) stopTrack(prev);
  if (!track) return;

  const next = getTrack(track);
  next.wantPlaying = true;
  bindUnlockOnce();
  void tryPlay(track);
}
