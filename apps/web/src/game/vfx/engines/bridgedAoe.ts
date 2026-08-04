import {
  ABILITIES,
  abilityEffectKind,
  resolveMagmaOrbsMeetRange,
  totalCastDurationMs,
} from "@battlebeasts/shared";
import { spawnImpactEffect } from "../runtime";
import {
  clearHandle,
  setHandle,
} from "../runtime/playerVfxRuntime";
import {
  clearMagmaOrbsMeet,
  setMagmaOrbsMeetRange,
} from "../../magmaOrbsMeetRuntime";
import { getGroundAim } from "../../groundAimRuntime";
import type { CastEngine, CastEngineContext } from "./types";

export const bridgedAoeEngine: CastEngine = {
  onPhaseChange(ctx) {
    const opts = ctx.profile.bridgedAoe;
    if (!opts) return;

    if (ctx.phase === "anticipation" && ctx.prevPhase !== "anticipation") {
      const def = ABILITIES[ctx.abilityId];
      const lifeMs = def ? totalCastDurationMs(def) + opts.lifePadMs : 2200;
      // Prefer hit radius for novas (gust has range: 0); fall back to range for cones/lines.
      let radius =
        typeof def?.radius === "number" && def.radius > 0
          ? def.radius
          : def?.range;
      // Magma Orbs: meet distance follows cursor (clamped); server confirms via cast_phase.
      if (abilityEffectKind(def) === "magmaOrbs") {
        const meet = resolveMagmaOrbsMeetRange(
          { x: ctx.pose.x ?? 0, z: ctx.pose.z ?? 0 },
          getGroundAim(),
        );
        setMagmaOrbsMeetRange(ctx.sessionId, meet);
        radius = meet;
      }
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
          {
            followOwnerId: ctx.sessionId,
            followSpawnOffset: 0,
            lifeMs,
            radius,
          },
        ),
      );
    }

    if (ctx.phase === "recovery" && ctx.prevPhase !== "recovery") {
      clearHandle(ctx.sessionId, ctx.abilityId, false);
      if (abilityEffectKind(ABILITIES[ctx.abilityId]) === "magmaOrbs") {
        clearMagmaOrbsMeet(ctx.sessionId);
      }
    }
  },
};
