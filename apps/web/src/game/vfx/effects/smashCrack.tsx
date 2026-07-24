import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";

const CRACK = "#3f2a1d";
const CRACK_EDGE = "#1c1410";

type CrackSeg = {
  angle: number;
  length: number;
  width: number;
  wobble: number;
};

/**
 * Leap Slam landing — radial ground cracks in a circle that punch out then settle.
 */
export function SmashCrackEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const radius = 2.35;

  const segs = useMemo(() => {
    const list: CrackSeg[] = [];
    const count = 14;
    for (let i = 0; i < count; i++) {
      const base = (i / count) * Math.PI * 2;
      list.push({
        angle: base + (Math.random() - 0.5) * 0.22,
        length: radius * (0.55 + Math.random() * 0.5),
        width: 0.045 + Math.random() * 0.04,
        wobble: (Math.random() - 0.5) * 0.35,
      });
      // Secondary shorter fork
      if (Math.random() > 0.35) {
        list.push({
          angle: base + (Math.random() - 0.5) * 0.5,
          length: radius * (0.28 + Math.random() * 0.28),
          width: 0.03 + Math.random() * 0.025,
          wobble: (Math.random() - 0.5) * 0.55,
        });
      }
    }
    return list;
  }, []);

  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: CRACK_EDGE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );
  const crackMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: CRACK,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = (performance.now() - shot.born) / shot.life;
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;

    // Punch out fast, hold, then fade
    const expand = THREE.MathUtils.smoothstep(age, 0, 0.22);
    const amp = softEnvelope(age, 0.12, 0.55);
    ringMat.opacity = amp * 0.75;
    crackMat.opacity = amp * 0.95;

    const ring = g.children[0] as THREE.Mesh | undefined;
    if (ring) {
      const s = 0.35 + expand * 1.05;
      ring.scale.set(s, s, 1);
    }

    for (let i = 0; i < segs.length; i++) {
      const mesh = g.children[i + 1] as THREE.Mesh | undefined;
      if (!mesh) continue;
      const seg = segs[i]!;
      const grow = THREE.MathUtils.smoothstep(age, 0.02 + (i % 5) * 0.015, 0.28);
      const len = seg.length * grow;
      mesh.scale.set(seg.width, 1, Math.max(0.001, len));
      mesh.position.set(
        Math.sin(seg.angle) * (len * 0.5),
        0.025,
        Math.cos(seg.angle) * (len * 0.5),
      );
    }
  });

  return (
    <group ref={root} position={[shot.x, 0.02, shot.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={0.35}>
        <ringGeometry args={[0.55, 0.72, 40]} />
        <primitive object={ringMat} attach="material" />
      </mesh>
      {segs.map((seg, i) => (
        <mesh
          key={i}
          rotation={[0, seg.angle + seg.wobble, 0]}
          position={[0, 0.025, 0]}
          scale={[seg.width, 1, 0.001]}
        >
          <boxGeometry args={[1, 0.02, 1]} />
          <primitive object={crackMat} attach="material" />
        </mesh>
      ))}
    </group>
  );
}
