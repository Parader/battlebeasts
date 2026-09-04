import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope, smooth01 } from "../easing";

const CORE = new THREE.Color("#F4F7FF");
const CYAN = new THREE.Color("#67E8F9");
const VIOLET = new THREE.Color("#A78BFA");

const SHARD_COUNT = 8;

type Shard = {
  angle: number;
  speed: number;
  lift: number;
  len: number;
};

/**
 * Compact prismatic puncture flash — not a spherical explosion.
 * `variant` / radius hint long-range (brighter, more shards).
 */
export function PrismLanceImpactEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const flash = useRef<THREE.Mesh>(null);
  const line = useRef<THREE.Mesh>(null);
  const shards = useRef<(THREE.Mesh | null)[]>([]);

  const power = Math.max(0, Math.min(1, (shot.radius ?? 0.5) - 0.2));
  const shardN = Math.round(4 + power * 6);

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
      flash: mk(CORE),
      line: mk(CYAN),
      shard: mk(VIOLET),
    };
  }, []);

  const shardDefs = useMemo<Shard[]>(() => {
    const out: Shard[] = [];
    for (let i = 0; i < SHARD_COUNT; i++) {
      out.push({
        angle: (i / SHARD_COUNT) * Math.PI * 2 + (i % 3) * 0.15,
        speed: 1.1 + (i % 4) * 0.25,
        lift: 0.08 + (i % 3) * 0.04,
        len: 0.12 + (i % 3) * 0.04,
      });
    }
    return out;
  }, []);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = shot.life ?? 280;
    if (ms >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const t = ms / life;
    const pop = softEnvelope(Math.min(1, ms / 70), 0.12, 0.4);
    const fade = 1 - smooth01(Math.max(0, (ms - 80) / Math.max(1, life - 80)));

    if (flash.current) {
      flash.current.scale.setScalar((0.12 + power * 0.1) * (0.6 + pop * 0.9));
      mats.flash.opacity = pop * (0.7 + power * 0.25) * fade;
    }
    if (line.current) {
      line.current.scale.set(0.03, 0.03, 0.55 + power * 0.25);
      mats.line.opacity = pop * 0.65 * fade;
    }
    for (let i = 0; i < SHARD_COUNT; i++) {
      const mesh = shards.current[i];
      if (!mesh) continue;
      const show = i < shardN && ms > 10;
      mesh.visible = show;
      if (!show) continue;
      const def = shardDefs[i]!;
      const u = smooth01((ms - 10) / 160);
      const r = def.speed * u * (0.35 + power * 0.25);
      mesh.position.set(
        Math.cos(def.angle) * r,
        def.lift + u * 0.15,
        Math.sin(def.angle) * r,
      );
      mesh.scale.set(0.025, 0.025, def.len * (1 - u * 0.4));
      mesh.rotation.y = -def.angle + Math.PI / 2;
      mats.shard.opacity = pop * (1 - u) * 0.7 * fade;
    }
  });

  return (
    <group ref={root} position={[shot.x, shot.y ?? 1.0, shot.z]}>
      <mesh ref={flash} renderOrder={40}>
        <sphereGeometry args={[1, 10, 8]} />
        <primitive object={mats.flash} attach="material" />
      </mesh>
      <mesh ref={line} rotation={[0, shot.yaw ?? 0, 0]} renderOrder={41}>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={mats.line} attach="material" />
      </mesh>
      {shardDefs.map((_, i) => (
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
