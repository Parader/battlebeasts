const STORAGE_KEY = "bb.audioSettings.v1";

export type AudioSettings = {
  /** 0–1 overall gain */
  master: number;
  /** 0–1 music bus (multiplied by master) */
  music: number;
  /** 0–1 ambient bed bus (multiplied by master) */
  ambiance: number;
  /** 0–1 SFX bus (multiplied by master) — combat / UI sounds */
  effects: number;
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: 1,
  music: 0.7,
  ambiance: 0.65,
  effects: 1,
};

type Listener = (next: AudioSettings) => void;

let settings: AudioSettings = loadSettings();
const listeners = new Set<Listener>();

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function normalize(partial: Partial<AudioSettings> | null | undefined): AudioSettings {
  return {
    master: clamp01(partial?.master ?? DEFAULT_AUDIO_SETTINGS.master),
    music: clamp01(partial?.music ?? DEFAULT_AUDIO_SETTINGS.music),
    ambiance: clamp01(partial?.ambiance ?? DEFAULT_AUDIO_SETTINGS.ambiance),
    effects: clamp01(partial?.effects ?? DEFAULT_AUDIO_SETTINGS.effects),
  };
}

function loadSettings(): AudioSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
    return normalize(JSON.parse(raw) as Partial<AudioSettings>);
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

function persist(next: AudioSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — keep in-memory only.
  }
}

function emit() {
  for (const fn of listeners) fn(settings);
}

export function getAudioSettings(): AudioSettings {
  return settings;
}

export function setAudioSettings(patch: Partial<AudioSettings>): AudioSettings {
  settings = normalize({ ...settings, ...patch });
  persist(settings);
  emit();
  return settings;
}

export function subscribeAudioSettings(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Final music output (master × music). */
export function getMusicOutputVolume(): number {
  return settings.master * settings.music;
}

/** Final ambiance output (master × ambiance). */
export function getAmbianceOutputVolume(): number {
  return settings.master * settings.ambiance;
}

/** Final SFX output (master × effects). */
export function getEffectOutputVolume(): number {
  return settings.master * settings.effects;
}
