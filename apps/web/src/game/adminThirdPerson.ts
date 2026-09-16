import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let thirdPerson = false;

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAdminThirdPerson(): boolean {
  return thirdPerson;
}

export function setAdminThirdPerson(on: boolean): void {
  const next = Boolean(on);
  if (next === thirdPerson) return;
  thirdPerson = next;
  emit();
}

export function useAdminThirdPerson(): boolean {
  return useSyncExternalStore(subscribe, getAdminThirdPerson, () => false);
}
