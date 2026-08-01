type Listener = (ready: boolean) => void;

let ready = false;
const listeners = new Set<Listener>();

export function isVfxGpuReady(): boolean {
  return ready;
}

/** Called after warmSpellMaterials compiles programs (or best-effort fails). */
export function markVfxGpuReady(): void {
  if (ready) return;
  ready = true;
  for (const fn of listeners) fn(true);
}

export function subscribeVfxGpuReady(fn: Listener): () => void {
  listeners.add(fn);
  fn(ready);
  return () => {
    listeners.delete(fn);
  };
}
