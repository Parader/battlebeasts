import { useEffect } from "react";
import type { OneShotEffect } from "../types";
import { ATLAS_UV, BatchId, Collide, LodRank, spawnEmitter } from "../engine";

/**
 * Astral Chain hook land — void spark on the body.
 */
export function AstralChainHitEffect({ shot }: { shot: OneShotEffect }) {
  useEffect(() => {
    spawnEmitter({
      x: shot.x,
      y: shot.y || 1.05,
      z: shot.z,
      duration: 0.05,
      rate: 0,
      burst: 16,
      dirX: 0,
      dirY: 0.55,
      dirZ: 0,
      spread: 0.38,
      gravity: -0.25,
      drag: 0.5,
      noise: 0.45,
      collide: Collide.None,
      groundY: 0,
      batch: BatchId.AdditiveSpark,
      atlasUv: ATLAS_UV.void,
      size: 0.28,
      sizeEnd: 0.07,
      life: 0.42,
      lifeJitter: 0.25,
      opacity: 0.9,
      rotRate: 1.1,
      color0: "#f5d0fe",
      color1: "#c026d3",
      color2: "#6b21a8",
      lod: LodRank.Core,
    });
  }, [shot.key, shot.x, shot.y, shot.z]);

  return null;
}
