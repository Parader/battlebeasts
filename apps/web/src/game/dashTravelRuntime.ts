import { ABILITIES, travelProgress01 } from "@battlebeasts/shared";

/**
 * Remote dash interpolation driven by combat_fx (from → to over duration).
 * Local casters use LocalPredictor; observers otherwise snap on schema jumps.
 */

const SMOOTH_DASH_IDS = new Set([
  "bulwarkCharge",
  "verdantLeap",
  "rebound",
  "spiritForm",
  "smash",
  "dash",
  "bloodRush",
]);

type RemoteDashTravel = {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  startMs: number;
  durationMs: number;
  abilityId: string;
};

const bySession = new Map<string, RemoteDashTravel>();

export function beginRemoteDashTravel(
  sessionId: string,
  opts: {
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    durationMs: number;
    abilityId: string;
  },
): void {
  if (!sessionId || !SMOOTH_DASH_IDS.has(opts.abilityId)) return;
  const durationMs = Math.max(16, opts.durationMs);
  const dx = opts.toX - opts.fromX;
  const dz = opts.toZ - opts.fromZ;
  if (Math.hypot(dx, dz) < 0.12) return;
  bySession.set(sessionId, {
    fromX: opts.fromX,
    fromZ: opts.fromZ,
    toX: opts.toX,
    toZ: opts.toZ,
    startMs: performance.now(),
    durationMs,
    abilityId: opts.abilityId,
  });
}

export function sampleRemoteDashTravel(
  sessionId: string,
  now = performance.now(),
): { x: number; z: number } | null {
  const t = bySession.get(sessionId);
  if (!t) return null;
  const u = (now - t.startMs) / t.durationMs;
  if (u >= 1) {
    bySession.delete(sessionId);
    return { x: t.toX, z: t.toZ };
  }
  const linear = Math.max(0, u);
  const def = ABILITIES[t.abilityId];
  const p = def ? travelProgress01(def, linear) : linear;
  return {
    x: t.fromX + (t.toX - t.fromX) * p,
    z: t.fromZ + (t.toZ - t.fromZ) * p,
  };
}
