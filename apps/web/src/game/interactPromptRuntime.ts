/** Imperative bus for the world-space interact prompt above the local player. */

export type InteractPrompt = { label: string } | null;

let current: InteractPrompt = null;
const listeners = new Set<() => void>();

export function setInteractPrompt(next: InteractPrompt) {
  const same = (current?.label ?? null) === (next?.label ?? null) && Boolean(current) === Boolean(next);
  if (same) return;
  current = next;
  for (const listener of listeners) listener();
}

export function getInteractPrompt(): InteractPrompt {
  return current;
}

export function subscribeInteractPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearInteractPrompt() {
  setInteractPrompt(null);
}
