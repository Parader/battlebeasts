import { ROOM } from "./constants";

export type PvpModeId =
  | "arena_1v1"
  | "arena_1v1v1"
  | "arena_2v2"
  | "arena_3v3"
  | "battleground";
export type PveContentId = "dungeon" | "boss";

export type PvpSeat = "teamA" | "teamB" | "teamC" | "spectator";

/** Hub party lobby kind — PvP arenas vs coop Wave Assault. */
export type PartyKind = "pvp" | "coop_pve";

/** Max fighters in a coop PvE Wave Assault party / dungeon room. */
export const COOP_PVE_MAX_PLAYERS = 4;

export const PVP_MODES: readonly {
  id: PvpModeId;
  label: string;
  room: (typeof ROOM)[keyof typeof ROOM];
  /** Fighters per team (FFA trios still use 1). */
  teamSize: number;
  /**
   * Number of opposing sides in the match.
   * Classic arenas = 2 (A vs B). `arena_1v1v1` = 3 (A vs B vs C).
   */
  teamCount: number;
  /** Pre-match spectator bench capacity. */
  maxSpectators: number;
  /** Shown in portal UI for this milestone. */
  enabled: boolean;
  /** Full premade only — no open matchmaking queue (Start Ranked / Unranked still OK). */
  noQueue?: boolean;
  /**
   * Map registry id. Points at either a baked GLB map or an editor document --
   * the server and client both resolve it through the registry, so pointing a
   * mode at a new map is a one-word change here.
   */
  mapId: string;
}[] = [
  {
    id: "arena_1v1",
    label: "Arena 1v1",
    room: ROOM.ARENA,
    teamSize: 1,
    teamCount: 2,
    maxSpectators: 2,
    enabled: true,
    mapId: "test_arena",
  },
  {
    id: "arena_1v1v1",
    label: "Arena 1v1v1",
    room: ROOM.ARENA,
    teamSize: 1,
    teamCount: 3,
    maxSpectators: 1,
    enabled: true,
    mapId: "desert",
  },
  {
    id: "arena_2v2",
    label: "Arena 2v2",
    room: ROOM.ARENA,
    teamSize: 2,
    teamCount: 2,
    maxSpectators: 2,
    enabled: true,
    mapId: "desert",
  },
  {
    id: "arena_3v3",
    label: "Arena 3v3",
    room: ROOM.ARENA,
    teamSize: 3,
    teamCount: 2,
    maxSpectators: 2,
    enabled: true,
    mapId: "desert",
  },
  {
    id: "battleground",
    label: "Battleground",
    room: ROOM.BATTLEGROUND,
    teamSize: 8,
    teamCount: 2,
    maxSpectators: 2,
    enabled: false,
    mapId: "desert",
  },
] as const;

/** Modes selectable in the PvP portal. */
export const PVP_PORTAL_MODES = PVP_MODES.filter((m) => m.enabled);

/** True for three-solo FFA (Arena 1v1v1). */
export function isPvpFfaTriosMode(modeId: string | undefined | null): boolean {
  return modeId === "arena_1v1v1";
}

export function pvpModeCapacity(modeId: string): number {
  const mode = PVP_MODES.find((m) => m.id === modeId);
  if (!mode) return 0;
  return mode.teamSize * mode.teamCount + mode.maxSpectators;
}

/** Fighter slots required to start (full premade / match begin). */
export function pvpModeFighterCount(modeId: string): number {
  const mode = PVP_MODES.find((m) => m.id === modeId);
  if (!mode) return 0;
  return mode.teamSize * mode.teamCount;
}

export function pvpModeFitsPlayerCount(modeId: string, playerCount: number): boolean {
  return pvpModeCapacity(modeId) >= playerCount;
}

export const PVE_CONTENTS: readonly {
  id: PveContentId;
  label: string;
  room: (typeof ROOM)[keyof typeof ROOM];
  description: string;
  enabled: boolean;
  /** Map registry id; see the note on PVP_MODES.mapId. */
  mapId: string;
}[] = [
  {
    id: "dungeon",
    label: "Wave Assault",
    room: ROOM.DUNGEON,
    description: "Cemetery waves — survive escalating zombies",
    enabled: true,
    mapId: "cemetery",
  },
  {
    id: "boss",
    label: "Boss",
    room: ROOM.BOSS,
    description: "Single encounter (coming soon)",
    enabled: false,
    mapId: "cemetery",
  },
] as const;

/** Modes selectable in the PvE portal. */
export const PVE_PORTAL_CONTENTS = PVE_CONTENTS.filter((c) => c.enabled);

export const PVE_MODIFIERS: readonly { id: string; label: string }[] = [
  { id: "hard", label: "Hard" },
  { id: "no_death", label: "No deaths" },
] as const;

/** Round countdown before fighting (ms). */
export const ARENA_ROUND_COUNTDOWN_MS = 3000;
/** After last living fighter on a team dies — emote window before round_end. */
export const ARENA_WIPE_EMOTE_MS = 4000;
/** Beat between rounds (ms) — celebrate / emote window before the next countdown. */
export const ARENA_ROUND_END_MS = 5000;
/** First team to this many round wins takes the match. */
export const ARENA_ROUNDS_TO_WIN = 3;

export type ArenaMatchPhase =
  | "countdown"
  | "fighting"
  | "round_end"
  | "match_end"
  | "rematch_wait";

/**
 * Admin map preview rooms carry their map in the mode id itself, as
 * `sandbox:<mapId>`.
 *
 * Every system that needs to know which map it is in -- server colliders and
 * spawns, client prediction, client rendering -- already routes through
 * `mapIdForMode`. Encoding the map in the mode means a preview room needs no
 * new option threaded through join options, room metadata, schema and the
 * React tree; it just names a map no fixed mode owns.
 */
export const SANDBOX_MODE_PREFIX = "sandbox:";

export function sandboxModeFor(mapId: string): string {
  return `${SANDBOX_MODE_PREFIX}${mapId}`;
}

/** Map id of a sandbox mode, or undefined for any normal mode. */
export function sandboxMapId(mode: string | null | undefined): string | undefined {
  if (!mode?.startsWith(SANDBOX_MODE_PREFIX)) return undefined;
  return mode.slice(SANDBOX_MODE_PREFIX.length) || undefined;
}

/**
 * Registry map id for a room mode, PvP or PvE. Returns undefined for modes
 * with no map (the hub, stubs), which callers treat as "no static geometry".
 */
export function mapIdForMode(mode: string | null | undefined): string | undefined {
  if (!mode) return undefined;
  const sandbox = sandboxMapId(mode);
  if (sandbox) return sandbox;
  return (
    PVP_MODES.find((m) => m.id === mode)?.mapId ??
    PVE_CONTENTS.find((c) => c.id === mode)?.mapId
  );
}

export function resolvePvpTransfer(modeId: string): { room: string; mode: PvpModeId } {
  const mode = PVP_MODES.find((m) => m.id === modeId) ?? PVP_PORTAL_MODES[0] ?? PVP_MODES[0];
  return { room: mode.room, mode: mode.id };
}

export function resolvePveTransfer(contentId: string): { room: string; mode: PveContentId } {
  const content = PVE_CONTENTS.find((c) => c.id === contentId) ?? PVE_CONTENTS[0];
  return { room: content.room, mode: content.id };
}
