type Listener = (ready: boolean) => void;

let ready = false;
const listeners = new Set<Listener>();

export function isPropShaderReady(): boolean {
  return ready;
}

export function markPropShaderReady(): void {
  if (ready) return;
  ready = true;
  for (const fn of listeners) fn(true);
}

export function resetPropShaderReady(): void {
  if (!ready) return;
  ready = false;
  for (const fn of listeners) fn(false);
}

export function subscribePropShaderReady(fn: Listener): () => void {
  listeners.add(fn);
  fn(ready);
  return () => {
    listeners.delete(fn);
  };
}

/** Fail-open or maps with nothing to compile. */
export function skipPropShaderReady(): void {
  markPropShaderReady();
}
