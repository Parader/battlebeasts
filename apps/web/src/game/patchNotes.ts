import data from "./patchNotesData.json";

export type PatchNote = {
  /** Stable id — newest first in PATCH_NOTES. */
  id: string;
  /** Short headline for the release. */
  title: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Mixed leftover lines (older notes). Prefer balance / fixes / content. */
  highlights?: string[];
  balance?: string[];
  fixes?: string[];
  content?: string[];
};

/**
 * Player-facing updates. Newest entries first.
 * Edit patchNotesData.json — the launcher pack reads that same file.
 */
export const PATCH_NOTES: readonly PatchNote[] = data;

const SEEN_KEY = "bb.patchNotes.seenId";

export function latestPatchNote(): PatchNote | undefined {
  return PATCH_NOTES[0];
}

export function patchNoteLines(note: PatchNote, key: "balance" | "fixes" | "content" | "highlights"): string[] {
  const list = note[key];
  return Array.isArray(list) ? list.filter((line) => typeof line === "string") : [];
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
