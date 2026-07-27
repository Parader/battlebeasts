/**
 * Active full-body emote per session — CharacterAvatar / RemotePlayers read
 * this each frame to play/cancel the dance clip, independent of the ability
 * cast schema fields. Set on local optimistic cast + `emote_fx` broadcasts.
 *
 * Emotes loop until cleared (movement / cancel_emote) — no auto-expire.
 */

type ActiveEmote = {
  emoteId: string;
};

const activeBySession = new Map<string, ActiveEmote>();

export function setActiveEmote(sessionId: string, emoteId: string, _durationMs?: number): void {
  void _durationMs;
  activeBySession.set(sessionId, { emoteId });
}

export function clearActiveEmote(sessionId: string): void {
  activeBySession.delete(sessionId);
}

/** Returns the active emote id (cleared only via `clearActiveEmote`). */
export function getActiveEmote(sessionId: string): string | null {
  return activeBySession.get(sessionId)?.emoteId ?? null;
}

export function isEmoteActive(sessionId: string): boolean {
  return getActiveEmote(sessionId) != null;
}
