import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { PRISM_LANCE_CAST } from "@battlebeasts/shared";

const CORE = new THREE.Color("#F4F7FF");
const CYAN = new THREE.Color("#67E8F9");
const VIOLET = new THREE.Color("#A78BFA");
const PINK = new THREE.Color("#F0ABFC");

const TRAIL_COUNT = 6;
const SAMPLE_DISTANCE = 0.22;
const MAX_RANGE = PRISM_LANCE_CAST.range;

type TrailPoint = { x: number; y: number; z: number };

/**
 * Razor-thin prismatic lance — intensifies slightly with travel distance.
 */
export function PrismLanceProjectileEffect({ room, id }: { room: Room; id: string }) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const edge = useRef<THREE.Mesh>(null);
  const tip = useRef<THREE.Mesh>(null);
  const trailMeshes = useRef<(THREE.Mesh | null)[]>([]);

  const mats = useMemo(() => {
    const mk = (color: THREE.Color, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
    return {
      core: mk(CORE, 0.95),
      edge: mk(CYAN, 0.35),
      tip: mk(CORE, 1),
      trails: Array.from({ length: TRAIL_COUNT }, () => mk(VIOLET, 0.45)),
    };
  }, []);

  const renderPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const spawn = useRef({ x: 0, z: 0 });
  const trail = useRef<TrailPoint[]>([]);
  const distAcc = useRef(0);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | { x: number; z: number; vx?: number; vz?: number }
      | undefined;
    const g = group.current;
    if (!p || !g) {
      if (g) g.visible = false;
      for (const mesh of trailMeshes.current) {
        if (mesh) mesh.visible = false;
      }
      seeded.current = false;
      trail.current = [];
      distAcc.current = 0;
      return;
    }
    g.visible = true;

    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;
    const safeDt = Math.min(0.05, Math.max(0, dt));
    const prevX = renderPos.current.x;
    const prevZ = renderPos.current.z;

    if (!seeded.current) {
      renderPos.current.set(p.x, 0.95, p.z);
      spawn.current = { x: p.x, z: p.z };
      lastServer.current = { x: p.x, z: p.z, vx, vz };
      seeded.current = true;
      trail.current = [];
      distAcc.current = 0;
    } else {
      renderPos.current.x += vx * safeDt;
      renderPos.current.z += vz * safeDt;
      const serverMoved =
        p.x !== lastServer.current.x ||
        p.z !== lastServer.current.z ||
        vx !== lastServer.current.vx ||
        vz !== lastServer.current.vz;
      if (serverMoved) {
        lastServer.current = { x: p.x, z: p.z, vx, vz };
        const err = Math.hypot(renderPos.current.x - p.x, renderPos.current.z - p.z);
        if (err > 1.25) {
          renderPos.current.x = p.x;
          renderPos.current.z = p.z;
        } else {
          const blend = 1 - Math.exp(-16 * safeDt);
          renderPos.current.x = THREE.MathUtils.lerp(renderPos.current.x, p.x, blend);
          renderPos.current.z = THREE.MathUtils.lerp(renderPos.current.z, p.z, blend);
        }
      }
      const step = Math.hypot(renderPos.current.x - prevX, renderPos.current.z - prevZ);
      distAcc.current += step;
      while (distAcc.current >= SAMPLE_DISTANCE) {
        distAcc.current -= SAMPLE_DISTANCE;
        trail.current.unshift({
          x: renderPos.current.x,
          y: renderPos.current.y,
          z: renderPos.current.z,
        });
        if (trail.current.length > TRAIL_COUNT) trail.current.length = TRAIL_COUNT;
      }
    }

    g.position.copy(renderPos.current);
    const spd = Math.hypot(vx, vz);
    if (spd > 0.05) {
      lookTarget.set(renderPos.current.x + vx, renderPos.current.y, renderPos.current.z + vz);
      g.lookAt(lookTarget);
    }

    const travel = Math.hypot(
      renderPos.current.x - spawn.current.x,
      renderPos.current.z - spawn.current.z,
    );
    const power = Math.max(0, Math.min(1, (travel - 3) / Math.max(1, MAX_RANGE - 3)));

    if (core.current) {
      core.current.scale.set(0.07 + power * 0.03, 0.07 + power * 0.03, 1.15 + power * 0.25);
      mats.core.color.copy(CORE).lerp(CYAN, power * 0.15);
      mats.core.opacity = 0.85 + power * 0.12;
    }
    if (edge.current) {
      edge.current.scale.set(0.13 + power * 0.05, 0.13 + power * 0.05, 1.25 + power * 0.2);
      mats.edge.color.copy(CYAN).lerp(VIOLET, 0.35 + power * 0.35).lerp(PINK, power * 0.2);
      mats.edge.opacity = 0.26 + power * 0.28;
    }
    if (tip.current) {
      tip.current.position.set(0, 0, 0.68 + power * 0.08);
      tip.current.scale.setScalar(0.08 + power * 0.04);
      mats.tip.opacity = 0.75 + power * 0.25;
    }

    for (let i = 0; i < TRAIL_COUNT; i++) {
      const mesh = trailMeshes.current[i];
      const pt = trail.current[i];
      if (!mesh) continue;
      if (!pt) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(pt.x, pt.y, pt.z);
      const fade = 1 - i / TRAIL_COUNT;
      const s = (0.055 + power * 0.028) * fade;
      mesh.scale.set(s, s, 0.45 * fade * (0.7 + power * 0.4));
      mats.trails[i]!.color.copy(VIOLET).lerp(CYAN, fade * 0.5);
      mats.trails[i]!.opacity = (0.18 + power * 0.26) * fade;
    }
  });

  return (
    <>
      <group ref={group} visible={false}>
        <mesh ref={edge} renderOrder={30}>
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={mats.edge} attach="material" />
        </mesh>
        <mesh ref={core} renderOrder={31}>
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={mats.core} attach="material" />
        </mesh>
        <mesh ref={tip} renderOrder={32}>
          <octahedronGeometry args={[1, 0]} />
          <primitive object={mats.tip} attach="material" />
        </mesh>
      </group>
      {/* Trails are world-space siblings — parenting under `group` double-applied pose. */}
      {mats.trails.map((mat, i) => (
        <mesh
          key={`trail-${i}`}
          ref={(el) => {
            trailMeshes.current[i] = el;
          }}
          renderOrder={29}
          visible={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={mat} attach="material" />
        </mesh>
      ))}
    </>
  );
}
