import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { smooth01 } from "../easing";
import { createCirclePointMaterial } from "../materials/circlePoint";

const N = 6;
const BRIGHT = "#38bdf8";
const HOT = "#e0f2fe";

/**
 * Orbiting Wisp hit / dissipate — tiny compress flash + a few motes (no boom).
 */
export function OrbitingWispHitEffect({ shot }: { shot: OneShotEffect }) {
  const group = useRef<THREE.Group>(null);
  const flash = useRef<THREE.Mesh>(null);

  const flashMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: HOT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const pos = useMemo(() => new Float32Array(N * 3), []);
  const size = useMemo(() => new Float32Array(N), []);
  const alpha = useMemo(() => new Float32Array(N), []);
  const dirs = useMemo(
    () =>
      Array.from({ length: N }, () => {
        const a = Math.random() * Math.PI * 2;
        return {
          x: Math.cos(a),
          y: 0.2 + Math.random() * 0.6,
          z: Math.sin(a),
          speed: 0.9 + Math.random() * 1.1,
        };
      }),
    [],
  );
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    return g;
  }, [pos, size, alpha]);
  const pointMat = useMemo(() => createCirclePointMaterial(BRIGHT), []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    if (ms >= shot.life) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const flashT = smooth01(Math.min(1, ms / 35));
    const breakT = ms < 25 ? 0 : Math.min(1, (ms - 25) / 90);
    const fade = ms < 50 ? 1 : 1 - Math.min(1, (ms - 50) / (shot.life - 50));

    if (flash.current) {
      flash.current.scale.setScalar(THREE.MathUtils.lerp(0.08, 0.28, flashT) * (1 - breakT * 0.4));
      flashMat.opacity = flashT * (1 - breakT) * 0.9 * fade;
    }
    for (let i = 0; i < N; i++) {
      const d = dirs[i]!;
      pos[i * 3] = d.x * d.speed * breakT * 0.4;
      pos[i * 3 + 1] = d.y * d.speed * breakT * 0.35;
      pos[i * 3 + 2] = d.z * d.speed * breakT * 0.4;
      size[i] = (0.03 + (1 - breakT) * 0.025) * 36;
      alpha[i] = (1 - breakT) * 0.8 * fade;
    }
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.aSize!.needsUpdate = true;
    geo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={group} position={[shot.x, shot.y, shot.z]}>
      <mesh ref={flash} material={flashMat} renderOrder={8}>
        <sphereGeometry args={[1, 10, 10]} />
      </mesh>
      <points geometry={geo} material={pointMat} renderOrder={7} />
    </group>
  );
}
