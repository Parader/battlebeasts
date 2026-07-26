/** Live portal channel bubble scale (0–1 grow) per session — used to start depart collapse. */
const scaleBySession = new Map<string, number>();

export function setPortalChannelBubbleScale(sessionId: string, scale01: number): void {
  scaleBySession.set(sessionId, Math.max(0, Math.min(1, scale01)));
}

export function clearPortalChannelBubbleScale(sessionId: string): void {
  scaleBySession.delete(sessionId);
}

/** Read + clear so collapse starts from the size the bubble had when blinking. */
export function takePortalChannelBubbleScale(sessionId: string): number {
  const v = scaleBySession.get(sessionId) ?? 1;
  scaleBySession.delete(sessionId);
  return v;
}
