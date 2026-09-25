/** ParticleWorld-backed Spirit Form return trail. */
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { SPIRIT_FORM_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { spawnElementRole, type ElementHandle } from "../engine";

/**
 * Soft spirit trail following the caster during Spirit Form return.
 */
export function SpiritReturnTrailEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const trail = useRef<ElementHandle | null>(null);

  useEffect(() => {
    const handle = spawnElementRole("holy", "trail", shot.x, 0.85, shot.z);
    handle.setRateScale(0);
    trail.current = handle;
    return () => {
      handle.kill();
      if (trail.current === handle) trail.current = null;
    };
  }, [shot.key, shot.x, shot.z]);

  useFrame(() => {
    const handle = trail.current;
    if (!handle) return;
    const age = performance.now() - shot.born;
    const lifeMs = Math.max(320, shot.life);
    if (age >= lifeMs) {
      handle.kill();
      trail.current = null;
      return;
    }

    const followUntil = SPIRIT_FORM_CAST.snapReturnMaxMs + 60;
    let x = shot.x;
    let z = shot.z;
    if (age <= followUntil && shot.followOwnerId) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        x = local.x;
        z = local.z;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number }
          | undefined;
        if (p) {
          x = p.x ?? x;
          z = p.z ?? z;
        }
      }
    }

    const fade = age <= followUntil ? Math.min(1, (lifeMs - age) / 160) : 0;
    handle.setPose(x, 0.85, z);
    handle.setRateScale(fade);
  });

  return null;
}
