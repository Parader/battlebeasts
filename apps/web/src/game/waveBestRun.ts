/** Local best Wave Assault run (kills). Keyed per hunter. */

export type WaveBestRun = {
  kills: number;
  wave: number;
  at: number;
};

function key(userId: string) {
  return `bb.pve.waveBest.${userId}`;
}

export function loadWaveBestRun(userId: string): WaveBestRun | null {
  if (!userId || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WaveBestRun;
    if (typeof parsed?.kills !== "number") return null;
    return {
      kills: Math.max(0, Math.floor(parsed.kills)),
      wave: Math.max(0, Math.floor(parsed.wave ?? 0)),
      at: typeof parsed.at === "number" ? parsed.at : 0,
    };
  } catch {
    return null;
  }
}

/** Returns the stored best after optionally updating with this run. */
export function recordWaveBestRun(
  userId: string,
  run: { kills: number; wave: number },
): { best: WaveBestRun; isNewBest: boolean } {
  const kills = Math.max(0, Math.floor(run.kills));
  const wave = Math.max(0, Math.floor(run.wave));
  const prev = loadWaveBestRun(userId);
  const isNewBest = !prev || kills > prev.kills;
  const best: WaveBestRun = isNewBest
    ? { kills, wave, at: Date.now() }
    : prev!;
  if (isNewBest && userId && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(key(userId), JSON.stringify(best));
    } catch {
      /* ignore quota */
    }
  }
  return { best, isNewBest };
}
