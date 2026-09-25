import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CRUSHING_SIGIL_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { getCombatOwnerPose } from "../../characterRoots";
import { burstElementRole, spawnElementRole, type ElementHandle } from "../engine";
import { resolveHandPose, type HandPose } from "../handPose";

const FUSE_MS = CRUSHING_SIGIL_CAST.delayedImpactMs;

/**
 * Crushing Sigil — void ground while the rune charges, void impact when it
 * collapses, and a void cast puff in the raised hand at the stamp.
 */
export function CrushingSigilEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const ground = useRef<ElementHandle | null>(null);
  const blown = useRef(false);
  const exploded = useRef(false);
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw });
  const hand = useRef<HandPose>({ x: shot.x, y: 1.15, z: shot.z });
  const radius = Math.max(0.6, shot.radius ?? CRUSHING_SIGIL_CAST.radius);

  useEffect(() => {
    const handle = spawnElementRole("void", "ground", shot.x, 0.08, shot.z, {
      duration: FUSE_MS / 1000 + 0.2,
      spread: radius * 0.65,
    });
    ground.current = handle;
    return () => {
      handle.kill();
      if (ground.current === handle) ground.current = null;
    };
  }, [shot.key, shot.x, shot.z, radius]);

  useFrame(() => {
    if (shot.followOwnerId) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        pose.current.yaw = local.yaw;
        pose.current.x = local.x;
        pose.current.z = local.z;
      } else {
        const p = getCombatOwnerPose(follow.room, shot.followOwnerId);
        if (p) {
          pose.current.yaw = p.yaw ?? pose.current.yaw;
          pose.current.x = p.x ?? pose.current.x;
          pose.current.z = p.z ?? pose.current.z;
        }
      }
    }

    if (!blown.current) {
      blown.current = true;
      const fx = Math.sin(pose.current.yaw);
      const fz = Math.cos(pose.current.yaw);
      resolveHandPose(
        hand.current,
        shot.followOwnerId,
        pose.current.x,
        pose.current.z,
        fx,
        fz,
      );
      burstElementRole("void", "cast", hand.current.x, hand.current.y, hand.current.z, {
        burst: 12,
        spread: 0.35,
        dirY: 0.85,
      });
    }

    if (exploded.current) return;
    if (performance.now() - shot.born < FUSE_MS) return;
    exploded.current = true;
    ground.current?.kill();
    ground.current = null;
    burstElementRole("void", "impact", shot.x, 0.25, shot.z, {
      spread: radius * 0.85,
      burst: 32,
      size: 0.62,
      life: 0.75,
    });
  });

  return null;
}
