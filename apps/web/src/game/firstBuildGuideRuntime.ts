import type { StandKind } from "@battlebeasts/shared";

/**
 * Which hub stand the first-build checklist is pointing at.
 *
 * Kept out of React so the 3D scene can draw a beacon without threading
 * props through the canvas.
 */

type Listener = () => void;

let guideKind: StandKind | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) fn();
}

export function setFirstBuildGuide(kind: StandKind | null): void {
  if (guideKind === kind) return;
  guideKind = kind;
  emit();
}

export function getFirstBuildGuide(): StandKind | null {
  return guideKind;
}

export function subscribeFirstBuildGuide(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
