import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { getCombatOwnerPose } from "../../characterRoots";
import { burstElementRole } from "../engine";

/** Hook leaves ahead of the chest, not inside the body. */
const BLOW_REACH = 0.95;
const BLOW_Y = 0.95;

/**
 * Astral Chain caster blow — small void puff in front of the caster.
 */
export function AstralChainCastEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const blown = useRef(false);
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw });

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

    if (blown.current) return;
    blown.current = true;
    const fx = Math.sin(pose.current.yaw);
    const fz = Math.cos(pose.current.yaw);
    burstElementRole(
      "void",
      "cast",
      pose.current.x + fx * BLOW_REACH,
      BLOW_Y,
      pose.current.z + fz * BLOW_REACH,
      {
        burst: 7,
        spread: 0.24,
        size: 0.2,
        sizeEnd: 0.04,
        life: 0.32,
        dirX: fx * 0.9,
        dirY: 0.15,
        dirZ: fz * 0.9,
      },
    );
  });

  return null;
}
