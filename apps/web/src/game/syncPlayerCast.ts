import type { MutableRefObject } from "react";
import { Room } from "colyseus.js";
import { ABILITIES, comboChainDurationMs, phaseDurationMs, totalCastDurationMs } from "@battlebeasts/shared";
import {
  abilityAnimationBindings,
  heroAnimationConfig,
  type CharacterAnimationController,
} from "./animation";
import {
  clearTeleportSlamAnimSuppress,
  isTeleportSlamAnimSuppressed,
} from "./teleportSlamFadeRuntime";

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
  sessionId?: string | null,
): void {
  const now = performance.now();
  const holdingComboAnim =
    Boolean(comboAnimHoldUntil && comboAnimHoldUntil.current > now) &&
    lastCastId.current.startsWith("comboOnce:");

  if (!player?.castAbilityId || !player.castPhase) {
    if (sessionId) clearTeleportSlamAnimSuppress(sessionId);
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

  // Teleport Slam: after blink, no cast clip — rematerialize in loco only.
  if (
    player.castAbilityId === "teleportSlam" &&
    sessionId &&
    isTeleportSlamAnimSuppressed(sessionId)
  ) {
    if (lastCastId.current !== "teleportSlam:blink") {
      controller.cancelAbilityAnimation();
      lastCastId.current = "teleportSlam:blink";
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

  const releasing =
    Boolean(binding.impactUpper) && (player.castComboHit ?? 0) >= 2;
  const releaseHold =
    typeof binding.releaseHoldOnComboHit === "number" &&
    (player.castComboHit ?? 0) >= binding.releaseHoldOnComboHit;
  // Stable key for single-clip hold→throw (Fireball) so confirm doesn't restart the clip.
  const castKey = comboOnce
    ? `comboOnce:${player.castAbilityId}:${player.castLockUntil ?? 0}`
    : binding.releaseHoldOnComboHit
      ? `${player.castAbilityId}:spellCast`
      : binding.impactUpper
        ? `${player.castAbilityId}:${releasing ? "release" : "charge"}:${player.castLockUntil ?? 0}`
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

  if (
    lastCastId.current === castKey ||
    lastCastId.current.startsWith(`${castKey}:`)
  ) {
    // Fireball: seek throw → play to release at 1x → accelerate / cut follow-through.
    if (
      player.castPhase === "recovery" &&
      typeof binding.recoveryUpperSeekSec === "number"
    ) {
      if (
        !lastCastId.current.includes(":throw") &&
        !lastCastId.current.includes(":follow")
      ) {
        lastCastId.current = `${castKey}:throw`;
        controller.seekUpperBodyTime(binding.recoveryUpperSeekSec);
        // Keep charge playbackRate through the throw → release segment so
        // launch delay (wall ms) matches visible hand release.
        if (typeof binding.upperTimeScale === "number" && binding.upperTimeScale > 0) {
          controller.setUpperBodyTimeScale(binding.upperTimeScale);
        }
      }
      const clipT = controller.getUpperBodyTime();
      const releaseSec =
        binding.recoveryUpperReleaseSec ?? binding.recoveryUpperSeekSec;
      if (
        typeof binding.recoveryUpperTimeScale === "number" &&
        clipT >= releaseSec - 0.03
      ) {
        controller.setUpperBodyTimeScale(binding.recoveryUpperTimeScale);
        if (!lastCastId.current.includes(":follow")) {
          lastCastId.current = `${castKey}:throw:follow`;
        }
      }
      if (
        typeof binding.recoveryUpperEndSec === "number" &&
        clipT >= binding.recoveryUpperEndSec
      ) {
        controller.cancelUpperBodyAction();
        lastCastId.current = `${castKey}:throw:done`;
      }
      return;
    }
    // Local cancel already faded this cast — don't re-drive hold/air scales from
    // stale schema; wait until cast fields clear and the idle branch runs.
    // Exception: looping charge must restart if upper dropped while channeling.
    if (controller.getState().upperBody === "idle" && controller.getState().fullBody === "none") {
      const redriveCharge =
        Boolean(binding.upperLoop) &&
        !releasing &&
        !releaseHold &&
        (player.castPhase === "anticipation" ||
          player.castPhase === "cast" ||
          player.castPhase === "impact");
      if (redriveCharge) {
        lastCastId.current = "";
      } else {
        return;
      }
    }
  }

  // Single-clip throw: release hold at frame 160 and continue through frame 172+.
  if (
    releaseHold &&
    binding.releaseHoldOnComboHit &&
    !lastCastId.current.endsWith(":throw") &&
    (player.castPhase === "impact" || player.castPhase === "cast")
  ) {
    lastCastId.current = `${castKey}:throw`;
    controller.releaseUpperHold({ seekToHold: true });
    return;
  }

    // Charge → release: lastCastId may still be the charge key while castKey flipped
    // to release (comboHit ≥ 2). Force the swap even when keys differ.
    if (
      binding.impactUpper &&
      releasing &&
      lastCastId.current.includes(":charge:") &&
      (player.castPhase === "impact" || player.castPhase === "cast")
    ) {
      lastCastId.current = `${player.castAbilityId}:release:${player.castLockUntil ?? 0}`;
      controller.cancelUpperBodyAction();
      const logical = String(binding.impactUpper);
      const opts = {
        timeScale: binding.impactUpperTimeScale ?? 1,
        loop: false,
        onComplete: () => {
          controller.cancelUpperBodyAction();
        },
      };
      const ok =
        controller.playUpperBodyAction(logical, opts) ||
        (() => {
          const mapped =
            logical in heroAnimationConfig
              ? heroAnimationConfig[logical as keyof typeof heroAnimationConfig]
              : undefined;
          return mapped != null
            ? controller.playUpperBodyAction(String(mapped), opts)
            : false;
        })();
      if (!ok) lastCastId.current = castKey;
      return;
    }

  if (
    lastCastId.current === castKey ||
    lastCastId.current.startsWith(`${castKey}:`)
  ) {
    // Blood Rush: crouch hold → swap to Crouched To Sprinting on impact.
    // Hand Shield: Start → Idle loop on impact → End on recovery.
    // Verdant Leap: sprint only when leaping (castComboHit stamped at commit).
    if (
      player.castPhase === "impact" &&
      binding.impactFullBody &&
      !lastCastId.current.endsWith(":impact")
    ) {
      if (
        player.castAbilityId === "verdantLeap" &&
        (player.castComboHit ?? 0) < 1
      ) {
        lastCastId.current = `${castKey}:impact`;
        return;
      }
      lastCastId.current = `${castKey}:impact`;
      if (player.castAbilityId === "verdantLeap") {
        controller.cancelUpperBodyAction();
      }
      const logical = String(binding.impactFullBody);
      const mapped =
        logical in heroAnimationConfig
          ? heroAnimationConfig[logical as keyof typeof heroAnimationConfig]
          : undefined;
      const clipName = mapped != null ? String(mapped) : logical;
      const opts = {
        desiredDuration: binding.impactFullBodyLoop
          ? undefined
          : binding.impactFullBodyAnimDurationSec,
        timeScale: binding.impactFullBodyTimeScale,
        loop: binding.impactFullBodyLoop,
        restoreLayers: true,
      };
      const ok =
        controller.playFullBodyAction(logical, opts) ||
        controller.playFullBodyAction(clipName, opts);
      if (!ok) lastCastId.current = castKey;
      return;
    }
    if (
      player.castPhase === "recovery" &&
      binding.recoveryFullBody &&
      !lastCastId.current.endsWith(":end")
    ) {
      lastCastId.current = `${castKey}:end`;
      const logical = String(binding.recoveryFullBody);
      const mapped =
        logical in heroAnimationConfig
          ? heroAnimationConfig[logical as keyof typeof heroAnimationConfig]
          : undefined;
      const clipName = mapped != null ? String(mapped) : logical;
      const opts = {
        desiredDuration: binding.recoveryFullBodyAnimDurationSec,
        restoreLayers: true,
      };
      const ok =
        controller.playFullBodyAction(logical, opts) ||
        controller.playFullBodyAction(clipName, opts);
      if (!ok) lastCastId.current = castKey;
      return;
    }
    if (player.castPhase === "recovery" && binding.holdEndPoseOnRecovery) {
      if (typeof binding.holdPoseAtSec === "number") {
        controller.freezeFullBodyAt(binding.holdPoseAtSec);
      }
      return;
    }
    // Counter / Portal: freeze through the rooted channel impact.
    // Smash also sets holdEndPoseOnRecovery, but needs airTimeScale during impact
    // so the leap plays — freeze only on recovery (above).
    if (
      player.castPhase === "impact" &&
      binding.holdEndPoseOnRecovery &&
      typeof binding.airTimeScale !== "number" &&
      !binding.impactFullBody
    ) {
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
      !binding.comboFullBody &&
      !binding.recoveryFullBody
    ) {
      controller.cancelFullBodyAction();
      // Don't cut single-clip throw follow-through; it fades via onComplete /
      // cast-clear. Plain looping channels cancel here.
      if (binding.upperLoop && !binding.impactUpper && !binding.releaseHoldOnComboHit) {
        controller.cancelUpperBodyAction();
      }
    }
    // Charge → release swap (same castLockUntil possible if comboHit updates alone).
    if (
      binding.impactUpper &&
      releasing &&
      !lastCastId.current.includes(":release:") &&
      (player.castPhase === "impact" || player.castPhase === "cast")
    ) {
      lastCastId.current = `${player.castAbilityId}:release:${player.castLockUntil ?? 0}`;
      controller.cancelUpperBodyAction();
      const logical = String(binding.impactUpper);
      const opts = {
        timeScale: binding.impactUpperTimeScale ?? 1,
        loop: false,
        onComplete: () => {
          controller.cancelUpperBodyAction();
        },
      };
      const ok =
        controller.playUpperBodyAction(logical, opts) ||
        (() => {
          const mapped =
            logical in heroAnimationConfig
              ? heroAnimationConfig[logical as keyof typeof heroAnimationConfig]
              : undefined;
          return mapped != null
            ? controller.playUpperBodyAction(String(mapped), opts)
            : false;
        })();
      if (!ok) lastCastId.current = castKey;
      return;
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

  // Verdant Leap: crouch→sprint only when leaping to an ally (server stamps
  // castComboHit=1 at commit). Solo heal+haste keeps the soft upper cast.
  if (
    player.castAbilityId === "verdantLeap" &&
    player.castPhase === "impact" &&
    binding.impactFullBody &&
    !String(lastCastId.current).endsWith(":impact")
  ) {
    // Re-read after assigning castKey above — mark impact regardless of leap.
    const impactKey = `${castKey}:impact`;
    if ((player.castComboHit ?? 0) < 1) {
      lastCastId.current = impactKey;
      return;
    }
    lastCastId.current = impactKey;
    controller.cancelUpperBodyAction();
    const logical = String(binding.impactFullBody);
    const mapped =
      logical in heroAnimationConfig
        ? heroAnimationConfig[logical as keyof typeof heroAnimationConfig]
        : undefined;
    const clipName = mapped != null ? String(mapped) : logical;
    const opts = {
      desiredDuration: binding.impactFullBodyLoop
        ? undefined
        : binding.impactFullBodyAnimDurationSec,
      timeScale: binding.impactFullBodyTimeScale,
      loop: binding.impactFullBodyLoop,
      restoreLayers: true,
    };
    const ok =
      controller.playFullBodyAction(logical, opts) ||
      controller.playFullBodyAction(clipName, opts);
    if (!ok) lastCastId.current = castKey;
    return;
  }

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
      desiredDuration:
        binding.playNaturalSpeed || binding.windupTimeScale || binding.fullBodyLoop
          ? undefined
          : animSec,
      timeScale: binding.windupTimeScale,
      startAtSec: binding.startAtSec,
      loop: binding.fullBodyLoop,
      restoreLayers: true,
    };
    const ok =
      controller.playFullBodyAction(logical, opts) ||
      controller.playFullBodyAction(clipName, opts);
    if (!ok) lastCastId.current = "";
    return;
  }

  if (binding.upper) {
    const releasingNow =
      Boolean(binding.impactUpper) && (player.castComboHit ?? 0) >= 2;
    const logical = releasingNow
      ? String(binding.impactUpper)
      : String(binding.upper);
    const animSec = binding.upperAnimDurationSec ?? durationSec;
    const releaseScale = releasingNow ? binding.impactUpperTimeScale : undefined;
    const looping = Boolean(binding.upperLoop) && !releasingNow;
    if (releasingNow) {
      controller.cancelUpperBodyAction();
    }
    const opts = {
      // Looping charge must play at natural speed — stretching to totalCastDuration
      // makes one slow pass that looks like the clip never loops.
      desiredDuration:
        looping || releaseScale != null || binding.upperTimeScale != null
          ? undefined
          : animSec,
      timeScale: releaseScale ?? (looping ? 1 : binding.upperTimeScale),
      startAtSec: releasingNow ? undefined : binding.startAtSec,
      holdAtSec: releasingNow ? undefined : binding.upperHoldAtSec,
      loop: looping,
      onComplete:
        releasingNow || binding.releaseHoldOnComboHit
          ? () => {
              controller.cancelUpperBodyAction();
            }
          : undefined,
    };
    const ok = controller.playUpperBodyAction(logical, opts);
    if (!ok) {
      const mapped =
        logical in heroAnimationConfig
          ? heroAnimationConfig[logical as keyof typeof heroAnimationConfig]
          : undefined;
      const ok2 =
        mapped != null ? controller.playUpperBodyAction(String(mapped), opts) : false;
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
  syncAbilityCast(controller, player, lastCastId, comboAnimHoldUntil, sessionId);
}
