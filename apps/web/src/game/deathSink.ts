/** How far (world meters) to lower the avatar by the end of a death settle. */
export const DEATH_SINK_DEPTH = 0.72;

/** Fallback settle time when clip duration is unknown (~Flying Back Death). */
export const DEATH_SINK_FALLBACK_SEC = 3.0;

export type DeathSinkState = {
  startedAtMs: number;
  durationSec: number;
  depth: number;
};

export function startDeathSink(
  durationSec: number,
  nowMs = performance.now(),
  depth = DEATH_SINK_DEPTH,
): DeathSinkState {
  return {
    startedAtMs: nowMs,
    durationSec: Math.max(0.5, durationSec || DEATH_SINK_FALLBACK_SEC),
    depth,
  };
}

/** Ease-out cubic — fast drop early, soft settle onto the ground. */
function easeOutCubic(t: number): number {
  const u = 1 - Math.max(0, Math.min(1, t));
  return 1 - u * u * u;
}

/** Negative Y offset while dead; holds at full depth after the settle finishes. */
export function deathSinkOffsetY(sink: DeathSinkState | null, nowMs = performance.now()): number {
  if (!sink) return 0;
  const t = (nowMs - sink.startedAtMs) / (sink.durationSec * 1000);
  return -sink.depth * easeOutCubic(t);
}
