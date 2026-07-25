import { ROOM } from "./constants";

export type PvpModeId = "arena_1v1" | "arena_2v2" | "arena_3v3" | "battleground";
export type PveContentId = "dungeon" | "boss";

export type PvpSeat = "teamA" | "teamB" | "spectator";

export const PVP_MODES: readonly {
  id: PvpModeId;
  label: string;
  room: (typeof ROOM)[keyof typeof ROOM];
  /** Fighters per team. */
  teamSize: number;
  /** Pre-match spectator bench capacity. */
  maxSpectators: number;
  /** Shown in portal UI for this milestone. */
  enabled: boolean;
}[] = [
  {
    id: "arena_1v1",
    label: "Arena 1v1",
    room: ROOM.ARENA,
    teamSize: 1,
    maxSpectators: 2,
    enabled: true,
  },
  {
    id: "arena_2v2",
    label: "Arena 2v2",
    room: ROOM.ARENA,
    teamSize: 2,
    maxSpectators: 2,
    enabled: true,
  },
  {
    id: "arena_3v3",
    label: "Arena 3v3",
    room: ROOM.ARENA,
    teamSize: 3,
    maxSpectators: 2,
    enabled: true,
  },
  {
    id: "battleground",
    label: "Battleground",
    room: ROOM.BATTLEGROUND,
    teamSize: 8,
    maxSpectators: 2,
    enabled: false,
  },
] as const;

/** Modes selectable in the PvP portal. */
export const PVP_PORTAL_MODES = PVP_MODES.filter((m) => m.enabled);

export function pvpModeCapacity(modeId: string): number {
  const mode = PVP_MODES.find((m) => m.id === modeId);
  if (!mode) return 0;
  return mode.teamSize * 2 + mode.maxSpectators;
}

export function pvpModeFitsPlayerCount(modeId: string, playerCount: number): boolean {
  return pvpModeCapacity(modeId) >= playerCount;
}

export const PVE_CONTENTS: readonly {
  id: PveContentId;
  label: string;
  room: (typeof ROOM)[keyof typeof ROOM];
  description: string;
}[] = [
  { id: "dungeon", label: "Dungeon", room: ROOM.DUNGEON, description: "Short coop instance stub" },
  { id: "boss", label: "Boss", room: ROOM.BOSS, description: "Single encounter stub" },
] as const;

export const PVE_MODIFIERS: readonly { id: string; label: string }[] = [
  { id: "hard", label: "Hard" },
  { id: "no_death", label: "No deaths" },
] as const;

/** Round countdown before fighting (ms). */
export const ARENA_ROUND_COUNTDOWN_MS = 3000;
/** Beat between rounds (ms) — long enough to read the kill / death pose. */
export const ARENA_ROUND_END_MS = 4500;
/** First team to this many round wins takes the match. */
export const ARENA_ROUNDS_TO_WIN = 3;

export type ArenaMatchPhase =
  | "countdown"
  | "fighting"
  | "round_end"
  | "match_end"
  | "rematch_wait";

export function resolvePvpTransfer(modeId: string): { room: string; mode: PvpModeId } {
  const mode = PVP_MODES.find((m) => m.id === modeId) ?? PVP_PORTAL_MODES[0] ?? PVP_MODES[0];
  return { room: mode.room, mode: mode.id };
}

export function resolvePveTransfer(contentId: string): { room: string; mode: PveContentId } {
  const content = PVE_CONTENTS.find((c) => c.id === contentId) ?? PVE_CONTENTS[0];
  return { room: content.room, mode: content.id };
}
