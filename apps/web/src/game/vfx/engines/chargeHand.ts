import { ABILITIES, phaseDurationMs } from "@battlebeasts/shared";
import { spawnCastEffect, cancelFollowOwnerVfx } from "../runtime";
import {
  clearHandle,
  hasHandle,
  setHandle,
} from "../runtime/playerVfxRuntime";
import { getFlightDurationMs } from "../timing";
import type { CastEngine, CastEngineContext } from "./types";

function chargeMsFor(
  abilityId: string,
  enteringAnticipation: boolean,
  padMs: number,
  fallback: number,
): number {
  const def = ABILITIES[abilityId];
  if (!def) return fallback;
  const base = enteringAnticipation
    ? phaseDurationMs(def, "anticipation") + phaseDurationMs(def, "cast")
    : phaseDurationMs(def, "cast");
  return base + padMs;
}

function lifeMsFor(ctx: CastEngineContext, chargeMs: number): number {
  const opts = ctx.profile.chargeHand!;
  if (opts.shieldHoldMs != null) {
    return chargeMs + opts.shieldHoldMs + (opts.dissolveMs ?? 0);
  }
  const def = ABILITIES[ctx.abilityId];
  const flightMs = getFlightDurationMs(
    def?.range,
    def?.speed,
    opts.fallbackRange ?? 10,
    opts.fallbackSpeed ?? 10,
    opts.fallbackFlightMs ?? 1000,
  );
  const fuseMs = opts.includeDetonateFuse ? (def?.detonate?.delayMs ?? 2000) : 0;
  return chargeMs + flightMs + fuseMs + (opts.flightCoastMs ?? 0);
}

function spawnCharge(ctx: CastEngineContext, chargeMs: number): void {
  const opts = ctx.profile.chargeHand!;
  if (opts.cancelFollowOnStart) {
    cancelFollowOwnerVfx(ctx.abilityId, ctx.sessionId);
  }
  const yaw = ctx.pose.yaw ?? 0;
  const forward = opts.forward;
  const x = (ctx.pose.x ?? 0) + Math.sin(yaw) * forward;
  const z = (ctx.pose.z ?? 0) + Math.cos(yaw) * forward;
  setHandle(
    ctx.sessionId,
    ctx.abilityId,
    spawnCastEffect(
      ctx.abilityId,
      { x, z, yaw, y: opts.handY },
      {
        followOwnerId: ctx.sessionId,
        followSpawnOffset: forward,
        lifeMs: lifeMsFor(ctx, chargeMs),
        chargeMs,
      },
    ),
  );
}

function maybeStartCharge(ctx: CastEngineContext): void {
  const opts = ctx.profile.chargeHand;
  if (!opts) return;
  const { phase, prevPhase, sessionId, abilityId } = ctx;
  const enteringAnticipation = phase === "anticipation" && prevPhase !== "anticipation";
  const missedAnticipation =
    phase === "cast" &&
    prevPhase !== "anticipation" &&
    prevPhase !== "cast" &&
    !hasHandle(sessionId, abilityId);
  if (!enteringAnticipation && !missedAnticipation) return;
  spawnCharge(
    ctx,
    chargeMsFor(abilityId, enteringAnticipation, opts.chargePadMs, opts.fallbackChargeMs),
  );
}

function onImpact(ctx: CastEngineContext): void {
  const opts = ctx.profile.chargeHand;
  if (!opts) return;
  if (ctx.phase !== "impact" || ctx.prevPhase === "impact") return;

  if (!hasHandle(ctx.sessionId, ctx.abilityId)) {
    // Missed cast patches — spawn full-size visual that latches to projectile / continues.
    const def = ABILITIES[ctx.abilityId];
    let chargeMs = 1;
    let lifeMs: number;
    if (opts.shieldHoldMs != null) {
      lifeMs = opts.shieldHoldMs + (opts.dissolveMs ?? 0);
    } else {
      const flightMs = getFlightDurationMs(
        def?.range,
        def?.speed,
        opts.fallbackRange ?? 10,
        opts.fallbackSpeed ?? 10,
        opts.fallbackFlightMs ?? 1000,
      );
      const fuseMs = opts.includeDetonateFuse ? (def?.detonate?.delayMs ?? 2000) : 0;
      lifeMs = flightMs + fuseMs + (opts.flightCoastMs ?? 0);
    }
    const yaw = ctx.pose.yaw ?? 0;
    const forward = opts.forward;
    const x = (ctx.pose.x ?? 0) + Math.sin(yaw) * forward;
    const z = (ctx.pose.z ?? 0) + Math.cos(yaw) * forward;
    setHandle(
      ctx.sessionId,
      ctx.abilityId,
      spawnCastEffect(
        ctx.abilityId,
        { x, z, yaw, y: opts.handY },
        {
          followOwnerId: ctx.sessionId,
          followSpawnOffset: forward,
          lifeMs,
          chargeMs,
        },
      ),
    );
  }
  // Shot continues as projectile / shield — only drop the handle map entry.
  clearHandle(ctx.sessionId, ctx.abilityId, false);
}

export const chargeHandEngine: CastEngine = {
  onPhaseChange(ctx) {
    maybeStartCharge(ctx);
    onImpact(ctx);
  },
};
