import { useEffect } from "react";
import type { OneShotEffect } from "../types";
import {
  ATLAS_UV,
  BatchId,
  Collide,
  LodRank,
  burstElementRole,
  spawnEmitter,
} from "../engine";

/** Full pop is stage 3. Stage 1 is a tight cap burst. */
const STAGE_POP = [0, 0.36, 0.66, 1] as const;

function shroomStage(shot: OneShotEffect): 1 | 2 | 3 {
  const n = Math.round(shot.comboHit ?? 3);
  if (n <= 1) return 1;
  if (n === 2) return 2;
  return 3;
}

function popHeal(x: number, y: number, z: number, mul: number): void {
  const spray = 1.25 * mul;
  const sizeMul = 0.5 + 0.5 * mul;
  burstElementRole("heal", "impact", x, y, z, {
    dirY: 2.8 * mul,
    spread: spray,
    gravity: -0.35,
    drag: 0.12,
    noise: 0.5,
    burst: Math.max(10, Math.round(32 * mul)),
    life: 0.65 * (0.72 + 0.28 * mul),
    size: 0.38 * sizeMul,
    sizeEnd: 0.05 * sizeMul,
    collide: Collide.None,
  });
  burstElementRole("heal", "cast", x, y + 0.12, z, {
    duration: 0.05,
    rate: 0,
    burst: Math.max(6, Math.round(18 * mul)),
    dirY: 2.4 * mul,
    spread: spray * 0.75,
    gravity: -0.2,
    drag: 0.08,
    life: 0.5 * (0.72 + 0.28 * mul),
    collide: Collide.None,
  });
}

/**
 * Blood impact recipes are floor spills. Shroom trigger needs a hanging pop,
 * so this bypasses the role preset instead of fighting dirY / gravity.
 */
function popBlood(x: number, y: number, z: number, mul: number): void {
  const spray = 1.55 * mul;
  const sizeMul = 0.5 + 0.5 * mul;
  const life = 0.72 * (0.72 + 0.28 * mul);
  spawnEmitter({
    x,
    y,
    z,
    duration: 0.06,
    rate: 0,
    burst: Math.max(12, Math.round(40 * mul)),
    dirX: 0,
    dirY: 2.9 * mul,
    dirZ: 0,
    spread: spray,
    gravity: -0.45,
    drag: 0.1,
    noise: 0.4,
    collide: Collide.None,
    groundY: 0,
    batch: BatchId.AdditiveFire,
    atlasUv: ATLAS_UV.fire,
    size: 0.46 * sizeMul,
    sizeEnd: 0.08 * sizeMul,
    life,
    lifeJitter: 0.3,
    opacity: 1,
    rotRate: 1.1,
    rotJitter: 0.5,
    color0: "#fff5f5",
    color1: "#ef4444",
    color2: "#9f1239",
    lod: LodRank.Core,
  });
  spawnEmitter({
    x,
    y: y + 0.08,
    z,
    duration: 0.05,
    rate: 0,
    burst: Math.max(10, Math.round(28 * mul)),
    dirX: 0,
    dirY: 2.4 * mul,
    dirZ: 0,
    spread: spray * 1.15,
    gravity: -0.55,
    drag: 0.08,
    noise: 0.35,
    collide: Collide.None,
    groundY: 0,
    batch: BatchId.AdditiveSpark,
    atlasUv: ATLAS_UV.spark,
    size: 0.28 * sizeMul,
    sizeEnd: 0.05 * sizeMul,
    life: life * 0.85,
    lifeJitter: 0.35,
    opacity: 1,
    rotRate: 0.4,
    rotJitter: 0.5,
    color0: "#fecaca",
    color1: "#f87171",
    color2: "#b91c1c",
    lod: LodRank.Core,
  });
  spawnEmitter({
    x,
    y: y + 0.16,
    z,
    duration: 0.05,
    rate: 0,
    burst: Math.max(6, Math.round(16 * mul)),
    dirX: 0,
    dirY: 1.6 * mul,
    dirZ: 0,
    spread: spray * 0.7,
    gravity: -0.25,
    drag: 0.15,
    noise: 0.3,
    collide: Collide.None,
    groundY: 0,
    batch: BatchId.AdditiveSpark,
    atlasUv: ATLAS_UV.spark,
    size: 0.2 * sizeMul,
    sizeEnd: 0.04 * sizeMul,
    life: 0.48 * (0.72 + 0.28 * mul),
    lifeJitter: 0.25,
    opacity: 0.95,
    rotRate: 0.2,
    color0: "#fecaca",
    color1: "#ef4444",
    color2: "#7f1d1d",
    lod: LodRank.Trail,
  });
}

/**
 * Spore Shroom trigger — heal/blood particle explosion at the cap.
 *
 * No disc / ring / follow-mark on the walker. Caster/plant and HoT wells own those.
 */
export function ShroomBurstEffect({ shot }: { shot: OneShotEffect }) {
  const ally = Number(shot.variant ?? 1) !== 2;
  const stage = shroomStage(shot);
  const mul = STAGE_POP[stage]!;
  const blastX = shot.originX ?? shot.x;
  const blastZ = shot.originZ ?? shot.z;

  useEffect(() => {
    const y = 0.52 + 0.18 * mul;
    if (ally) popHeal(blastX, y, blastZ, mul);
    else popBlood(blastX, y, blastZ, mul);
  }, [shot.key, blastX, blastZ, ally, mul]);

  return null;
}
