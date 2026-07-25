import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";

type RootSpec = {
  ox: number;
  oz: number;
  yaw: number;
  leanX: number;
  leanZ: number;
  twist: number;
  height: number;
  thick: number;
  /** Side thorn lean relative to main stalk. */
  thornLean: number;
  thornYaw: number;
  thornScale: number;
};

type MistSpec = {
  ox: number;
  oz: number;
  rise: number;
  driftX: number;
  driftZ: number;
  size: number;
  delay: number;
};

/**
 * Poisonous root burst — long twisted stalks + mist, no ground rings.
 */
export function SpikesPopEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const stalksRef = useRef<THREE.Group>(null);
  const mistRef = useRef<THREE.Group>(null);

  const roots = useMemo((): RootSpec[] => {
    const seed = shot.key * 7919;
    const out: RootSpec[] = [];
    for (let i = 0; i < 4; i++) {
      const a = ((seed + i * 97) % 1000) / 1000;
      const b = ((seed + i * 53) % 1000) / 1000;
      const ang = a * Math.PI * 2;
      const dist = 0.06 + b * 0.2;
      out.push({
        ox: Math.cos(ang) * dist,
        oz: Math.sin(ang) * dist,
        yaw: ang + ((seed + i * 13) % 100) / 100 * 0.6,
        leanX: (a - 0.5) * 0.55,
        leanZ: (b - 0.5) * 0.55,
        twist: ((seed + i * 29) % 100) / 100 * 0.35 - 0.17,
        height: 1.15 + ((seed + i * 41) % 100) / 100 * 0.45,
        thick: 0.7 + ((seed + i * 17) % 100) / 100 * 0.35,
        thornLean: 0.55 + ((seed + i * 7) % 100) / 100 * 0.4,
        thornYaw: ang + Math.PI * (0.35 + ((seed + i) % 50) / 100),
        thornScale: 0.45 + ((seed + i * 23) % 100) / 100 * 0.25,
      });
    }
    return out;
  }, [shot.key]);

  const mist = useMemo((): MistSpec[] => {
    const seed = shot.key * 4243;
    return Array.from({ length: 5 }, (_, i) => {
      const a = ((seed + i * 71) % 1000) / 1000;
      const ang = a * Math.PI * 2;
      const dist = 0.05 + ((seed + i * 19) % 100) / 100 * 0.18;
      return {
        ox: Math.cos(ang) * dist,
        oz: Math.sin(ang) * dist,
        rise: 0.35 + ((seed + i * 11) % 100) / 100 * 0.55,
        driftX: (a - 0.5) * 0.35,
        driftZ: (((seed + i * 37) % 100) / 100 - 0.5) * 0.35,
        size: 0.06 + ((seed + i * 5) % 100) / 100 * 0.07,
        delay: ((seed + i * 43) % 100) / 100 * 0.2,
      };
    });
  }, [shot.key]);

  const barkMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#03170c",
        emissive: "#0b3d22",
        emissiveIntensity: 0.35,
        roughness: 0.85,
        metalness: 0.05,
        transparent: true,
        opacity: 0.96,
      }),
    [],
  );
  const tipMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: shot.color,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [shot.color],
  );
  const mistMats = useMemo(
    () =>
      Array.from(
        { length: mist.length },
        () =>
          new THREE.MeshBasicMaterial({
            color: shot.color,
            transparent: true,
            opacity: 0.28,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
      ),
    [mist.length, shot.color],
  );

  useFrame(() => {
    const age = (performance.now() - shot.born) / shot.life;
    const g = root.current;
    if (!g) return;
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const sprout = THREE.MathUtils.clamp(age / 0.2, 0, 1);
    const rise = 1 - (1 - sprout) * (1 - sprout);
    const amp = softEnvelope(age, 0.1, 0.52);

    if (stalksRef.current) {
      for (let i = 0; i < stalksRef.current.children.length; i++) {
        const group = stalksRef.current.children[i] as THREE.Group;
        const spec = roots[i];
        if (!spec) continue;
        const h = rise * spec.height;
        group.scale.set(spec.thick * (0.55 + rise * 0.45), Math.max(0.05, h), spec.thick * (0.55 + rise * 0.45));
        group.position.set(spec.ox, 0, spec.oz);
      }
      barkMat.opacity = amp * 0.96;
      barkMat.emissiveIntensity = 0.2 + amp * 0.45;
      tipMat.opacity = amp * 0.5;
    }

    if (mistRef.current) {
      for (let i = 0; i < mistRef.current.children.length; i++) {
        const mesh = mistRef.current.children[i] as THREE.Mesh;
        const spec = mist[i];
        const mat = mistMats[i];
        if (!spec || !mat) continue;
        const local = THREE.MathUtils.clamp((age - spec.delay) / Math.max(0.01, 1 - spec.delay), 0, 1);
        const fade = softEnvelope(local, 0.15, 0.45);
        mesh.position.set(
          spec.ox + local * spec.driftX,
          0.08 + local * spec.rise,
          spec.oz + local * spec.driftZ,
        );
        const s = spec.size * (0.6 + local * 1.4);
        mesh.scale.setScalar(s);
        mat.opacity = fade * 0.32;
      }
    }
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]}>
      <group ref={stalksRef}>
        {roots.map((r, i) => (
          <group
            key={i}
            rotation={[r.leanX, r.yaw, r.leanZ + r.twist]}
            position={[r.ox, 0, r.oz]}
          >
            <mesh material={barkMat} position={[0, 0.5, 0]}>
              <coneGeometry args={[0.07, 1, 5]} />
            </mesh>
            <mesh material={barkMat} position={[0, 0.28, 0]} scale={[1.15, 0.22, 1.15]}>
              <sphereGeometry args={[0.07, 6, 5]} />
            </mesh>
            <mesh
              material={barkMat}
              position={[0.04, 0.38, 0]}
              rotation={[r.thornLean, r.thornYaw, 0.2]}
              scale={[r.thornScale, r.thornScale * 0.85, r.thornScale]}
            >
              <coneGeometry args={[0.045, 0.7, 4]} />
            </mesh>
            <mesh material={tipMat} position={[0, 0.92, 0]}>
              <sphereGeometry args={[0.045, 6, 6]} />
            </mesh>
          </group>
        ))}
      </group>
      <group ref={mistRef}>
        {mist.map((_, i) => (
          <mesh key={i} material={mistMats[i]}>
            <sphereGeometry args={[1, 6, 6]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
