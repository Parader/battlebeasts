import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { FireParticleField } from "../components/FireParticleField";
import { LavaGroundStrip } from "../components/LavaGroundStrip";

const GROW_MS = 620;
/** Matches ability `radius` — corridor half-width for hits. */
const HIT_HALF_WIDTH = 0.9;
/**
 * VFX is wider than the hit half-width so side-fade + lava heat-mask still
 * read as covering the full scorched corridor.
 */
const VISUAL_WIDTH_MUL = 1.85;

type CrackVent = {
  along: number;
  side: number;
  reveal: number;
};

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spine vents for particle fire — matches old crack midline zigzag. */
function buildFireVents(halfLen: number, thickness: number, seed: number): CrackVent[] {
  const rnd = mulberry32(seed | 1);
  const vents: CrackVent[] = [];
  const steps = 18;
  let prevX = -halfLen;
  let prevZ = (rnd() - 0.5) * thickness * 0.12;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = -halfLen + t * halfLen * 2;
    const z =
      (rnd() - 0.5) * thickness * 0.35 +
      Math.sin(t * Math.PI * 2.4) * thickness * 0.08;
    const midX = (prevX + x) * 0.5;
    const midZ = (prevZ + z) * 0.5;
    vents.push({
      along: midX,
      side: midZ,
      reveal: Math.abs(midX) / Math.max(halfLen, 0.001),
    });
    prevX = x;
    prevZ = z;
  }
  return vents;
}

/**
 * Firewall — lava.png ground strip (side-faded) + particle fire from vents.
 */
export function FirewallGroundEffect({ shot }: { shot: OneShotEffect }) {
  const halfLen = Math.max(2, shot.radius ?? 6.5);
  const hitWidth = HIT_HALF_WIDTH * 2;
  const visualWidth = hitWidth * VISUAL_WIDTH_MUL;
  const thickness = visualWidth * 0.95;
  const fullLen = halfLen * 2;
  const lifeMs = Math.max(1200, shot.life);
  const yaw = Number.isFinite(shot.yaw) ? (shot.yaw as number) : 0;

  const auraProgress = useRef(0);
  const auraOpacity = useRef(0);

  const vents = useMemo(
    () => buildFireVents(halfLen, thickness, shot.key * 9973),
    [halfLen, thickness, shot.key],
  );

  const fireEmitters = useMemo(
    () =>
      vents.map((v) => ({
        x: v.along,
        y: 0.06,
        z: v.side,
        reveal: v.reveal,
      })),
    [vents],
  );

  useFrame(() => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    const grow = Math.max(0, Math.min(1, age / GROW_MS));
    auraProgress.current = 1 - (1 - grow) * (1 - grow);
    auraOpacity.current = softEnvelope(u, 0.04, 0.88);
  });

  const x = Number.isFinite(shot.x) ? shot.x : 0;
  const z = Number.isFinite(shot.z) ? shot.z : 0;

  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <LavaGroundStrip
        length={fullLen}
        width={visualWidth}
        y={0.036}
        sideFade={0.22}
        endFade={0.07}
        progressRef={auraProgress}
        opacityMulRef={auraOpacity}
      />

      <FireParticleField
        emitters={fireEmitters}
        rate={95}
        maxParticles={320}
        textureUrl="/assets/vfx/fire.png"
        maxLife={1.25}
        maxSize={0.55}
        rise={2.15}
        spread={0.34}
        progressRef={auraProgress}
        opacityMulRef={auraOpacity}
      />
    </group>
  );
}
