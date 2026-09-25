import { useEffect } from "react";
import type { OneShotEffect } from "../types";
import { ATLAS_UV, BatchId, Collide, LodRank, spawnEmitter } from "../engine";
import { playVoidDiscHitSfx } from "../../gameSfx";

/**
 * Void Disc body hit — a small void spark.
 *
 * The disc can clip several people and the same body twice, so this stays quiet.
 */
export function VoidDiscHitEffect({ shot }: { shot: OneShotEffect }) {
  useEffect(() => {
    playVoidDiscHitSfx();
    spawnEmitter({
      x: shot.x,
      y: shot.y || 0.7,
      z: shot.z,
      duration: 0.05,
      rate: 0,
      burst: 6,
      dirX: 0,
      dirY: 0.35,
      dirZ: 0,
      spread: 0.19,
      gravity: -0.15,
      drag: 0.6,
      noise: 0.45,
      collide: Collide.None,
      groundY: 0,
      batch: BatchId.AdditiveSpark,
      atlasUv: ATLAS_UV.void,
      size: 0.15,
      sizeEnd: 0.04,
      life: 0.28,
      lifeJitter: 0.25,
      opacity: 0.9,
      rotRate: 1.2,
      color0: "#f5d0fe",
      color1: "#c026d3",
      color2: "#6b21a8",
      lod: LodRank.Core,
    });
  }, [shot.key, shot.x, shot.y, shot.z]);

  return null;
}
