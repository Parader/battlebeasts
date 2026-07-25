export type PatchNote = {
  /** Stable id — newest first in PATCH_NOTES. */
  id: string;
  /** Short headline for the release. */
  title: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  highlights: string[];
};

/**
 * Player-facing updates. Newest entries first.
 * Add a new object at the top when shipping a batch players should notice.
 */
export const PATCH_NOTES: readonly PatchNote[] = [
  {
    id: "2026-07-25-audio-loading",
    title: "Hub music, settings & loading",
    date: "2026-07-25",
    highlights: [
      "Village looping soundtrack on the hub",
      "Settings: master, music, and effects volume (effects ready for future SFX)",
      "Loading gate preloads hub/arena assets before the HUD appears",
      "Shop and PvE portal show only “In development” while locked",
      "Updates / patch notes on the home screen and in play (Settings too)",
    ],
  },
  {
    id: "2026-07-25-talents",
    title: "Talent trees & spell tags",
    date: "2026-07-25",
    highlights: [
      "WoW-style talent trees at the talent stand (catalog preview; combat wiring later)",
      "Abilities carry spell tags and effect kinds for future talent hooks",
      "Crescent damage raised; merchant UI locked for development",
    ],
  },
] as const;

const SEEN_KEY = "bb.patchNotes.seenId";

export function latestPatchNote(): PatchNote | undefined {
  return PATCH_NOTES[0];
}

export function getSeenPatchNoteId(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function markPatchNotesSeen(id?: string): void {
  const target = id ?? latestPatchNote()?.id;
  if (!target || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SEEN_KEY, target);
  } catch {
    // ignore
  }
}

export function hasUnseenPatchNotes(): boolean {
  const latest = latestPatchNote()?.id;
  if (!latest) return false;
  return getSeenPatchNoteId() !== latest;
}
