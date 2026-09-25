import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { getCombatOwnerPose } from "../../characterRoots";
import { burstElementRole } from "../engine";
import { resolveHandPose, type HandPose } from "../handPose";

/**
 * Soul Mark caster blow — void puff at the throwing hand.
 *
 * Travel/impact: projectile + rupture own those beats.
 * Particles: void cast + a short smoke curl; no mesh, no light.
 */
export function SoulMarkCastEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const blown = useRef(false);
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw });
  const hand = useRef<HandPose>({ x: shot.x, y: shot.y, z: shot.z });

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

    if (blown.current) return;
    blown.current = true;
    burstElementRole("void", "cast", hand.current.x, hand.current.y, hand.current.z);
    burstElementRole("void", "ground", hand.current.x, hand.current.y, hand.current.z, {
      duration: 0.08,
      burst: 8,
      rate: 0,
    });
  });

  return null;
}
