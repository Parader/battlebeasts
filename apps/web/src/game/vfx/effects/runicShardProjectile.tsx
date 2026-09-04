import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { abilityVfxColor } from "../colors";
import { createEnergyBallMaterial, tintEnergyMaterial } from "../materials/energyBall";
import { createCirclePointMaterial } from "../materials/circlePoint";

const FLECK_COUNT = 10;
const SHARD_Y = 1.05;

const CRYSTAL = "#6ee7ff";
const CRYSTAL_HOT = "#e0f7ff";
const CRYSTAL_DARK = "#0c4a6e";

type Fleck = {
  alive: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
};

/**
 * Runic Shard — elongated crystal mesh + short geometric flecks.
 * Fragments (`mode === "fragment"`) use a smaller scale of the same mesh.
 */
export function RunicShardProjectileEffect({ room, id }: { room: Room; id: string }) {
  const group = useRef<THREE.Group>(null);
  const crystal = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const points = useRef<THREE.Points>(null);

  const colorHex = useRef(abilityVfxColor("runicShard", CRYSTAL));
  const shellMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: CRYSTAL_DARK,
        emissive: CRYSTAL,
        emissiveIntensity: 0.55,
        metalness: 0.15,
        roughness: 0.25,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const coreMat = useMemo(() => createEnergyBallMaterial(CRYSTAL_HOT, 0.95), []);

  const renderPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const spin = useRef(0);
  const spawnAcc = useRef(0);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const isFragment = useRef(false);

  const flecks = useRef<Fleck[]>(
    Array.from({ length: FLECK_COUNT }, () => ({
      alive: false,
      age: 0,
      life: 0.2,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 0.03,
    })),
  );

  const positions = useMemo(() => new Float32Array(FLECK_COUNT * 3), []);
  const sizes = useMemo(() => new Float32Array(FLECK_COUNT), []);
  const alphas = useMemo(() => new Float32Array(FLECK_COUNT), []);

  const particleGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return geo;
  }, [positions, sizes, alphas]);

  const particleMat = useMemo(() => createCirclePointMaterial(CRYSTAL_HOT), []);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | {
          x: number;
          z: number;
          vx?: number;
          vz?: number;
          abilityId?: string;
          mode?: string;
          radius?: number;
        }
      | undefined;
    const g = group.current;
    if (!p || !g) {
      if (g) g.visible = false;
      if (points.current) points.current.visible = false;
      seeded.current = false;
      for (const f of flecks.current) f.alive = false;
      return;
    }

    g.visible = true;
    if (points.current) points.current.visible = true;

    isFragment.current = p.mode === "fragment" || (p.radius != null && p.radius < 0.25);
    const frag = isFragment.current;
    const safeDt = Math.min(0.05, Math.max(0, dt));
    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;

    if (p.abilityId) colorHex.current = abilityVfxColor(p.abilityId, CRYSTAL);
    tintEnergyMaterial(coreMat, colorHex.current, frag ? 0.85 : 1);

    if (!seeded.current) {
      renderPos.current.set(p.x, SHARD_Y, p.z);
      lastServer.current = { x: p.x, z: p.z, vx, vz };
      seeded.current = true;
    } else {
      renderPos.current.x += vx * safeDt;
      renderPos.current.z += vz * safeDt;
      const moved =
        p.x !== lastServer.current.x ||
        p.z !== lastServer.current.z ||
        vx !== lastServer.current.vx ||
        vz !== lastServer.current.vz;
      if (moved) {
        lastServer.current = { x: p.x, z: p.z, vx, vz };
        const err = Math.hypot(renderPos.current.x - p.x, renderPos.current.z - p.z);
        if (err > 0.02) {
          const blend = err > 1.5 ? 1 : 0.4;
          renderPos.current.x += (p.x - renderPos.current.x) * blend;
          renderPos.current.z += (p.z - renderPos.current.z) * blend;
        }
      }
    }

    g.position.copy(renderPos.current);

    const speed = Math.hypot(vx, vz);
    if (speed > 0.05) {
      lookTarget.set(renderPos.current.x + vx, renderPos.current.y, renderPos.current.z + vz);
      g.lookAt(lookTarget);
    }

    spin.current += safeDt * (frag ? 8 : 5);
    const len = frag ? 0.26 : 0.62;
    const width = frag ? 0.07 : 0.14;
    if (crystal.current) {
      crystal.current.scale.set(width, width, len);
      crystal.current.rotation.z = spin.current;
    }
    if (core.current) {
      core.current.scale.set(width * 0.35, width * 0.35, len * 0.85);
      core.current.rotation.z = spin.current;
    }

    spawnAcc.current += safeDt;
    const emitEvery = frag ? 0.05 : 0.035;
    if (spawnAcc.current >= emitEvery) {
      spawnAcc.current = 0;
      for (const f of flecks.current) {
        if (f.alive) continue;
        f.alive = true;
        f.age = 0;
        f.life = frag ? 0.14 : 0.22;
        f.x = (Math.random() - 0.5) * width;
        f.y = (Math.random() - 0.5) * width;
        f.z = -len * 0.35;
        f.vx = (Math.random() - 0.5) * 0.4;
        f.vy = (Math.random() - 0.5) * 0.4;
        f.vz = -1.2 - Math.random() * 0.8;
        f.size = frag ? 0.025 : 0.035;
        break;
      }
    }

    let mi = 0;
    for (const f of flecks.current) {
      if (!f.alive) continue;
      f.age += safeDt;
      if (f.age >= f.life) {
        f.alive = false;
        continue;
      }
      f.x += f.vx * safeDt;
      f.y += f.vy * safeDt;
      f.z += f.vz * safeDt;
      const u = f.age / f.life;
      positions[mi * 3] = f.x;
      positions[mi * 3 + 1] = f.y;
      positions[mi * 3 + 2] = f.z;
      sizes[mi] = f.size * 36 * (1 - u * 0.5);
      alphas[mi] = (1 - u) * 0.75;
      mi += 1;
    }
    for (let i = mi; i < FLECK_COUNT; i++) {
      alphas[i] = 0;
      sizes[i] = 0;
    }
    particleGeo.attributes.position!.needsUpdate = true;
    particleGeo.attributes.aSize!.needsUpdate = true;
    particleGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <mesh ref={crystal} material={shellMat} renderOrder={4}>
        <octahedronGeometry args={[1, 0]} />
      </mesh>
      <mesh ref={core} material={coreMat} renderOrder={5}>
        <octahedronGeometry args={[1, 0]} />
      </mesh>
      <points ref={points} geometry={particleGeo} material={particleMat} renderOrder={6} />
    </group>
  );
}
