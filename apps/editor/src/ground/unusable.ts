import { useSyncExternalStore } from "react";

/**
 * Ground materials marked unusable in the picker: look wrong at gameplay
 * camera distance, too noisy, or just not useful for the maps we make.
 *
 * Shared via `data/ground.unusable.json` so one author's cull helps everyone.
 * The catalog stays complete -- maps that already reference a hidden id still
 * resolve it at runtime; it only drops out of the layer dropdown.
 *
 * Writes are optimistic and debounced: marking is exploratory and should
 * never feel like it is saving.
 */

const ENDPOINT = "/api/ground/unusable";
const SAVE_DEBOUNCE_MS = 600;

class GroundUnusableStore {
  private keys = new Set<string>();
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
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
      // Offline: show the full catalog.
    }
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  get size(): number {
    return this.keys.size;
  }

  /** Snapshot for filtering pickers. */
  asSet(): ReadonlySet<string> {
    return this.keys;
  }

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
        // Left in memory; the next edit retries.
      });
    }, SAVE_DEBOUNCE_MS);
  }
}

export const groundUnusable = new GroundUnusableStore();

export function useGroundUnusableVersion(): number {
  return useSyncExternalStore(groundUnusable.subscribe, groundUnusable.getVersion);
}
