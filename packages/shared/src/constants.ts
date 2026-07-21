/** Server simulation rate (Hz). */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

export const MOVE_SPEED = 6;

/** Battlerite-style fixed camera: high pitch looking down. */
export const CAMERA = {
  pitchDeg: 55,
  distance: 18,
  fov: 45,
} as const;

export const ROOM = {
  BASE_CITY: "base_city",
  ARENA: "arena",
  BATTLEGROUND: "battleground",
  DUNGEON: "dungeon",
  BOSS: "boss",
} as const;

export const PORTAL = {
  PVP: "pvp",
  PVE: "pve",
} as const;

export const INTERACT = {
  STAND_CUSTOMIZATION: "stand_customization",
  STAND_BUILD: "stand_build",
  STAND_TALENT: "stand_talent",
  STAND_SHOP: "stand_shop",
  PORTAL_PVP: "portal_pvp",
  PORTAL_PVE: "portal_pve",
  PRACTICE_DUMMY: "practice_dummy",
} as const;

/** PvP disconnect grace before forfeit (ms). */
export const PVP_RECONNECT_GRACE_MS = 45_000;
/** PvE disconnect grace before rebalance (ms). */
export const PVE_RECONNECT_GRACE_MS = 90_000;
