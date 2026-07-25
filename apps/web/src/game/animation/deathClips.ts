import type { CharacterAnimationController } from "./CharacterAnimationController";

/** Clip names in the loaded GLB that contain "death" (case-insensitive). */
export function listDeathClipNames(clips: readonly { name: string }[]): string[] {
  return clips.map((c) => c.name).filter((n) => /death/i.test(n));
}

export function pickRandomDeathClip(clips: readonly { name: string }[]): string | null {
  const names = listDeathClipNames(clips);
  if (names.length === 0) return null;
  return names[Math.floor(Math.random() * names.length)] ?? null;
}

/**
 * Play a random death clip at the GLB's native length (timeScale 1),
 * then freeze on the last frame until cancelFullBodyAction.
 */
export function playRandomDeath(
  controller: CharacterAnimationController,
  clips: readonly { name: string; duration: number }[],
): { name: string; duration: number } | null {
  const name = pickRandomDeathClip(clips);
  if (!name) return null;
  const src = clips.find((c) => c.name === name);
  const ok = controller.playFullBodyAction(name, {
    holdEndPose: true,
    restoreLayers: true,
    // Keep Mixamo authored length — never compress to a cast window.
    timeScale: 1,
  });
  if (!ok) return null;
  const live = controller.getActiveFullBodyDuration();
  const duration =
    live > 0 ? live : src?.duration && src.duration > 0 ? src.duration : 2.6;
  return { name, duration };
}
