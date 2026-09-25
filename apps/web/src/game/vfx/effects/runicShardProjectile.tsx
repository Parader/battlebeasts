import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { abilityVfxColor } from "../colors";
import { createEnergyBallMaterial, tintEnergyMaterial } from "../materials/energyBall";
import { burstElementRole, spawnElementRole, type ElementHandle } from "../engine";

const SHARD_Y = 1.05;

const CRYSTAL = "#6ee7ff";
const CRYSTAL_HOT = "#e0f7ff";
const CRYSTAL_DARK = "#0c4a6e";

/**
 * Runic Shard travel — crystal mesh with the frost ParticleWorld trail.
 *
 * Caster/impact: frost blow on first spawn; hit/shatter bursts live in catalog.
 * Travel: ice flakes + frost-fog smoke follow the crystal (main shard only —
 * shatter fragments stay mesh-only so 12 shards don't blow the emitter budget).
 * Ground: none, this is an airborne crystal.
 * Particles: ParticleWorld frost trail / ground fog; no THREE.Points.
 * Light: none, the energy core carries the read.
 * Status: frostChill is applied in combat, not here.
 */
export function RunicShardProjectileEffect({ room, id }: { room: Room; id: string }) {
  const group = useRef<THREE.Group>(null);
  const crystal = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const wake = useRef<ElementHandle | null>(null);
  const fog = useRef<ElementHandle | null>(null);

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
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const isFragment = useRef(false);

  useEffect(
    () => () => {
      wake.current?.kill();
      wake.current = null;
      fog.current?.kill();
      fog.current = null;
      shellMat.dispose();
      coreMat.dispose();
    },
    [shellMat, coreMat],
  );

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
      wake.current?.setRateScale(0);
      fog.current?.setRateScale(0);
      seeded.current = false;
      return;
    }

    g.visible = true;

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
      if (!frag) {
        burstElementRole("frost", "cast", p.x, SHARD_Y, p.z);
      }
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

    const px = renderPos.current.x;
    const py = renderPos.current.y;
    const pz = renderPos.current.z;

    if (!frag) {
      if (!wake.current) {
        wake.current = spawnElementRole("frost", "trail", px, py, pz);
      }
      if (!fog.current) {
        fog.current = spawnElementRole("frost", "ground", px, py, pz);
      }
      wake.current.setRateScale(1);
      wake.current.setPose(px, py, pz);
      fog.current.setRateScale(0.55);
      fog.current.setPose(px, py - 0.08, pz);
    } else {
      wake.current?.setRateScale(0);
      fog.current?.setRateScale(0);
    }
  });

  return (
    <group ref={group}>
      <mesh ref={crystal} material={shellMat} renderOrder={4}>
        <octahedronGeometry args={[1, 0]} />
      </mesh>
      <mesh ref={core} material={coreMat} renderOrder={5}>
        <octahedronGeometry args={[1, 0]} />
      </mesh>
    </group>
  );
}
