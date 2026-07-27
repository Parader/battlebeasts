import type { OneShotEffect } from "../types";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";

/**
 * Leap Slam landing — single earth ground decal (crater + fissures).
 */
export function SmashCrackEffect({ shot }: { shot: OneShotEffect }) {
  const p = groundPresets.earthSlam;
  const radius = shot.radius ?? p.radius;
  return (
    <GroundDecal
      preset={p}
      shape="circle"
      x={shot.x}
      z={shot.z}
      y={0.03}
      born={shot.born}
      life={shot.life}
      radius={radius}
    />
  );
}
