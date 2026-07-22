import type { MutableRefObject } from "react";
import { Room } from "colyseus.js";
import { ABILITIES, totalCastDurationMs } from "@battlebeasts/shared";
import {
  abilityAnimationBindings,
  character1AnimationConfig,
  type CharacterAnimationController,
} from "./animation";

type CastPlayer = {
  castPhase?: string;
  castAbilityId?: string;
};

/**
 * Drive cast / dash visuals from a player's networked cast fields.
 * Works for local and remote session ids. Triggers once per ability cast.
 */
export function syncPlayerCast(
  controller: CharacterAnimationController,
  room: Room | null,
  sessionId: string | null,
  lastCastId: MutableRefObject<string>,
): void {
  if (!room || !sessionId) return;
  const player = room.state?.players?.get(sessionId) as CastPlayer | undefined;

  if (!player?.castAbilityId || !player.castPhase) {
    if (lastCastId.current) {
      controller.cancelAbilityAnimation();
      lastCastId.current = "";
    }
    return;
  }

  if (player.castAbilityId === lastCastId.current) {
    // Soften roll exit: blend loco back during recovery instead of snapping at idle
    if (player.castPhase === "recovery") {
      controller.cancelFullBodyAction();
    }
    return;
  }
  if (
    player.castPhase !== "anticipation" &&
    player.castPhase !== "cast" &&
    player.castPhase !== "impact"
  ) {
    return;
  }

  lastCastId.current = player.castAbilityId;

  const def = ABILITIES[player.castAbilityId];
  const binding = abilityAnimationBindings[player.castAbilityId];
  if (!binding) return;

  const durationSec = def ? totalCastDurationMs(def) / 1000 : undefined;

  if (binding.fullBody) {
    const logical = String(binding.fullBody);
    const clipName = character1AnimationConfig[binding.fullBody] ?? logical;
    const ok =
      controller.playFullBodyAction(logical, {
        desiredDuration: durationSec,
        restoreLayers: true,
      }) ||
      controller.playFullBodyAction(clipName, {
        desiredDuration: durationSec,
        restoreLayers: true,
      });
    if (!ok) lastCastId.current = "";
    return;
  }

  if (binding.upper) {
    const logical = String(binding.upper);
    const ok = controller.playUpperBodyAction(logical, {
      desiredDuration: durationSec,
    });
    if (!ok) {
      const clipName = character1AnimationConfig[binding.upper];
      const ok2 = clipName
        ? controller.playUpperBodyAction(clipName, { desiredDuration: durationSec })
        : false;
      if (!ok2) lastCastId.current = "";
    }
  }
}
