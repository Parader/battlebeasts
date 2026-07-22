/** Server simulation rate (Hz). */
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

export const MOVE_SPEED = 5;

/** Battlerite-style fixed camera: high pitch looking down. */
export const CAMERA = {
  pitchDeg: 55,
  distance: 18,
  fov: 45,
  /** Soft follow of player (1/s). Lower = less shake when strafing. */
  followLambda: 2.2,
  /** Soft follow of cursor offset (1/s). Higher = snappier look-ahead. */
  cursorLambda: 6,
  /** Max look-ahead as fraction of half-screen (lower = more resistance). */
  cursorInfluence: 0.55,
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
/** After a successful reconnect, stay paused this long before match resumes (ms). */
export const RECONNECT_RESUME_GRACE_MS = 3_000;
