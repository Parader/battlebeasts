import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import {
  GEO_SPIKE_KNOB,
  GEO_SPIKE_MIST,
  GEO_SPIKE_STALK,
  GEO_SPIKE_THORN,
  GEO_SPIKE_TIP,
} from "../sharedGeo";

/** Poison spike palette — dark bark → toxic lime. */
const POISON_SPIKE_COLORS = [
  { bark: "#03170c", tip: "#4ade80" },
  { bark: "#0a2e14", tip: "#a3e635" },
  { bark: "#14532d", tip: "#84cc16" },
  { bark: "#052e16", tip: "#bef264" },
  { bark: "#1a3d12", tip: "#65a30d" },
] as const;

type RootSpec = {
  ox: number;
  oz: number;
  yaw: number;
  leanX: number;
  leanZ: number;
  twist: number;
  height: number;
  thick: number;
  thornLean: number;
  thornYaw: number;
  thornScale: number;
  colorIdx: number;
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
 * Poisonous root burst — sharp cone spikes + mist (E Spikes).
 */
export function SpikesPopEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const stalksRef = useRef<THREE.Group>(null);
  const mistRef = useRef<THREE.Group>(null);

  const roots = useMemo((): RootSpec[] => {
    const seed = shot.key * 7919;
    const out: RootSpec[] = [];
    for (let i = 0; i < 5; i++) {
      const a = ((seed + i * 97) % 1000) / 1000;
      const b = ((seed + i * 53) % 1000) / 1000;
      const ang = a * Math.PI * 2;
      const dist = 0.04 + b * 0.16;
      out.push({
        ox: Math.cos(ang) * dist,
        oz: Math.sin(ang) * dist,
        yaw: ang + (((seed + i * 13) % 100) / 100) * 0.6,
        leanX: (a - 0.5) * 0.5,
        leanZ: (b - 0.5) * 0.5,
        twist: ((seed + i * 29) % 100) / 100 * 0.3 - 0.15,
        height: 0.95 + ((seed + i * 41) % 100) / 100 * 0.4,
        thick: 0.52 + ((seed + i * 17) % 100) / 100 * 0.28,
        thornLean: 0.5 + ((seed + i * 7) % 100) / 100 * 0.35,
        thornYaw: ang + Math.PI * (0.35 + ((seed + i) % 50) / 100),
        thornScale: 0.35 + ((seed + i * 23) % 100) / 100 * 0.22,
        colorIdx: (seed + i * 11) % POISON_SPIKE_COLORS.length,
      });
    }
    return out;
  }, [shot.key]);

  const mist = useMemo((): MistSpec[] => {
    const seed = shot.key * 4243;
    return Array.from({ length: 5 }, (_, i) => {
      const a = ((seed + i * 71) % 1000) / 1000;
      const ang = a * Math.PI * 2;
      const dist = 0.04 + ((seed + i * 19) % 100) / 100 * 0.14;
      return {
        ox: Math.cos(ang) * dist,
        oz: Math.sin(ang) * dist,
        rise: 0.28 + ((seed + i * 11) % 100) / 100 * 0.4,
        driftX: (a - 0.5) * 0.28,
        driftZ: (((seed + i * 37) % 100) / 100 - 0.5) * 0.28,
        size: 0.045 + ((seed + i * 5) % 100) / 100 * 0.05,
        delay: ((seed + i * 43) % 100) / 100 * 0.2,
      };
    });
  }, [shot.key]);

  const barkMats = useMemo(
    () =>
      POISON_SPIKE_COLORS.map(
        (c) =>
          new THREE.MeshStandardMaterial({
            color: c.bark,
            emissive: c.bark,
            emissiveIntensity: 0.35,
            roughness: 0.85,
            metalness: 0.05,
            transparent: true,
            opacity: 0.96,
          }),
      ),
    [],
  );
  const tipMats = useMemo(
    () =>
      POISON_SPIKE_COLORS.map(
        (c) =>
          new THREE.MeshBasicMaterial({
            color: c.tip,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
      ),
    [],
  );
  const mistMats = useMemo(
    () =>
      Array.from({ length: mist.length }, (_, i) => {
        const tip = POISON_SPIKE_COLORS[i % POISON_SPIKE_COLORS.length]!.tip;
        return new THREE.MeshBasicMaterial({
          color: tip,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        });
      }),
    [mist.length],
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
        group.scale.set(
          spec.thick * (0.55 + rise * 0.45),
          Math.max(0.05, h),
          spec.thick * (0.55 + rise * 0.45),
        );
        group.position.set(spec.ox, 0, spec.oz);
      }
      for (const mat of barkMats) {
        mat.opacity = amp * 0.96;
        mat.emissiveIntensity = 0.2 + amp * 0.45;
      }
      for (const mat of tipMats) {
        mat.opacity = amp * 0.75;
      }
    }

    if (mistRef.current) {
      for (let i = 0; i < mistRef.current.children.length; i++) {
        const mesh = mistRef.current.children[i] as THREE.Mesh;
        const spec = mist[i];
        const mat = mistMats[i];
        if (!spec || !mat) continue;
        const local = THREE.MathUtils.clamp(
          (age - spec.delay) / Math.max(0.01, 1 - spec.delay),
          0,
          1,
        );
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
        {roots.map((r, i) => {
          const bark = barkMats[r.colorIdx]!;
          const tip = tipMats[r.colorIdx]!;
          return (
            <group
              key={i}
              rotation={[r.leanX, r.yaw, r.leanZ + r.twist]}
              position={[r.ox, 0, r.oz]}
            >
              <mesh material={bark} position={[0, 0.5, 0]} geometry={GEO_SPIKE_STALK} />
              <mesh
                material={bark}
                position={[0, 0.08, 0]}
                rotation={[Math.PI, 0, 0]}
                scale={[1.35, 0.55, 1.35]}
                geometry={GEO_SPIKE_KNOB}
              />
              <mesh
                material={bark}
                position={[0.04, 0.38, 0]}
                rotation={[r.thornLean, r.thornYaw, 0.2]}
                scale={[r.thornScale, r.thornScale * 0.85, r.thornScale]}
                geometry={GEO_SPIKE_THORN}
              />
              <mesh
                material={bark}
                position={[-0.035, 0.52, 0.02]}
                rotation={[r.thornLean * 0.75, r.thornYaw + 1.7, -0.15]}
                scale={[r.thornScale * 0.65, r.thornScale * 0.7, r.thornScale * 0.65]}
                geometry={GEO_SPIKE_THORN}
              />
              <mesh
                material={tip}
                position={[0, 0.9, 0]}
                scale={[0.85, 1.15, 0.85]}
                geometry={GEO_SPIKE_TIP}
              />
            </group>
          );
        })}
      </group>
      <group ref={mistRef}>
        {mist.map((_, i) => (
          <mesh key={i} material={mistMats[i]} geometry={GEO_SPIKE_MIST} />
        ))}
      </group>
    </group>
  );
}
