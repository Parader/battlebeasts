import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope, smooth01 } from "../easing";

const CORE = new THREE.Color("#7f1d1d");
const EDGE = new THREE.Color("#EF4444");
const FLASH = new THREE.Color("#FECACA");

const SHARD_COUNT = 8;

/**
 * Soul Sever snap — streak from imprint to target + psychic puncture.
 * Uses shot.originX/Z as imprint when present; `radius` encodes power (0.35–0.8).
 */
export function SoulSeverSnapEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const streak = useRef<THREE.Mesh>(null);
  const flash = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const shards = useRef<(THREE.Mesh | null)[]>([]);

  const power = Math.max(0, Math.min(1, ((shot.radius ?? 0.4) - 0.35) / 0.45));

  const mats = useMemo(() => {
    const mk = (color: THREE.Color) =>
      new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
    return {
      streak: mk(EDGE),
      flash: mk(FLASH),
      ring: mk(EDGE),
      shard: mk(CORE),
    };
  }, []);

  const ox = typeof shot.originX === "number" ? shot.originX : shot.x;
  const oz = typeof shot.originZ === "number" ? shot.originZ : shot.z;
  const dx = shot.x - ox;
  const dz = shot.z - oz;
  const dist = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = shot.life ?? 320;
    if (ms >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const streakT = smooth01(ms / 100);
    const impact = ms >= 90 ? softEnvelope(Math.min(1, (ms - 90) / 90), 0.1, 0.4) : 0;
    const fade = 1 - smooth01(Math.max(0, (ms - 160) / Math.max(1, life - 160)));

    if (streak.current) {
      const len = Math.max(0.2, dist) * streakT;
      streak.current.position.set(0, 1.05, len * 0.5);
      streak.current.scale.set(0.04 + power * 0.02, 0.04 + power * 0.02, len);
      mats.streak.opacity =
        softEnvelope(Math.min(1, ms / 40), 0.1, 0.35) *
        (1 - Math.min(1, Math.max(0, (ms - 100) / 120))) *
        (0.55 + power * 0.35);
    }
    if (flash.current) {
      flash.current.position.set(0, 1.05, Math.max(0.2, dist));
      flash.current.scale.setScalar((0.15 + power * 0.18) * (0.5 + impact));
      mats.flash.opacity = impact * (0.65 + power * 0.3) * fade;
    }
    if (ring.current) {
      ring.current.position.set(0, 0.05, Math.max(0.2, dist));
      ring.current.scale.setScalar((0.4 + power * 0.5) * (0.4 + impact));
      mats.ring.opacity = impact * 0.45 * fade;
    }
    for (let i = 0; i < SHARD_COUNT; i++) {
      const mesh = shards.current[i];
      if (!mesh) continue;
      const show = ms > 100 && i < 4 + Math.round(power * 4);
      mesh.visible = show;
      if (!show) continue;
      const ang = (i / SHARD_COUNT) * Math.PI * 2;
      const u = smooth01((ms - 100) / 160);
      const r = (0.25 + power * 0.35) * u;
      mesh.position.set(
        Math.cos(ang) * r,
        0.9 + u * 0.2,
        Math.max(0.2, dist) + Math.sin(ang) * r,
      );
      mesh.scale.setScalar(0.04 * (1 - u * 0.5));
      mats.shard.opacity = impact * (1 - u) * 0.7 * fade;
    }
  });

  return (
    <group ref={root} position={[ox, 0, oz]} rotation={[0, yaw, 0]}>
      <mesh ref={streak} renderOrder={40}>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={mats.streak} attach="material" />
      </mesh>
      <mesh ref={flash} renderOrder={41}>
        <sphereGeometry args={[1, 10, 8]} />
        <primitive object={mats.flash} attach="material" />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={39}>
        <ringGeometry args={[0.7, 1, 32]} />
        <primitive object={mats.ring} attach="material" />
      </mesh>
      {Array.from({ length: SHARD_COUNT }, (_, i) => (
        <mesh
          key={`shard-${i}`}
          ref={(el) => {
            shards.current[i] = el;
          }}
          renderOrder={41}
        >
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={mats.shard} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

/** Thin slash flash when the blade first lands (imprint placed by SoulSevers). */
export function SoulSeverHitEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const slash = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: EDGE.clone(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    if (ms >= 220) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const pop = softEnvelope(Math.min(1, ms / 55), 0.1, 0.35);
    const fade = 1 - smooth01(Math.max(0, (ms - 70) / 150));
    if (slash.current) {
      slash.current.scale.set(0.08 * (0.7 + pop), 0.55 * (0.6 + pop), 0.02);
      slash.current.rotation.z = -0.55 + pop * 0.15;
      mat.opacity = pop * 0.75 * fade;
    }
  });

  return (
    <group ref={root} position={[shot.x, shot.y ?? 1.05, shot.z]} rotation={[0, shot.yaw ?? 0, 0]}>
      <mesh ref={slash} renderOrder={40}>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}
