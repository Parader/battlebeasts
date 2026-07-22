import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { abilityVfxColor } from "../colors";
import { createEnergyBallMaterial, tintEnergyMaterial } from "../materials/energyBall";

const TRAIL_COUNT = 8;
/** Drop a bead every this many meters traveled so the tail grows with flight. */
const SAMPLE_DISTANCE = 0.28;

type TrailPoint = { x: number; y: number; z: number };

/**
 * Oriented energy bolt + history trail that lengthens as the projectile flies.
 */
export function BoltProjectileEffect({ room, id }: { room: Room; id: string }) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const trailMeshes = useRef<(THREE.Mesh | null)[]>([]);

  const colorHex = useRef(abilityVfxColor("bolt"));
  const coreMat = useMemo(() => createEnergyBallMaterial(colorHex.current, 1), []);
  const glowMat = useMemo(() => createEnergyBallMaterial(colorHex.current, 0.5), []);
  const trailMats = useMemo(
    () => Array.from({ length: TRAIL_COUNT }, () => createEnergyBallMaterial(colorHex.current, 0.7)),
    [],
  );

  const renderPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const trail = useRef<TrailPoint[]>([]);
  const distAcc = useRef(0);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | { x: number; z: number; vx?: number; vz?: number; abilityId?: string }
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
      renderPos.current.set(p.x, 0.6, p.z);
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
          const blend = 1 - Math.exp(-14 * safeDt);
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

    const speed = Math.hypot(vx, vz);
    if (speed > 1e-3) {
      lookTarget.set(renderPos.current.x + vx, renderPos.current.y, renderPos.current.z + vz);
      g.lookAt(lookTarget);
    }

    const nextColor = abilityVfxColor(p.abilityId ?? "bolt");
    if (nextColor !== colorHex.current) {
      colorHex.current = nextColor;
      tintEnergyMaterial(coreMat, nextColor);
      tintEnergyMaterial(glowMat, nextColor, 0.5);
      for (const m of trailMats) tintEnergyMaterial(m, nextColor);
    }

    if (core.current) core.current.scale.set(0.55, 0.55, 1.7);
    if (glow.current) glow.current.scale.set(1.05, 1.05, 2.2);

    for (let i = 0; i < TRAIL_COUNT; i++) {
      const mesh = trailMeshes.current[i];
      const pt = trail.current[i];
      const mat = trailMats[i];
      if (!mesh || !mat) continue;
      if (!pt) {
        mesh.visible = false;
        continue;
      }
      const fade = 1 - i / Math.max(1, trail.current.length);
      mesh.visible = true;
      mesh.position.set(pt.x, pt.y, pt.z);
      mesh.scale.setScalar(0.28 + fade * 0.45);
      mat.opacity = 0.2 + fade * 0.55;
    }
  });

  return (
    <>
      <group ref={group}>
        <mesh ref={core}>
          <sphereGeometry args={[0.18, 12, 12]} />
          <primitive object={coreMat} attach="material" />
        </mesh>
        <mesh ref={glow}>
          <sphereGeometry args={[0.18, 10, 10]} />
          <primitive object={glowMat} attach="material" />
        </mesh>
      </group>
      {trailMats.map((mat, i) => (
        <mesh
          key={i}
          ref={(el) => {
            trailMeshes.current[i] = el;
          }}
          visible={false}
        >
          <sphereGeometry args={[0.12, 8, 8]} />
          <primitive object={mat} attach="material" />
        </mesh>
      ))}
    </>
  );
}
