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

type PoseMap = { get: (id: string) => unknown };

/** Player first, then world target (elites / dummies). */
export function getCombatOwnerPose(
  room: { state?: { players?: PoseMap; targets?: PoseMap } } | null | undefined,
  ownerId: string | null | undefined,
): { x?: number; z?: number; yaw?: number } | undefined {
  if (!ownerId || !room?.state) return undefined;
  const player = room.state.players?.get(ownerId) as
    | { x?: number; z?: number; yaw?: number }
    | undefined;
  if (player) return player;
  return room.state.targets?.get(ownerId) as
    | { x?: number; z?: number; yaw?: number }
    | undefined;
}
