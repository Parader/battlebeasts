import { tileIndexAt, type GroundTileLayout } from "@battlebeasts/shared";
import { useSyncExternalStore } from "react";

/**
 * Orbit target of the editor camera, quantised to a ground tile.
 *
 * The viewport only builds meshes for the neighbourhood around this point.
 * Panning inside one tile does not rebuild anything.
 */

type Focus = { x: number; z: number; tx: number; tz: number };

let focus: Focus = { x: 0, z: 0, tx: 0, tz: 0 };
let layout: GroundTileLayout | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function bindEditorLayout(next: GroundTileLayout | null) {
  layout = next;
  publish(focus.x, focus.z, true);
}

export function setEditorFocus(x: number, z: number) {
  publish(x, z, false);
}

function publish(x: number, z: number, force: boolean) {
  const tx = layout ? tileIndexAt(layout.sizeX, layout.tilesX, x) : 0;
  const tz = layout ? tileIndexAt(layout.sizeZ, layout.tilesZ, z) : 0;
  if (!force && tx === focus.tx && tz === focus.tz) return;
  focus = { x, z, tx, tz };
  emit();
}

export function getEditorFocus(): Focus {
  return focus;
}

export function useEditorFocus(): Focus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => focus,
  );
}
