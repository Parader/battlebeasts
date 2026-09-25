import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { BLOOD_RUSH_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import {
  burstElementRole,
  spawnElementRole,
  type ElementHandle,
} from "../engine";

const SAMPLE_DIST = 0.28;

/**
 * Blood Rush path is emitted entirely through ParticleWorld.
 */
export function BloodRushTrailEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const last = useRef({ x: 0, z: 0, seeded: false });
  const trailFx = useRef<ElementHandle | null>(null);
  const lifeMs = Math.max(480, shot.life);

  useEffect(() => {
    const handle = spawnElementRole("blood", "trail", shot.x, 0.12, shot.z);
    handle.setRateScale(0);
    trailFx.current = handle;
    return () => {
      handle.kill();
      if (trailFx.current === handle) trailFx.current = null;
    };
  }, [shot.key, shot.x, shot.z]);

  useFrame(() => {
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      trailFx.current?.setRateScale(0);
      return;
    }

    // Follow caster while the dash is live (~travel window).
    const followUntil = BLOOD_RUSH_CAST.travelMs + 40;
    if (age <= followUntil && shot.followOwnerId) {
      let x = shot.x;
      let z = shot.z;
      let yaw = shot.yaw;
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        x = local.x;
        z = local.z;
        yaw = local.yaw;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (p) {
          x = p.x ?? x;
          z = p.z ?? z;
          yaw = p.yaw ?? yaw;
        }
      }

      const prev = last.current;
      if (!prev.seeded) {
        prev.x = x;
        prev.z = z;
        prev.seeded = true;
      } else {
        const dx = x - prev.x;
        const dz = z - prev.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= SAMPLE_DIST) {
          const face = Math.atan2(dx, dz);
          const sampleX = (x + prev.x) * 0.5;
          const sampleZ = (z + prev.z) * 0.5;
          burstElementRole("blood", "ground", sampleX, 0.05, sampleZ);
          prev.x = x;
          prev.z = z;
          trailFx.current?.setPoseYaw(x, 0.12, z, face);
        }
      }
      trailFx.current?.setPoseYaw(x, 0.12, z, yaw);
      trailFx.current?.setRateScale(1);
    } else {
      trailFx.current?.setRateScale(0);
    }
  });

  return null;
}
