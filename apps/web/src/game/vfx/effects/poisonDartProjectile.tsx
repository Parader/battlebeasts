import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { abilityVfxColor } from "../colors";
import { createEnergyBallMaterial, tintEnergyMaterial } from "../materials/energyBall";
import { spawnElementRole, type ElementHandle } from "../engine";

const POISON = "#4d7c0f";
const POISON_HOT = "#84cc16";
const POISON_DARK = "#14532d";

/**
 * Caster/impact/ground: owned elsewhere. Travel: poison preset follows the dart.
 * Particles: ParticleWorld poison trail; poisoned/weakened auras stay in StatusAuraFx.
 */
export function PoisonDartProjectileEffect({ room, id }: { room: Room; id: string }) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const wake = useRef<ElementHandle | null>(null);

  const colorHex = useRef(abilityVfxColor("poisonDart", POISON));
  const coreMat = useMemo(() => createEnergyBallMaterial(POISON_HOT, 1), []);
  const glowMat = useMemo(() => createEnergyBallMaterial(POISON_DARK, 0.55), []);

  const renderPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useEffect(
    () => () => {
      wake.current?.kill();
      wake.current = null;
      coreMat.dispose();
      glowMat.dispose();
    },
    [coreMat, glowMat],
  );

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | { x: number; z: number; vx?: number; vz?: number; abilityId?: string }
      | undefined;
    const g = group.current;
    if (!p || !g) {
      if (g) g.visible = false;
      wake.current?.setRateScale(0);
      seeded.current = false;
      return;
    }
    g.visible = true;

    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;
    const safeDt = Math.min(0.05, Math.max(0, dt));

    if (!seeded.current) {
      renderPos.current.set(p.x, 0.95, p.z);
      lastServer.current = { x: p.x, z: p.z, vx, vz };
      seeded.current = true;
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

    }

    g.position.copy(renderPos.current);
    if (!wake.current) {
      wake.current = spawnElementRole(
        "poison",
        "trail",
        renderPos.current.x,
        renderPos.current.y,
        renderPos.current.z,
      );
    }
    wake.current.setRateScale(1);
    wake.current.setPose(renderPos.current.x, renderPos.current.y, renderPos.current.z);

    const speed = Math.hypot(vx, vz);
    if (speed > 1e-3) {
      lookTarget.set(renderPos.current.x + vx, renderPos.current.y, renderPos.current.z + vz);
      g.lookAt(lookTarget);
    }

    const nextColor = abilityVfxColor(p.abilityId ?? "poisonDart", POISON);
    if (nextColor !== colorHex.current) {
      colorHex.current = nextColor;
      tintEnergyMaterial(coreMat, nextColor);
      tintEnergyMaterial(glowMat, POISON_DARK, 0.55);
    }

    if (core.current) core.current.scale.set(0.35, 0.35, 1.35);
    if (glow.current) glow.current.scale.set(0.75, 0.75, 1.8);
  });

  return (
    <>
      <group ref={group}>
        <mesh ref={core}>
          <sphereGeometry args={[0.14, 10, 10]} />
          <primitive object={coreMat} attach="material" />
        </mesh>
        <mesh ref={glow}>
          <sphereGeometry args={[0.14, 8, 8]} />
          <primitive object={glowMat} attach="material" />
        </mesh>
      </group>
    </>
  );
}
