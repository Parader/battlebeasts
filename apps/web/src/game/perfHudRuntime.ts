/** Hitch threshold used by the F9 overlay and the VFX lab inspector. */
export const SPIKE_MS = 33;

export type PerfSample = {
  fps: number;
  avgMs: number;
  p95Ms: number;
  worstMs: number;
  spikes: number;
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  peakMs: number;
  peakCalls: number;
  newPrograms: number;
};

export type PerfExtraLine = { label: string; value: string; warn?: boolean };

const EMPTY: PerfSample = {
  fps: 0,
  avgMs: 0,
  p95Ms: 0,
  worstMs: 0,
  spikes: 0,
  calls: 0,
  triangles: 0,
  programs: 0,
  geometries: 0,
  textures: 0,
  peakMs: 0,
  peakCalls: 0,
  newPrograms: 0,
};

let latest: PerfSample = EMPTY;
let overlayOn = false;
let samplingOn = false;
let extraLine: PerfExtraLine | null = null;

const dataListeners = new Set<() => void>();
const toggleListeners = new Set<() => void>();

function emitToggle(): void {
  for (const l of toggleListeners) l();
  for (const l of dataListeners) l();
}

export function samplingActive(): boolean {
  return overlayOn || samplingOn;
}

export function isOverlayOn(): boolean {
  return overlayOn;
}

export function getExtraLine(): PerfExtraLine | null {
  return extraLine;
}

export function setLatestSample(sample: PerfSample): void {
  latest = sample;
  for (const l of dataListeners) l();
}

export function setOverlayEnabled(next: boolean): void {
  overlayOn = next;
  if (!samplingActive()) latest = EMPTY;
  emitToggle();
}

export function subscribePerfToggle(fn: () => void): () => void {
  toggleListeners.add(fn);
  return () => void toggleListeners.delete(fn);
}

/** Lab-only HUD row (live one-shot count). Polls with the overlay, not 60Hz React. */
export function setPerfExtraLine(line: PerfExtraLine | null): void {
  extraLine = line;
}

/** Keep sampling without showing the F9 overlay (Spell VFX Lab). */
export function setPerfSampling(on: boolean): void {
  samplingOn = on;
  if (!samplingActive()) latest = EMPTY;
  emitToggle();
}

export function getPerfLatest(): PerfSample {
  return latest;
}

export function subscribePerfData(fn: () => void): () => void {
  dataListeners.add(fn);
  return () => void dataListeners.delete(fn);
}
