import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { getVfxCircleTexture } from "../materials/circlePoint";
import { ASTRAL_CHAIN_COLORS } from "./astralChainPalette";

const GROUND_Y = 0.012;
const TRAIL = 8;
const BLOT_W = 1.15;
const BLOT_L = 1.55;
const HALO_W = 1.9;
const HALO_L = 2.35;

type ShadowPuff = {
  alive: boolean;
  age: number;
  life: number;
  wx: number;
  wz: number;
  yaw: number;
  scale: number;
};

function groundShadowMat(color: string, opacity: number) {
  const tex = getVfxCircleTexture();
  return new THREE.MeshBasicMaterial({
    map: tex,
    alphaMap: tex,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/**
 * Astral Chain projectile — only a soft ground shadow (no airborne orb / trail orbs).
 */
export function AstralChainProjectileEffect({ room, id }: { room: Room; id: string }) {
  const root = useRef<THREE.Group>(null);
  const blot = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const yaw = useRef(0);
  const seeded = useRef(false);
  const spawnAcc = useRef(0);

  const puffs = useRef<ShadowPuff[]>(
    Array.from({ length: TRAIL }, () => ({
      alive: false,
      age: 0,
      life: 0.4,
      wx: 0,
      wz: 0,
      yaw: 0,
      scale: 1,
    })),
  );

  const blotMat = useMemo(() => groundShadowMat("#07080f", 0.8), []);
  const haloMat = useMemo(() => groundShadowMat(ASTRAL_CHAIN_COLORS.dark, 0.38), []);
  const trailMat = useMemo(() => groundShadowMat("#0a0b14", 0.42), []);

  const trailMeshes = useMemo(
    () =>
      Array.from({ length: TRAIL }, () => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), trailMat.clone());
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        m.renderOrder = 2;
        return m;
      }),
    [trailMat],
  );

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | { x?: number; z?: number; vx?: number; vz?: number }
      | undefined;
    const g = root.current;
    if (!p || !g) {
      if (g) g.visible = false;
      seeded.current = false;
      return;
    }
    g.visible = true;
    const safeDt = Math.min(0.05, Math.max(0, dt));
    const x = p.x ?? 0;
    const z = p.z ?? 0;
    // Root never rotates — only translates — so trail puffs stay planted.
    g.position.set(x, GROUND_Y, z);

    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;
    const speed = Math.hypot(vx, vz);
    if (speed > 0.05) {
      yaw.current = Math.atan2(vx, vz);
    }

    const pulse = 0.97 + 0.03 * Math.sin(performance.now() * 0.01);
    const stretch = 1 + Math.min(0.35, speed * 0.03);

    // Orient blot/halo alone (not the whole root).
    if (blot.current) {
      blot.current.rotation.set(-Math.PI / 2, 0, -yaw.current);
      blot.current.scale.set(BLOT_W * pulse, BLOT_L * pulse * stretch, 1);
      blotMat.opacity = 0.78;
    }
    if (halo.current) {
      halo.current.rotation.set(-Math.PI / 2, 0, -yaw.current);
      halo.current.scale.set(HALO_W * pulse, HALO_L * pulse * stretch, 1);
      haloMat.opacity = 0.34;
    }

    if (!seeded.current) {
      seeded.current = true;
    }

    spawnAcc.current += safeDt;
    if (spawnAcc.current > 0.045 && speed > 0.15) {
      spawnAcc.current = 0;
      const slot = puffs.current.find((f) => !f.alive);
      if (slot) {
        slot.alive = true;
        slot.age = 0;
        slot.life = 0.3 + Math.random() * 0.2;
        slot.wx = x;
        slot.wz = z;
        slot.yaw = yaw.current;
        slot.scale = 0.85 + Math.random() * 0.25;
      }
    }

    for (let i = 0; i < TRAIL; i++) {
      const f = puffs.current[i]!;
      const mesh = trailMeshes[i]!;
      if (!f.alive) {
        mesh.visible = false;
        continue;
      }
      f.age += safeDt;
      if (f.age >= f.life) {
        f.alive = false;
        mesh.visible = false;
        continue;
      }
      const u = f.age / f.life;
      mesh.visible = true;
      // Local offset from current blot — root has no yaw, so this stays world-aligned.
      mesh.position.set(f.wx - x, 0.002, f.wz - z);
      mesh.rotation.set(-Math.PI / 2, 0, -f.yaw);
      const s = f.scale * (1 + u * 0.4);
      mesh.scale.set(BLOT_W * s, BLOT_L * s * 1.1, 1);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - u) * 0.4;
    }
  });

  return (
    <group ref={root} renderOrder={3}>
      <mesh ref={halo} material={haloMat} renderOrder={2}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={blot} material={blotMat} renderOrder={3}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      {trailMeshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
