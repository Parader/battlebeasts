import { useSyncExternalStore } from "react";
import {
  catalogCosmeticFit,
  getCosmeticItem,
  identityCosmeticFit,
  type CosmeticFit,
} from "@battlebeasts/shared";

const KEY = "bb-cosmetic-fit";

type Fits = Record<string, CosmeticFit>;

const listeners = new Set<() => void>();
let cacheRaw = "";
let cache: Fits = {};

function readFits(): Fits {
  try {
    const raw = sessionStorage.getItem(KEY) ?? "{}";
    if (raw === cacheRaw) return cache;
    cacheRaw = raw;
    cache = JSON.parse(raw) as Fits;
    return cache;
  } catch {
    cacheRaw = "{}";
    cache = {};
    return cache;
  }
}

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getFitOverride(id: string): CosmeticFit | null {
  return readFits()[id] ?? null;
}

export function setFitOverride(id: string, pose: CosmeticFit | null): void {
  const next = { ...readFits() };
  if (!pose) delete next[id];
  else next[id] = pose;
  const raw = JSON.stringify(next);
  sessionStorage.setItem(KEY, raw);
  cacheRaw = raw;
  cache = next;
  emit();
}

export function resolvedCosmeticFit(itemId: string): CosmeticFit {
  const def = getCosmeticItem(itemId);
  const base = def ? catalogCosmeticFit(def) : identityCosmeticFit();
  const over = getFitOverride(itemId);
  return over ?? base;
}

export function useResolvedCosmeticFit(itemId: string | null): CosmeticFit {
  const fits = useSyncExternalStore(subscribe, readFits, () => cache);
  if (!itemId) return identityCosmeticFit();
  const def = getCosmeticItem(itemId);
  const base = def ? catalogCosmeticFit(def) : identityCosmeticFit();
  return fits[itemId] ?? base;
}

export function useHasFitOverride(itemId: string | null): boolean {
  const fits = useSyncExternalStore(subscribe, readFits, () => cache);
  return Boolean(itemId && fits[itemId]);
}
