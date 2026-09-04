import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import {
  BLOOMING_CORE,
  BLOOMING_HARMONY,
  BLOOMING_MAIN,
  BLOOMING_WARM,
} from "./bloomingPathPalette";

const PETAL_COUNT = 6;

/**
 * Soft blossom + rising leaves when Blooming Path touches an ally.
 */
export function BloomingPathBlossomEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const petals = useRef<(THREE.Mesh | null)[]>([]);
  const leaves = useRef<(THREE.Mesh | null)[]>([]);

  const mats = useMemo(() => {
    const mk = (color: THREE.Color, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
    return {
      ring: mk(BLOOMING_MAIN, 0.55),
      core: mk(BLOOMING_CORE, 0.7),
      petals: Array.from({ length: PETAL_COUNT }, () => mk(BLOOMING_WARM, 0.65)),
      leaves: Array.from({ length: 4 }, () => mk(BLOOMING_HARMONY, 0.55)),
    };
  }, []);

  const ringGeo = useMemo(() => {
    const geo = new THREE.RingGeometry(0.12, 0.32, 24);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = shot.life ?? 420;
    if (ms >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(shot.x, 0.05, shot.z);

    const t = ms / life;
    const appear = softEnvelope(Math.min(1, ms / 60), 0.12, 0.4);
    const fade = 1 - softEnvelope(Math.max(0, (ms - life * 0.45) / (life * 0.55)), 0.1, 0.5);
    const pulse = appear * fade;

    if (ring.current) {
      const s = 0.7 + t * 1.4;
      ring.current.scale.setScalar(s);
      mats.ring.opacity = 0.45 * pulse * (1 - t * 0.5);
    }
    if (core.current) {
      core.current.position.y = 0.35 + t * 0.25;
      core.current.scale.setScalar(0.12 * (0.8 + appear));
      mats.core.opacity = 0.65 * pulse;
    }

    for (let i = 0; i < PETAL_COUNT; i++) {
      const mesh = petals.current[i];
      if (!mesh) continue;
      const a = (i / PETAL_COUNT) * Math.PI * 2 + t * 0.8;
      const r = 0.18 + t * 0.22;
      mesh.position.set(Math.cos(a) * r, 0.08 + t * 0.15, Math.sin(a) * r);
      mesh.scale.set(0.06, 0.02, 0.1);
      mesh.rotation.set(0.4, a, 0.2);
      mats.petals[i]!.opacity = 0.55 * pulse;
    }

    for (let i = 0; i < 4; i++) {
      const mesh = leaves.current[i];
      if (!mesh) continue;
      const a = (i / 4) * Math.PI * 2 + 0.4;
      mesh.position.set(Math.cos(a) * 0.1, 0.2 + t * 0.55, Math.sin(a) * 0.1);
      mesh.scale.setScalar(0.045 * (1 - t * 0.4));
      mesh.rotation.set(t * 1.5, a, t);
      mats.leaves[i]!.opacity = 0.5 * pulse * (1 - t);
    }
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={ring} geometry={ringGeo} renderOrder={30}>
        <primitive object={mats.ring} attach="material" />
      </mesh>
      <mesh ref={core} renderOrder={32}>
        <sphereGeometry args={[1, 8, 8]} />
        <primitive object={mats.core} attach="material" />
      </mesh>
      {mats.petals.map((mat, i) => (
        <mesh
          key={`petal-${i}`}
          ref={(el) => {
            petals.current[i] = el;
          }}
          renderOrder={31}
        >
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={mat} attach="material" />
        </mesh>
      ))}
      {mats.leaves.map((mat, i) => (
        <mesh
          key={`leaf-${i}`}
          ref={(el) => {
            leaves.current[i] = el;
          }}
          renderOrder={31}
        >
          <octahedronGeometry args={[1, 0]} />
          <primitive object={mat} attach="material" />
        </mesh>
      ))}
    </group>
  );
}
