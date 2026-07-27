import type * as THREE from "three";

/** SessionId → character scene root (local + remotes) for bone-follow VFX. */
const roots = new Map<string, THREE.Object3D>();

export function registerCharacterRoot(sessionId: string, root: THREE.Object3D | null) {
  if (!root) {
    roots.delete(sessionId);
    return;
  }
  roots.set(sessionId, root);
}

export function getCharacterRoot(sessionId: string | null | undefined): THREE.Object3D | null {
  if (!sessionId) return null;
  return roots.get(sessionId) ?? null;
}
