import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { ATLAS_UV, BatchId, burstElementRole } from "../engine";
import { getVfxCircleTexture } from "../materials/circlePoint";

/**
 * Orbiting Wisp impact — the same wind streaks and soft circle as the wisp,
 * popped outward on the target.
 */
export function OrbitingWispHitEffect({ shot }: { shot: OneShotEffect }) {
  const sprite = useRef<THREE.Sprite>(null);
  const burst = useRef(false);
  const mat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: getVfxCircleTexture(),
        color: "#7dd3fc",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(() => {
    const ms = performance.now() - shot.born;
    const life = Math.max(1, shot.life);
    if (!burst.current) {
      burst.current = true;
      burstElementRole("wind", "trail", shot.x, shot.y, shot.z, {
        batch: BatchId.AlphaIce,
        atlasUv: ATLAS_UV.wind,
        rate: 0,
        burst: 16,
        size: 0.5,
        sizeEnd: 0.08,
        life: 0.45,
        lifeJitter: 0.25,
        spread: 1.1,
        dirX: 0,
        dirY: 0.7,
        dirZ: 0,
        noise: 0.45,
        drag: 0.85,
        gravity: 0,
        opacity: 0.85,
        rotRate: 0,
        rotJitter: 0,
        color0: "#f0f9ff",
        color1: "#7dd3fc",
        color2: "#1d4ed8",
      });
    }
    const u = Math.min(1, ms / life);
    const fade = 1 - u;
    mat.opacity = fade * fade * 0.95;
    if (sprite.current) {
      sprite.current.scale.setScalar(THREE.MathUtils.lerp(0.28, 0.72, u));
      sprite.current.visible = fade > 0.04;
    }
  });

  return <sprite ref={sprite} position={[shot.x, shot.y, shot.z]} material={mat} />;
}
