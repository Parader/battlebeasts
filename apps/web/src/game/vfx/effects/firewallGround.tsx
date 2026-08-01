import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { ABILITIES } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { FireParticleField } from "../components/FireParticleField";
import { LavaGroundStrip } from "../components/LavaGroundStrip";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { VFX_FIRE_URL } from "../vfxUrls";

const GROW_MS = 620;

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

/** Spine vents for particle fire — kept inside the hit corridor. */
function buildFireVents(halfSeg: number, hitRadius: number, seed: number): CrackVent[] {
  const rnd = mulberry32(seed | 1);
  const vents: CrackVent[] = [];
  const steps = 18;
  let prevX = -halfSeg;
  let prevZ = (rnd() - 0.5) * hitRadius * 0.2;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = -halfSeg + t * halfSeg * 2;
    const z =
      (rnd() - 0.5) * hitRadius * 0.55 +
      Math.sin(t * Math.PI * 2.4) * hitRadius * 0.12;
    const midX = (prevX + x) * 0.5;
    const midZ = (prevZ + z) * 0.5;
    vents.push({
      along: midX,
      side: midZ,
      reveal: Math.abs(midX) / Math.max(halfSeg, 0.001),
    });
    prevX = x;
    prevZ = z;
  }
  return vents;
}

/**
 * Firewall — rim marker matches the real hit stadium (sample centers + tick radius).
 * Lava/fire sit inside that footprint so the outline is the truth.
 */
export function FirewallGroundEffect({ shot }: { shot: OneShotEffect }) {
  const def = ABILITIES.firewall;
  /** Server sends wall.halfLength as `radius` on the aoe FX. */
  const halfLength = Math.max(1.5, shot.radius ?? (def.range > 0 ? def.range * 0.5 : 6.5));
  const hitRadius = Math.max(0.4, def.radius ?? 0.9);
  /** Same inset as `firewallWallPoints` — sample centers stay inside the wall. */
  const hitHalf = Math.max(1.2, halfLength - hitRadius * 0.7);
  /** True hit envelope: stadium around the sample segment. */
  const capsuleLen = hitHalf * 2 + hitRadius * 2;
  const hitWidth = hitRadius * 2;
  const lifeMs = Math.max(1200, shot.life);
  const yaw = Number.isFinite(shot.yaw) ? (shot.yaw as number) : 0;

  const auraProgress = useRef(0);
  const auraOpacity = useRef(0);

  const vents = useMemo(
    () => buildFireVents(hitHalf, hitRadius, shot.key * 9973),
    [hitHalf, hitRadius, shot.key],
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
      <AoeRimMarker
        radius={hitRadius}
        length={capsuleLen}
        shape="capsule"
        color="#ef4444"
        hotColor="#fecaca"
        fill={0.06}
        noise={0.25}
        glowWidth={0.05}
        y={0.04}
        opacity={0.55}
        opacityMulRef={auraOpacity}
      />

      <LavaGroundStrip
        length={capsuleLen}
        width={hitWidth}
        y={0.036}
        sideFade={0.18}
        endFade={0.1}
        progressRef={auraProgress}
        opacityMulRef={auraOpacity}
      />

      <FireParticleField
        emitters={fireEmitters}
        rate={95}
        maxParticles={320}
        textureUrl={VFX_FIRE_URL}
        maxLife={1.25}
        maxSize={0.5}
        rise={2.15}
        spread={0.28}
        progressRef={auraProgress}
        opacityMulRef={auraOpacity}
      />
    </group>
  );
}
