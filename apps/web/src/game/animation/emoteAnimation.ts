import { getEmote } from "@battlebeasts/shared";
import type { CharacterAnimationController } from "./CharacterAnimationController";
import { emoteAnimationClips } from "./animationConfig";

/**
 * Play a full-body emote at natural Mixamo speed, looping until
 * `cancelFullBodyAction` (move / cancel_emote).
 */
export function playEmoteAnimation(
  controller: CharacterAnimationController,
  emoteId: string,
): boolean {
  const def = getEmote(emoteId);
  if (!def) return false;
  const clip = emoteAnimationClips[emoteId] ?? def.animClip;
  return controller.playFullBodyAction(clip, {
    loop: true,
    timeScale: 1,
    restoreLayers: true,
  });
}
