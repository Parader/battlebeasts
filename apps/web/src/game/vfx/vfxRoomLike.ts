/**
 * Structural room shape consumed by combat VFX.
 *
 * Colyseus `Room` satisfies this. The spell VFX lab feeds a local sim with
 * the same `.get()` / `.forEach()` maps so engines and projectile meshes run
 * without a network room.
 */
export type VfxMapLike<T = unknown> = {
  get: (id: string) => T | undefined;
  forEach: (fn: (value: T, key: string) => void) => void;
};

export type VfxActorLike = {
  x?: number;
  z?: number;
  yaw?: number;
  kind?: string;
  castPhase?: string;
  castAbilityId?: string;
  castPhaseEndsAt?: number;
  castComboHit?: number;
  disconnected?: boolean;
  id?: string;
  role?: string;
};

export type VfxProjectileLike = {
  x: number;
  z: number;
  vx?: number;
  vz?: number;
  abilityId?: string;
  ownerSessionId?: string;
};

export type VfxWorldState = {
  players?: VfxMapLike<VfxActorLike>;
  targets?: VfxMapLike<VfxActorLike>;
  projectiles?: VfxMapLike<VfxProjectileLike>;
  volcanoes?: VfxMapLike<unknown>;
  rockWalls?: VfxMapLike<unknown>;
  worldTrees?: VfxMapLike<unknown>;
  protectionBubbles?: VfxMapLike<unknown>;
  orbitingWisps?: VfxMapLike<unknown>;
  astralChains?: VfxMapLike<unknown>;
  soulSevers?: VfxMapLike<unknown>;
  riftPortals?: VfxMapLike<unknown>;
  shrooms?: VfxMapLike<unknown>;
  spiritHusks?: VfxMapLike<unknown>;
  pickups?: VfxMapLike<unknown>;
  decoys?: VfxMapLike<unknown>;
  spellbreakerProjectiles?: VfxMapLike<unknown>;
};

export type VfxRoomLike = {
  roomId?: string;
  state?: VfxWorldState;
  /** Lab-only: notify map-key hooks without Colyseus schema callbacks. */
  subscribeMaps?: (fn: () => void) => () => void;
};
