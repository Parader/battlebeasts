import type { Object3D } from "three";

/** Map props, baked scenery, and player-made walls that can hide a body. */
const occluders = new Set<Object3D>();

export function registerOccluder(obj: Object3D | null | undefined) {
  if (!obj) return;
  occluders.add(obj);
}

export function unregisterOccluder(obj: Object3D | null | undefined) {
  if (!obj) return;
  occluders.delete(obj);
}

export function listOccluders(): Object3D[] {
  if (occluders.size === 0) return EMPTY;
  return [...occluders];
}

const EMPTY: Object3D[] = [];
