import { ABILITIES, phaseDurationMs } from "@battlebeasts/shared";
import { spawnCastEffect } from "../runtime";
import { getPlayerVfxRuntime } from "../runtime/playerVfxRuntime";
import type { CastEngine, CastEngineContext, PlayerCastPose } from "./types";

function fireMuzzle(
  sessionId: string,
  abilityId: string,
  pose: PlayerCastPose,
  ctx: CastEngineContext,
): void {
  const opts = ctx.profile.muzzleLead!;
  const yaw = pose.yaw ?? 0;
  const forward = opts.forward;
  const x = (pose.x ?? 0) + Math.sin(yaw) * forward;
  const z = (pose.z ?? 0) + Math.cos(yaw) * forward;
  spawnCastEffect(
    abilityId,
    { x, z, yaw, y: opts.handY },
    { followOwnerId: sessionId, followSpawnOffset: forward },
  );
}

export const muzzleLeadEngine: CastEngine = {
  onPhaseChange(ctx) {
    const runtime = getPlayerVfxRuntime(ctx.sessionId);
    const opts = ctx.profile.muzzleLead;
    if (!opts) return;

    if (ctx.phase === "cast" && ctx.prevPhase !== "cast") {
      const def = ABILITIES[ctx.abilityId];
      const castMs = def ? phaseDurationMs(def, "cast") : 200;
      const fireAt = ctx.now + Math.max(0, castMs - opts.leadMs);
      runtime.pendingMuzzle = { abilityId: ctx.abilityId, fireAt };
      runtime.firedMuzzle = false;
    }

    if (
      ctx.phase === "idle" ||
      ctx.phase === "cancel" ||
      ctx.phase === "interrupt" ||
      ctx.phase === "" ||
      ctx.phase === "anticipation" ||
      ctx.phase === "recovery"
    ) {
      runtime.pendingMuzzle = undefined;
      if (ctx.phase !== "recovery") runtime.firedMuzzle = false;
    }

    // Fallback: impact arrived before schedule
    if (ctx.phase === "impact" && ctx.prevPhase !== "impact" && !runtime.firedMuzzle) {
      fireMuzzle(ctx.sessionId, ctx.abilityId, ctx.pose, ctx);
      runtime.firedMuzzle = true;
      runtime.pendingMuzzle = undefined;
    }
  },

  tick(ctx) {
    const runtime = getPlayerVfxRuntime(ctx.sessionId);
    const pend = runtime.pendingMuzzle;
    if (!pend || runtime.firedMuzzle || ctx.now < pend.fireAt) return;
    if (ctx.phase === "cast" || ctx.phase === "impact") {
      fireMuzzle(ctx.sessionId, pend.abilityId, ctx.pose, ctx);
      runtime.firedMuzzle = true;
      runtime.pendingMuzzle = undefined;
    }
  },
};
