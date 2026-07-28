import type { VfxHandle } from "../types";

export type PendingMuzzle = {
  abilityId: string;
  fireAt: number;
};

/** Per-player cast VFX bookkeeping — one lookup instead of N Maps. */
export type PlayerVfxRuntime = {
  lastPhase: string;
  handles: Map<string, VfxHandle>;
  pendingMuzzle?: PendingMuzzle;
  firedMuzzle: boolean;
};

const playerRuntime = new Map<string, PlayerVfxRuntime>();

export function getPlayerVfxRuntime(sessionId: string): PlayerVfxRuntime {
  let runtime = playerRuntime.get(sessionId);
  if (!runtime) {
    runtime = {
      lastPhase: "",
      handles: new Map(),
      firedMuzzle: false,
    };
    playerRuntime.set(sessionId, runtime);
  }
  return runtime;
}

export function setHandle(
  sessionId: string,
  key: string,
  handle: VfxHandle,
): void {
  const runtime = getPlayerVfxRuntime(sessionId);
  runtime.handles.get(key)?.cancel();
  runtime.handles.set(key, handle);
}

export function clearHandle(sessionId: string, key: string, cancel = false): void {
  const runtime = playerRuntime.get(sessionId);
  if (!runtime) return;
  if (cancel) runtime.handles.get(key)?.cancel();
  runtime.handles.delete(key);
}

export function hasHandle(sessionId: string, key: string): boolean {
  return playerRuntime.get(sessionId)?.handles.has(key) ?? false;
}

/** Cancel all cast handles for a player (abort / disconnect). */
export function cancelPlayerCastHandles(sessionId: string): void {
  const runtime = playerRuntime.get(sessionId);
  if (!runtime) return;
  for (const handle of runtime.handles.values()) handle.cancel();
  runtime.handles.clear();
  runtime.pendingMuzzle = undefined;
  runtime.firedMuzzle = false;
}

export function cleanupPlayerVfx(sessionId: string): void {
  cancelPlayerCastHandles(sessionId);
  playerRuntime.delete(sessionId);
}

export function forEachPlayerVfxRuntime(
  fn: (sessionId: string, runtime: PlayerVfxRuntime) => void,
): void {
  for (const [id, runtime] of playerRuntime) fn(id, runtime);
}
