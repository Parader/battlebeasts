import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import {
  killLightningCluster,
  setLightningSegment,
  spawnLightningSegment,
  type LightningClusterOpts,
} from "../engine/lightningArcs";

const IMPACT: LightningClusterOpts = {
  strands: 2,
  spreadMul: 0.4,
  jitterMul: 0.55,
  sag: 0.08,
  tipGlow: 0,
  colorCore: "#67e8f9",
  colorInner: "#38bdf8",
  colorOuter: "#0ea5e9",
  colorHalo: "#0b3fc8",
};

const RAYS = 5;
const REACH_MIN = 0.28;
const REACH_MAX = 0.7;
const END_Y_MIN = -0.4;
const END_Y_MAX = 0.5;

function hash11(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Bolt impact — radial tip forks (no spheres / rings / runes).
 */
export function BoltImpactEffect({ shot }: { shot: OneShotEffect }) {
  const rayIds = useRef<number[]>([]);
  const killed = useRef(false);

  const killAll = () => {
    for (const id of rayIds.current) killLightningCluster(id);
    rayIds.current = [];
    killed.current = true;
  };

  useEffect(() => {
    killed.current = false;
    const tx = shot.x;
    const ty = shot.y;
    const tz = shot.z;
    for (let i = 0; i < RAYS; i++) {
      const u = hash11(shot.key * 13.1 + i * 7.7);
      const v = hash11(shot.key * 19.3 + i * 3.1 + 1.4);
      const w = hash11(shot.key * 5.9 + i * 11.2 + 2.8);
      const angle = (i / RAYS) * Math.PI * 2 + u * 0.5;
      const reach = REACH_MIN + v * (REACH_MAX - REACH_MIN);
      const endY = ty + END_Y_MIN + w * (END_Y_MAX - END_Y_MIN);
      const bx = tx + Math.cos(angle) * reach;
      const bz = tz + Math.sin(angle) * reach;
      const id = spawnLightningSegment(tx, ty, tz, bx, endY, bz, IMPACT);
      if (id >= 0) rayIds.current.push(id);
    }
    return () => killAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.key]);

  useFrame(() => {
    if (killed.current) return;
    const age = (performance.now() - shot.born) / Math.max(16, shot.life);
    if (age >= 1) {
      killAll();
      return;
    }
    const amp = softEnvelope(age, 0.22, 0.4);
    if (amp < 0.05 && age > 0.35) {
      killAll();
      return;
    }
    // Soft spin so the forks don't look locked.
    const spin = (performance.now() - shot.born) * 0.004;
    const tx = shot.x;
    const ty = shot.y;
    const tz = shot.z;
    for (let i = 0; i < rayIds.current.length; i++) {
      const id = rayIds.current[i]!;
      const u = hash11(shot.key * 13.1 + i * 7.7);
      const v = hash11(shot.key * 19.3 + i * 3.1 + 1.4);
      const w = hash11(shot.key * 5.9 + i * 11.2 + 2.8);
      const angle = (i / RAYS) * Math.PI * 2 + u * 0.5 + spin;
      const reach = REACH_MIN + v * (REACH_MAX - REACH_MIN);
      const endY = ty + END_Y_MIN + w * (END_Y_MAX - END_Y_MIN);
      const bx = tx + Math.cos(angle) * reach;
      const bz = tz + Math.sin(angle) * reach;
      if (!setLightningSegment(id, tx, ty, tz, bx, endY, bz)) {
        rayIds.current[i] = spawnLightningSegment(tx, ty, tz, bx, endY, bz, IMPACT);
      }
    }
  });

  return null;
}
