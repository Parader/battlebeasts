import { ABILITIES, totalCastDurationMs } from "@battlebeasts/shared";
import { spawnImpactEffect } from "../runtime";
import {
  clearHandle,
  setHandle,
} from "../runtime/playerVfxRuntime";
import type { CastEngine, CastEngineContext } from "./types";

export const bridgedAoeEngine: CastEngine = {
  onPhaseChange(ctx) {
    const opts = ctx.profile.bridgedAoe;
    if (!opts) return;

    if (ctx.phase === "anticipation" && ctx.prevPhase !== "anticipation") {
      const def = ABILITIES[ctx.abilityId];
      const lifeMs = def ? totalCastDurationMs(def) + opts.lifePadMs : 2200;
      setHandle(
        ctx.sessionId,
        ctx.abilityId,
        spawnImpactEffect(
          ctx.abilityId,
          {
            x: ctx.pose.x ?? 0,
            z: ctx.pose.z ?? 0,
            y: opts.y ?? 0.04,
            yaw: ctx.pose.yaw ?? 0,
          },
          { followOwnerId: ctx.sessionId, followSpawnOffset: 0, lifeMs },
        ),
      );
    }

    if (ctx.phase === "recovery" && ctx.prevPhase !== "recovery") {
      clearHandle(ctx.sessionId, ctx.abilityId, false);
    }
  },
};
