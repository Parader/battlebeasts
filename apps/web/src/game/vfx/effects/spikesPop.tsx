import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import {
  GEO_SPIKE_KNOB,
  GEO_SPIKE_STALK,
  GEO_SPIKE_THORN,
  GEO_SPIKE_TIP,
} from "../sharedGeo";
import { burstElementRole } from "../engine";

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

/**
 * Caster/travel/ground: none. Impact: poison preset plus retained spike meshes.
 * Particles: ParticleWorld poison impact; poisoned/weakened auras stay in StatusAuraFx.
 */
export function SpikesPopEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const stalksRef = useRef<THREE.Group>(null);

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
  useEffect(() => {
    burstElementRole("poison", "impact", shot.x, shot.y, shot.z);
  }, [shot.key, shot.x, shot.y, shot.z]);

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
    </group>
  );
}
