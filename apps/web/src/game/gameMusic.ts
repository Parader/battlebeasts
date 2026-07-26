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

export type MusicTrackId = "village" | "arena";

export const MUSIC_URLS: Record<MusicTrackId, string> = {
  village: publicAssetUrl("sounds/mage village.mp3"),
  arena: publicAssetUrl("sounds/sand arena.mp3"),
};

/** Authored bed level so 100% user music isn't harsh. */
const MUSIC_BED = 0.45;
const FADE_MS = 900;

type TrackRuntime = {
  el: HTMLAudioElement;
  /** 0 while faded out; 1 while audible. */
  fadeGain: number;
  fadeRaf: number;
  wantPlaying: boolean;
};

const tracks: Partial<Record<MusicTrackId, TrackRuntime>> = {};
let unlockBound = false;
let activeTrack: MusicTrackId | null = null;

function musicTargetVolume(fadeGain: number): number {
  return Math.min(1, getMusicOutputVolume() * MUSIC_BED * fadeGain);
}

function getTrack(id: MusicTrackId): TrackRuntime {
  let t = tracks[id];
  if (!t) {
    const el = new Audio();
    el.loop = true;
    el.preload = "auto";
    el.volume = 0;
    el.src = MUSIC_URLS[id];
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
  t.el.volume = musicTargetVolume(t.fadeGain);
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

async function tryPlay(id: MusicTrackId): Promise<void> {
  const t = getTrack(id);
  try {
    if (t.el.paused) await t.el.play();
    fadeFadeGain(t, 1);
  } catch {
    bindUnlockOnce();
  }
}

function stopTrack(id: MusicTrackId, opts?: { immediate?: boolean }) {
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

// Live volume changes from settings while music is up.
subscribeAudioSettings(() => {
  for (const t of Object.values(tracks)) {
    if (!t) continue;
    if (!t.wantPlaying && t.fadeGain <= 0.001) continue;
    applyVolume(t);
  }
});

async function preloadTrack(id: MusicTrackId): Promise<void> {
  const t = getTrack(id);
  if (t.el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;

  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed to load ${MUSIC_URLS[id]}`));
    };
    const cleanup = () => {
      t.el.removeEventListener("canplaythrough", onReady);
      t.el.removeEventListener("error", onError);
    };
    t.el.addEventListener("canplaythrough", onReady, { once: true });
    t.el.addEventListener("error", onError, { once: true });
    // Reload so replaced files (same URL) pick up after cache-busting hard refresh.
    t.el.load();
  });
}

/** Hub preload. */
export async function preloadVillageMusic(): Promise<void> {
  await preloadTrack("village");
}

/** Arena / PvP preload. */
export async function preloadArenaMusic(): Promise<void> {
  await preloadTrack("arena");
}

/**
 * Switch looping soundtrack. Pass `null` to fade everything out.
 * Crossfades when changing tracks.
 */
export function setMusicTrack(track: MusicTrackId | null): void {
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

/** @deprecated Prefer setMusicTrack("village") */
export function playVillageMusic(): void {
  setMusicTrack("village");
}

/** @deprecated Prefer setMusicTrack(null) */
export function stopVillageMusic(): void {
  setMusicTrack(null);
}
