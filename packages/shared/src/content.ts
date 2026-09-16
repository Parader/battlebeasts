import { ROOM } from "./constants";
import { listMaps } from "./maps/registry";

export type PvpFamily = "skirmish" | "battleground";

export type PvpModeId =
  | "arena_1v1"
  | "arena_1v1v1"
  | "arena_2v2"
  | "arena_3v3"
  | "battleground"
  | "bg_ctf"
  | "bg_koth"
  | "bg_domination";

export type PveContentId = "dungeon" | "boss";

export type PvpSeat = "teamA" | "teamB" | "teamC" | "spectator";

/** Hub party lobby kind — PvP arenas vs coop Wave Assault. */
export type PartyKind = "pvp" | "coop_pve";

/** Max fighters in a coop PvE Wave Assault party / dungeon room. */
export const COOP_PVE_MAX_PLAYERS = 4;

export const PVP_FAMILY_TOKEN_PREFIX = "family:";

export function pvpFamilyToken(family: PvpFamily): string {
  return `${PVP_FAMILY_TOKEN_PREFIX}${family}`;
}

export function parsePvpFamilyToken(value: string | undefined | null): PvpFamily | null {
  if (value === "family:skirmish" || value === "skirmish") return "skirmish";
  if (value === "family:battleground" || value === "battleground") return "battleground";
  return null;
}

export type PvpModeDef = {
  id: PvpModeId;
  label: string;
  family: PvpFamily;
  room: (typeof ROOM)[keyof typeof ROOM];
  /** Preferred fighters per team. */
  teamSize: number;
  /** Smallest legal side for flexible fill (skirmish: same as teamSize). */
  teamSizeMin: number;
  /** Largest legal side for flexible fill. */
  teamSizeMax: number;
  teamCount: number;
  maxSpectators: number;
  enabled: boolean;
  noQueue?: boolean;
  mapId: string;
};

export const PVP_FAMILIES: readonly {
  id: PvpFamily;
  label: string;
  description: string;
}[] = [
  {
    id: "skirmish",
    label: "Skirmish",
    description: "Round-based arenas. Matchmaking picks 1v1, 2v2, or 3v3. Custom matches can also be 1v1v1.",
  },
  {
    id: "battleground",
    label: "Battleground",
    description: "Objective matches — Capture the Flag, King of the Hill, or Domination.",
  },
];

export const PVP_MODES: readonly PvpModeDef[] = [
  {
    id: "arena_1v1",
    label: "Skirmish 1v1",
    family: "skirmish",
    room: ROOM.ARENA,
    teamSize: 1,
    teamSizeMin: 1,
    teamSizeMax: 1,
    teamCount: 2,
    maxSpectators: 2,
    enabled: true,
    mapId: "test_arena",
  },
  {
    id: "arena_1v1v1",
    label: "Skirmish 1v1v1",
    family: "skirmish",
    room: ROOM.ARENA,
    teamSize: 1,
    teamSizeMin: 1,
    teamSizeMax: 1,
    teamCount: 3,
    maxSpectators: 1,
    enabled: true,
    mapId: "test_arena",
  },
  {
    id: "arena_2v2",
    label: "Skirmish 2v2",
    family: "skirmish",
    room: ROOM.ARENA,
    teamSize: 2,
    teamSizeMin: 2,
    teamSizeMax: 2,
    teamCount: 2,
    maxSpectators: 2,
    enabled: true,
    mapId: "test_arena",
  },
  {
    id: "arena_3v3",
    label: "Skirmish 3v3",
    family: "skirmish",
    room: ROOM.ARENA,
    teamSize: 3,
    teamSizeMin: 3,
    teamSizeMax: 3,
    teamCount: 2,
    maxSpectators: 2,
    enabled: true,
    mapId: "test_arena",
  },
  {
    id: "battleground",
    label: "Battleground",
    family: "battleground",
    room: ROOM.BATTLEGROUND,
    teamSize: 4,
    teamSizeMin: 2,
    teamSizeMax: 5,
    teamCount: 2,
    maxSpectators: 2,
    enabled: false,
    mapId: "desert",
  },
  {
    id: "bg_ctf",
    label: "Capture the Flag",
    family: "battleground",
    room: ROOM.BATTLEGROUND,
    teamSize: 4,
    teamSizeMin: 2,
    teamSizeMax: 5,
    teamCount: 2,
    maxSpectators: 2,
    enabled: true,
    mapId: "desert",
  },
  {
    id: "bg_koth",
    label: "King of the Hill",
    family: "battleground",
    room: ROOM.BATTLEGROUND,
    teamSize: 4,
    teamSizeMin: 2,
    teamSizeMax: 5,
    teamCount: 2,
    maxSpectators: 2,
    enabled: true,
    mapId: "desert",
  },
  {
    id: "bg_domination",
    label: "Domination",
    family: "battleground",
    room: ROOM.BATTLEGROUND,
    teamSize: 4,
    teamSizeMin: 2,
    teamSizeMax: 5,
    teamCount: 2,
    maxSpectators: 2,
    enabled: true,
    mapId: "desert",
  },
];

/** Modes selectable in the PvP portal (legacy size list — prefer PVP_FAMILIES). */
export const PVP_PORTAL_MODES = PVP_MODES.filter((m) => m.enabled && m.family === "skirmish");

export const BATTLEGROUND_MODE_IDS = ["bg_ctf", "bg_koth", "bg_domination"] as const;

export const QUEUE_DOWNSIZE_WAIT_MS = 45_000;

export const BG_MATCH_DURATION_MS = 8 * 60 * 1000;
export const BG_CTF_CAPTURES_TO_WIN = 3;
export const BG_KOTH_SCORE_TO_WIN = 100;
export const BG_DOMINATION_SCORE_TO_WIN = 150;
export const BG_RESPAWN_MS = 8000;
export const BG_FLAG_RETURN_MS = 8000;
export const BG_CAPTURE_MS = 4000;
export const BG_SCORE_TICK_MS = 1000;

/** True for three-solo FFA (legacy Arena 1v1v1). */
export function isPvpFfaTriosMode(modeId: string | undefined | null): boolean {
  return modeId === "arena_1v1v1";
}

export function isBattlegroundMode(modeId: string | undefined | null): boolean {
  return (
    modeId === "bg_ctf" ||
    modeId === "bg_koth" ||
    modeId === "bg_domination" ||
    modeId === "battleground"
  );
}

export function pvpModeById(modeId: string | undefined | null): PvpModeDef | undefined {
  if (!modeId) return undefined;
  return PVP_MODES.find((m) => m.id === modeId);
}

export function pvpModesForFamily(family: PvpFamily): PvpModeDef[] {
  return PVP_MODES.filter((m) => m.family === family && m.enabled);
}

export function pvpFamilyOfMode(modeId: string | undefined | null): PvpFamily | null {
  const parsed = parsePvpFamilyToken(modeId);
  if (parsed) return parsed;
  return pvpModeById(modeId)?.family ?? null;
}

/** Family stored on a party (`family:skirmish` token or a concrete mode id). */
export function pvpFamilyFromModes(modes: readonly string[] | undefined | null): PvpFamily {
  for (const id of modes ?? []) {
    const family = pvpFamilyOfMode(id);
    if (family) return family;
  }
  return "skirmish";
}

export function pvpModeCapacity(modeId: string): number {
  const mode = pvpModeById(modeId);
  if (!mode) return 0;
  return mode.teamSizeMax * mode.teamCount + mode.maxSpectators;
}

/** Fighter slots for the preferred team size. */
export function pvpModeFighterCount(modeId: string): number {
  const mode = pvpModeById(modeId);
  if (!mode) return 0;
  return mode.teamSize * mode.teamCount;
}

export function pvpModeFitsPlayerCount(modeId: string, playerCount: number): boolean {
  return pvpModeCapacity(modeId) >= playerCount;
}

export function pvpFamilyCapacity(family: PvpFamily): number {
  let max = 0;
  for (const mode of pvpModesForFamily(family)) {
    max = Math.max(max, mode.teamSizeMax * mode.teamCount + mode.maxSpectators);
  }
  return max;
}

export function pvpFamilyFitsPlayerCount(family: PvpFamily, playerCount: number): boolean {
  return pvpFamilyCapacity(family) >= playerCount;
}

/** Two-team side sizes, largest first. */
export function pvpFamilyTeamSizes(family: PvpFamily): number[] {
  if (family === "battleground") return [5, 4, 3, 2];
  return [3, 2, 1];
}

export function pvpFamilyFighterCap(family: PvpFamily): number {
  if (family === "battleground") return 10;
  return 6;
}

export function pvpFamilyMaxSpectators(family: PvpFamily): number {
  return 2;
}

export function skirmishModeForTeamSize(teamSize: number): PvpModeId {
  if (teamSize >= 3) return "arena_3v3";
  if (teamSize >= 2) return "arena_2v2";
  return "arena_1v1";
}

export function resolvePremadeSkirmishMode(
  teamA: number,
  teamB: number,
  teamC = 0,
): PvpModeId | null {
  if (teamA === 1 && teamB === 1 && teamC === 1) return "arena_1v1v1";
  if (teamC > 0) return null;
  if (teamA < 1 || teamA !== teamB) return null;
  if (teamA > 3) return null;
  return skirmishModeForTeamSize(teamA);
}

export function resolvePremadeBattlegroundSize(teamA: number, teamB: number): number | null {
  if (teamA < 2 || teamA > 5 || teamA !== teamB) return null;
  return teamA;
}

export function formatTeamSizeLabel(teamSize: number): string {
  return `${teamSize}v${teamSize}`;
}

export const PVE_CONTENTS: readonly {
  id: PveContentId;
  label: string;
  room: (typeof ROOM)[keyof typeof ROOM];
  description: string;
  enabled: boolean;
  mapId: string;
}[] = [
  {
    id: "dungeon",
    label: "Wave Assault",
    room: ROOM.DUNGEON,
    description: "Infinite waves — survive escalating enemies",
    enabled: true,
    mapId: "pve_infinite_waves_1",
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

export const PVE_PORTAL_CONTENTS = PVE_CONTENTS.filter((c) => c.enabled);

export const PVE_MODIFIERS: readonly { id: string; label: string }[] = [
  { id: "hard", label: "Hard" },
  { id: "no_death", label: "No deaths" },
] as const;

export const ARENA_ROUND_COUNTDOWN_MS = 3000;
export const ARENA_WIPE_EMOTE_MS = 4000;
export const ARENA_ROUND_END_MS = 5000;
export const ARENA_ROUNDS_TO_WIN = 3;

export type ArenaMatchPhase =
  | "countdown"
  | "fighting"
  | "round_end"
  | "match_end"
  | "rematch_wait";

export const SANDBOX_MODE_PREFIX = "sandbox:";

export function sandboxModeFor(mapId: string): string {
  return `${SANDBOX_MODE_PREFIX}${mapId}`;
}

export function sandboxMapId(mode: string | null | undefined): string | undefined {
  if (!mode?.startsWith(SANDBOX_MODE_PREFIX)) return undefined;
  return mode.slice(SANDBOX_MODE_PREFIX.length) || undefined;
}

export function mapIdForMode(mode: string | null | undefined): string | undefined {
  if (!mode) return undefined;
  const sandbox = sandboxMapId(mode);
  if (sandbox) return sandbox;
  for (const src of listMaps()) {
    if (src.kind === "doc" && src.doc.modeIds?.includes(mode)) {
      return src.doc.id;
    }
  }
  return (
    PVP_MODES.find((m) => m.id === mode)?.mapId ??
    PVE_CONTENTS.find((c) => c.id === mode)?.mapId
  );
}

export function resolvePvpTransfer(modeId: string): { room: string; mode: PvpModeId } {
  const mode =
    PVP_MODES.find((m) => m.id === modeId && m.enabled) ??
    PVP_MODES.find((m) => m.id === modeId) ??
    pvpModesForFamily("skirmish")[0] ??
    PVP_MODES[0];
  return { room: mode.room, mode: mode.id };
}

export function resolvePveTransfer(contentId: string): { room: string; mode: PveContentId } {
  const content = PVE_CONTENTS.find((c) => c.id === contentId) ?? PVE_CONTENTS[0];
  return { room: content.room, mode: content.id };
}
