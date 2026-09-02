import { useSyncExternalStore } from "react";

/**
 * Props marked unusable: too small to read at gameplay camera distance,
 * wrongly centred, or otherwise broken.
 *
 * Kept out of the manifest because `pnpm gen:props` rewrites that file
 * wholesale. This list lives in `data/props.unusable.json`, is committed, and
 * is shared by everyone working on maps -- a prop you find useless once should
 * stay out of your way, and out of everyone else's.
 *
 * Writes are optimistic and debounced: marking is a rapid, exploratory action
 * and should never feel like it is saving.
 */

const ENDPOINT = "/api/props/unusable";
const SAVE_DEBOUNCE_MS = 600;

class UnusableStore {
  private keys = new Set<string>();
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  /** Bumped on every change so `useSyncExternalStore` sees a new snapshot. */
  private version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { keys?: unknown };
      if (Array.isArray(body.keys)) {
        this.keys = new Set(body.keys.filter((k): k is string => typeof k === "string"));
        this.emit();
      }
    } catch {
      // Offline or a dev-server hiccup: an empty list just shows everything.
    }
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  get size(): number {
    return this.keys.size;
  }

  /** Mark or unmark a set of keys together, as one save. */
  set(keys: readonly string[], unusable: boolean): void {
    let changed = false;
    for (const k of keys) {
      if (unusable ? this.keys.has(k) : !this.keys.has(k)) continue;
      if (unusable) this.keys.add(k);
      else this.keys.delete(k);
      changed = true;
    }
    if (!changed) return;
    this.emit();
    this.queueSave();
  }

  toggle(key: string): void {
    this.set([key], !this.keys.has(key));
  }

  private queueSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void fetch(ENDPOINT, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: [...this.keys] }),
      }).catch(() => {
        // Left in memory so the session stays usable; the next edit retries.
      });
    }, SAVE_DEBOUNCE_MS);
  }
}

export const unusable = new UnusableStore();

/**
 * Re-renders when the unusable set changes, and returns a version number.
 *
 * Returning the version rather than the store means it can also be used as a
 * `useMemo` dependency, which is what the palette needs -- a mutable store
 * instance never changes identity and would not invalidate the tree.
 */
export function useUnusableVersion(): number {
  return useSyncExternalStore(unusable.subscribe, unusable.getVersion);
}
