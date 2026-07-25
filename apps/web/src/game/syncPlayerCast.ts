import type { MutableRefObject } from "react";
import { Room } from "colyseus.js";
import { ABILITIES, comboChainDurationMs, phaseDurationMs, totalCastDurationMs } from "@battlebeasts/shared";
import {
  abilityAnimationBindings,
  heroAnimationConfig,
  type CharacterAnimationController,
} from "./animation";

export type CastAnimState = {
  castPhase?: string;
  castAbilityId?: string;
  castComboHit?: number;
  castLockUntil?: number;
};

type ComboOnceBinding = {
  comboFullBodyOnce?: string;
  comboUpperOnce?: string;
  comboAnimDurationSec?: number;
};

function isComboOnceBinding(binding: ComboOnceBinding): boolean {
  return Boolean(binding.comboFullBodyOnce || binding.comboUpperOnce);
}

/** Pad so hold deadline survives a frame of latency without overshooting continue window. */
const HOLD_PAD_MS = 40;

/**
 * Drive cast / dash visuals from networked cast fields.
 * Used by players and practice dummies.
 */
export function syncAbilityCast(
  controller: CharacterAnimationController,
  player: CastAnimState | undefined,
  lastCastId: MutableRefObject<string>,
  comboAnimHoldUntil?: MutableRefObject<number>,
): void {
  const now = performance.now();
  const holdingComboAnim =
    Boolean(comboAnimHoldUntil && comboAnimHoldUntil.current > now) &&
    lastCastId.current.startsWith("comboOnce:");

  if (!player?.castAbilityId || !player.castPhase) {
    if (lastCastId.current.startsWith("comboOnce:")) {
      const abilityId = lastCastId.current.split(":")[1] ?? "";
      const continueMs = ABILITIES[abilityId]?.combo?.continueWindowMs ?? 200;
      if (comboAnimHoldUntil) {
        // Cap leftover chain hold to the continue window so stop cancels cleanly
        comboAnimHoldUntil.current = Math.min(
          comboAnimHoldUntil.current,
          now + continueMs + HOLD_PAD_MS,
        );
        if (comboAnimHoldUntil.current > now) return;
      }
    }
    if (lastCastId.current) {
      controller.cancelAbilityAnimation();
      lastCastId.current = "";
      if (comboAnimHoldUntil) comboAnimHoldUntil.current = 0;
    }
    return;
  }

  const def = ABILITIES[player.castAbilityId];
  const binding = abilityAnimationBindings[player.castAbilityId];
  if (!binding) return;

  const comboOnce = isComboOnceBinding(binding);
  // Wait until server stamps castComboHit — avoid playing then re-triggering
  if (comboOnce && (player.castComboHit ?? 0) < 1) {
    return;
  }

  const castKey = comboOnce
    ? `comboOnce:${player.castAbilityId}:${player.castLockUntil ?? 0}`
    : `${player.castAbilityId}:${player.castComboHit ?? 0}:${player.castLockUntil ?? 0}`;

  // Multi-hit clip already playing — ignore later swings in the same chain
  if (
    comboOnce &&
    lastCastId.current.startsWith(`comboOnce:${player.castAbilityId}:`) &&
    (player.castComboHit ?? 0) > 1
  ) {
    if (comboAnimHoldUntil && def?.combo) {
      comboAnimHoldUntil.current = Math.max(
        comboAnimHoldUntil.current,
        now + def.combo.continueWindowMs + HOLD_PAD_MS,
      );
    }
    return;
  }

  if (castKey === lastCastId.current) {
    if (player.castPhase === "recovery" && binding.holdEndPoseOnRecovery) {
      if (typeof binding.holdPoseAtSec === "number") {
        controller.freezeFullBodyAt(binding.holdPoseAtSec);
      }
      return;
    }
    if (player.castPhase === "impact" && typeof binding.airTimeScale === "number") {
      controller.setFullBodyTimeScale(binding.airTimeScale);
    }
    if (
      player.castPhase === "recovery" &&
      !comboOnce &&
      !binding.comboFullBody
    ) {
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

  // Different ability while a combo-once anim is held — cut it
  if (
    holdingComboAnim &&
    !lastCastId.current.startsWith(`comboOnce:${player.castAbilityId}:`)
  ) {
    controller.cancelAbilityAnimation();
    if (comboAnimHoldUntil) comboAnimHoldUntil.current = 0;
  }

  lastCastId.current = castKey;

  const durationSec = def ? totalCastDurationMs(def) / 1000 : undefined;
  /** Anim covers windup→land; recovery only holds the clamped end pose. */
  const activePoseSec = def
    ? (phaseDurationMs(def, "anticipation") +
        phaseDurationMs(def, "cast") +
        phaseDurationMs(def, "impact")) /
      1000
    : durationSec;

  if (binding.comboUpperOnce || binding.comboFullBodyOnce) {
    if ((player.castComboHit ?? 0) !== 1) return;

    const chainSec = def ? comboChainDurationMs(def) / 1000 : durationSec;
    const animSec = binding.comboAnimDurationSec ?? chainSec;
    const ok = binding.comboUpperOnce
      ? controller.playUpperBodyAction(binding.comboUpperOnce, {
          desiredDuration: animSec,
        })
      : controller.playFullBodyAction(binding.comboFullBodyOnce!, {
          desiredDuration: animSec,
          restoreLayers: true,
        });
    if (!ok) {
      lastCastId.current = "";
      if (comboAnimHoldUntil) comboAnimHoldUntil.current = 0;
      return;
    }
    if (comboAnimHoldUntil) {
      comboAnimHoldUntil.current = now + (animSec ?? 1) * 1000 + HOLD_PAD_MS;
    }
    return;
  }

  if (binding.comboFullBody?.length) {
    const comboIndex = Math.max(0, (player.castComboHit ?? 1) - 1);
    const clipName =
      binding.comboFullBody[comboIndex % binding.comboFullBody.length]!;
    const ok = controller.playFullBodyAction(clipName, {
      desiredDuration: durationSec,
      restoreLayers: true,
    });
    if (!ok) lastCastId.current = "";
    return;
  }

  if (binding.comboUpper?.length) {
    const comboIndex = Math.max(0, (player.castComboHit ?? 1) - 1);
    const clipName = binding.comboUpper[comboIndex % binding.comboUpper.length]!;
    const ok = controller.playUpperBodyAction(clipName, {
      desiredDuration: durationSec,
    });
    if (!ok) lastCastId.current = "";
    return;
  }

  if (binding.fullBody) {
    const logical = String(binding.fullBody);
    const mapped = heroAnimationConfig[binding.fullBody];
    const clipName = mapped != null ? String(mapped) : logical;
    const animSec =
      binding.fullBodyAnimDurationSec ??
      (binding.holdEndPoseOnRecovery && !binding.windupTimeScale
        ? activePoseSec
        : durationSec);
    const opts = {
      desiredDuration: binding.windupTimeScale ? undefined : animSec,
      timeScale: binding.windupTimeScale,
      startAtSec: binding.startAtSec,
      restoreLayers: true,
    };
    const ok =
      controller.playFullBodyAction(logical, opts) ||
      controller.playFullBodyAction(clipName, opts);
    if (!ok) lastCastId.current = "";
    return;
  }

  if (binding.upper) {
    const logical = String(binding.upper);
    const ok = controller.playUpperBodyAction(logical, {
      desiredDuration: durationSec,
    });
    if (!ok) {
      const mapped = heroAnimationConfig[binding.upper];
      const ok2 =
        mapped != null
          ? controller.playUpperBodyAction(String(mapped), { desiredDuration: durationSec })
          : false;
      if (!ok2) lastCastId.current = "";
    }
  }
}

/**
 * Drive cast / dash visuals from a player's networked cast fields.
 * Works for local and remote session ids.
 *
 * combo*Once: play once on swing 1, hold through continue windows,
 * cancel if the player stops (hold clamped to continueWindowMs).
 */
export function syncPlayerCast(
  controller: CharacterAnimationController,
  room: Room | null,
  sessionId: string | null,
  lastCastId: MutableRefObject<string>,
  comboAnimHoldUntil?: MutableRefObject<number>,
): void {
  if (!room || !sessionId) return;
  const player = room.state?.players?.get(sessionId) as CastAnimState | undefined;
  syncAbilityCast(controller, player, lastCastId, comboAnimHoldUntil);
}
