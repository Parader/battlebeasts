import { ROOM } from "./constants";

export type PvpModeId = "arena_2v2" | "arena_3v3" | "battleground";
export type PveContentId = "dungeon" | "boss";

export const PVP_MODES: readonly {
  id: PvpModeId;
  label: string;
  room: (typeof ROOM)[keyof typeof ROOM];
  teamSize: number;
}[] = [
  { id: "arena_2v2", label: "Arena 2v2", room: ROOM.ARENA, teamSize: 2 },
  { id: "arena_3v3", label: "Arena 3v3", room: ROOM.ARENA, teamSize: 3 },
  { id: "battleground", label: "Battleground", room: ROOM.BATTLEGROUND, teamSize: 8 },
] as const;

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

export function resolvePvpTransfer(modeId: string): { room: string; mode: PvpModeId } {
  const mode = PVP_MODES.find((m) => m.id === modeId) ?? PVP_MODES[0];
  return { room: mode.room, mode: mode.id };
}

export function resolvePveTransfer(contentId: string): { room: string; mode: PveContentId } {
  const content = PVE_CONTENTS.find((c) => c.id === contentId) ?? PVE_CONTENTS[0];
  return { room: content.room, mode: content.id };
}
