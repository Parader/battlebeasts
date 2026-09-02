import type { MapColliderSpec } from "@battlebeasts/shared";
import { useSyncExternalStore } from "react";

/**
 * Hand-corrected colliders, per prop model.
 *
 * The fitted default is a guess from the model's base slice. It is right for
 * most things and wrong in predictable ways -- a roof section whose lowest
 * slice is a thin bottom lip, an archway measured at its two feet. Correcting
 * one placement and then making the same correction on the next forty copies
 * is not work anyone should do twice.
 *
 * Keyed by prop key, so a fix applies to every copy of that model, in this map
 * and every other. Kept out of the manifest because `gen:props` rewrites that
 * file wholesale; this lives in `data/props.colliders.json` and is committed,
 * so the correction is shared rather than re-discovered.
 *
 * Writes are optimistic and debounced -- adjusting a radius means dragging a
 * number, and that should never feel like it is saving.
 */

const ENDPOINT = "/api/props/colliders";
const SAVE_DEBOUNCE_MS = 600;

class ColliderOverrideStore {
  private specs = new Map<string, MapColliderSpec>();
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
      const body = (await res.json()) as { colliders?: unknown };
      if (body.colliders && typeof body.colliders === "object") {
        for (const [key, spec] of Object.entries(body.colliders as Record<string, unknown>)) {
          if (spec && typeof spec === "object") this.specs.set(key, spec as MapColliderSpec);
        }
        this.emit();
      }
    } catch {
      // Offline or a dev-server hiccup: falling back to fitted defaults is
      // the same behaviour as before any correction was made.
    }
  }

  get(key: string): MapColliderSpec | undefined {
    return this.specs.get(key);
  }

  has(key: string): boolean {
    return this.specs.has(key);
  }

  get size(): number {
    return this.specs.size;
  }

  set(key: string, spec: MapColliderSpec): void {
    this.specs.set(key, spec);
    this.emit();
    this.queueSave();
  }

  /** Drop the correction, returning the model to its fitted default. */
  clear(key: string): void {
    if (!this.specs.delete(key)) return;
    this.emit();
    this.queueSave();
  }

  private queueSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void fetch(ENDPOINT, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ colliders: Object.fromEntries(this.specs) }),
      }).catch(() => {
        // Left in memory so the session stays usable; the next edit retries.
      });
    }, SAVE_DEBOUNCE_MS);
  }
}

export const colliderOverrides = new ColliderOverrideStore();

/** Re-renders when a correction changes. Returns a version for `useMemo` deps. */
export function useColliderOverrideVersion(): number {
  return useSyncExternalStore(colliderOverrides.subscribe, colliderOverrides.getVersion);
}
