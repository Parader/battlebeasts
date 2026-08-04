import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { ABILITIES } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { abilityVfxColor } from "../colors";

/** Earth-brown hit rim — matches Jump Slam / smash palette. */
const EARTH = abilityVfxColor("smash", "#a16207");
const EARTH_HOT = "#d97706";

/** Visual crack disc vs true hit radius — reads bigger than the stun rim. */
const CRACK_RADIUS_MUL = 1.45;

/**
 * Leap Slam landing — dense earth crater (oversized) + brown hitbox rim (true AoE).
 */
export function SmashCrackEffect({ shot }: { shot: OneShotEffect }) {
  const hitRadius = Math.max(1.5, shot.radius ?? ABILITIES.smash.radius ?? groundPresets.earthSlam.radius);
  const crackRadius = hitRadius * CRACK_RADIUS_MUL;
  const lifeMs = Math.max(400, shot.life || groundPresets.earthSlam.lifeMs);
  const rimOpacity = useRef(0);

  const crackPreset = useMemo(
    () => ({
      ...groundPresets.earthSlam,
      // Denser, darker soil so fissures read on grass (earth shader is naturally sparse).
      colorCore: "#c4a35a",
      colorMid: "#5c3d24",
      colorEdge: "#120c08",
      breakup: 0.42,
      opacity: 1.35,
      radius: crackRadius,
      lifeMs,
      ringWidth: 0.16,
      softness: 0.03,
      innerRatio: 0.22,
      noiseScale: 5.4,
      appearEnd: 0.04,
      fadeStart: 0.72,
    }),
    [crackRadius, lifeMs],
  );

  useFrame(() => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    // Brief hitbox flash — readable on land, gone quickly.
    rimOpacity.current = softEnvelope(u, 0.06, 0.38) * 0.95;
  });

  return (
    <group position={[shot.x, 0, shot.z]}>
      <AoeRimMarker
        x={0}
        z={0}
        y={0.026}
        radius={hitRadius}
        color={EARTH}
        hotColor={EARTH_HOT}
        fill={0.14}
        noise={0.35}
        rimWidth={0.022}
        glowWidth={0.06}
        opacity={0.72}
        opacityMulRef={rimOpacity}
        pulse={false}
      />
      <GroundDecal
        preset={crackPreset}
        shape="circle"
        x={0}
        z={0}
        y={0.032}
        born={shot.born}
        life={lifeMs}
        radius={crackRadius}
        opacityMul={1.25}
      />
    </group>
  );
}
