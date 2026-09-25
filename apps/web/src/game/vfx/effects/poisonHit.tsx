import { useEffect } from "react";
import type { OneShotEffect } from "../types";
import { ATLAS_UV, BatchId, Collide, LodRank, spawnEmitter } from "../engine";

/**
 * Poison dart body hit. DoT ticks stay on StatusAuraFx — no per-tick burst.
 */
export function PoisonHitEffect({ shot }: { shot: OneShotEffect }) {
  useEffect(() => {
    const x = shot.x;
    const y = shot.y || 0.7;
    const z = shot.z;
    spawnEmitter({
      x,
      y,
      z,
      duration: 0.05,
      rate: 0,
      burst: 18,
      dirX: 0,
      dirY: 1.35,
      dirZ: 0,
      spread: 0.34,
      gravity: -0.35,
      drag: 0.35,
      noise: 0.75,
      collide: Collide.None,
      groundY: 0,
      batch: BatchId.AdditiveSpark,
      atlasUv: ATLAS_UV.spark,
      size: 0.2,
      sizeEnd: 0.04,
      life: 0.52,
      lifeJitter: 0.35,
      opacity: 0.95,
      rotRate: 0.5,
      rotJitter: 0.4,
      color0: "#ecfccb",
      color1: "#84cc16",
      color2: "#3f6212",
      lod: LodRank.Core,
    });
    spawnEmitter({
      x,
      y: y + 0.08,
      z,
      duration: 0.05,
      rate: 0,
      burst: 10,
      dirX: 0,
      dirY: 0.85,
      dirZ: 0,
      spread: 0.24,
      gravity: -0.2,
      drag: 0.5,
      noise: 0.55,
      collide: Collide.None,
      groundY: 0,
      batch: BatchId.AdditiveSpark,
      atlasUv: ATLAS_UV.spark,
      size: 0.12,
      sizeEnd: 0.025,
      life: 0.4,
      lifeJitter: 0.3,
      opacity: 0.9,
      color0: "#bef264",
      color1: "#65a30d",
      color2: "#365314",
      lod: LodRank.Trail,
    });
  }, [shot.key, shot.x, shot.y, shot.z]);

  return null;
}
