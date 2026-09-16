import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let bindPose = false;

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAdminBindPose(): boolean {
  return bindPose;
}

export function setAdminBindPose(on: boolean): void {
  const next = Boolean(on);
  if (next === bindPose) return;
  bindPose = next;
  emit();
}

export function useAdminBindPose(): boolean {
  return useSyncExternalStore(subscribe, getAdminBindPose, () => false);
}
