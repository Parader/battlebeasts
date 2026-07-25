import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { abilityVfxColor } from "../colors";
import { createEnergyBallMaterial, tintEnergyMaterial } from "../materials/energyBall";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { FROST_BALL_CAST } from "@battlebeasts/shared";

/** Quick spawn fade — readable, not a pop. */
const APPEAR_SEC = 0.16;
/** After server despawn — keep coasting and dissolve. */
const FADE_OUT_SEC = 0.42;

/**
 * Slow-moving frost orb — spins in place, frost ring follows for the slow shell.
 * On despawn, coasts on last velocity and fades instead of popping out.
 */
export function FrostBallProjectileEffect({ room, id }: { room: Room; id: string }) {
  const group = useRef<THREE.Group>(null);
  const orb = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);

  const colorHex = useRef(abilityVfxColor("frostBall"));
  const coreMat = useMemo(() => createEnergyBallMaterial(colorHex.current, 0), []);
  const glowMat = useMemo(() => createEnergyBallMaterial(colorHex.current, 0), []);
  const frostPreset = groundPresets.frostBallAura;

  const renderPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const appear = useRef(0);
  const auraFade = useRef(0);
  const fadingOut = useRef(false);
  const fadeOut = useRef(1);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | {
          x: number;
          z: number;
          vx?: number;
          vz?: number;
          abilityId?: string;
        }
      | undefined;
    const g = group.current;
    if (!g) return;

    const safeDt = Math.min(0.05, Math.max(0, dt));

    // Server removed the projectile — coast + fade
    if (!p) {
      if (!seeded.current) {
        g.visible = false;
        return;
      }
      fadingOut.current = true;
      fadeOut.current = Math.max(0, fadeOut.current - safeDt / FADE_OUT_SEC);
      if (fadeOut.current <= 0.01) {
        g.visible = false;
        seeded.current = false;
        fadingOut.current = false;
        return;
      }

      const { vx, vz } = lastServer.current;
      const coast = 0.45 + 0.55 * fadeOut.current;
      renderPos.current.x += vx * safeDt * coast;
      renderPos.current.z += vz * safeDt * coast;

      g.visible = true;
      g.position.set(renderPos.current.x, 0, renderPos.current.z);

      if (orb.current) {
        orb.current.position.y = renderPos.current.y;
        orb.current.rotation.x += safeDt * 2.4;
        orb.current.rotation.y += safeDt * 3.6;
        orb.current.rotation.z += safeDt * 1.1;
        const s = 0.75 + 0.25 * fadeOut.current;
        orb.current.scale.setScalar(s);
      }

      const fo = fadeOut.current * fadeOut.current;
      auraFade.current = fo;
      coreMat.opacity = fo;
      glowMat.opacity = fo * 0.45;
      if (light.current) light.current.intensity = fo * 1.8;
      return;
    }

    // Live projectile
    fadingOut.current = false;
    fadeOut.current = 1;
    g.visible = true;

    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;

    if (!seeded.current) {
      renderPos.current.set(p.x, FROST_BALL_CAST.handY, p.z);
      lastServer.current = { x: p.x, z: p.z, vx, vz };
      seeded.current = true;
      appear.current = 0;
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

    appear.current = Math.min(1, appear.current + safeDt / APPEAR_SEC);
    const fade = appear.current * appear.current * (3 - 2 * appear.current);
    auraFade.current = fade;

    g.position.set(renderPos.current.x, 0, renderPos.current.z);

    if (orb.current) {
      orb.current.position.y = renderPos.current.y;
      orb.current.rotation.x += safeDt * 2.4;
      orb.current.rotation.y += safeDt * 3.6;
      orb.current.rotation.z += safeDt * 1.1;
      orb.current.scale.setScalar(1);
    }

    const nextColor = abilityVfxColor(p.abilityId ?? "frostBall");
    if (nextColor !== colorHex.current) {
      colorHex.current = nextColor;
      tintEnergyMaterial(coreMat, nextColor);
      tintEnergyMaterial(glowMat, nextColor);
    }

    coreMat.opacity = fade;
    glowMat.opacity = fade * 0.45;
    if (light.current) light.current.intensity = fade * 1.8;

    if (core.current) core.current.scale.setScalar(1);
    if (glow.current) glow.current.scale.setScalar(1.65);
  });

  return (
    <group ref={group} visible={false}>
      <group ref={orb}>
        <mesh ref={core}>
          <icosahedronGeometry args={[0.42, 1]} />
          <primitive object={coreMat} attach="material" />
        </mesh>
        <mesh ref={glow}>
          <icosahedronGeometry args={[0.42, 0]} />
          <primitive object={glowMat} attach="material" />
        </mesh>
        <pointLight ref={light} color="#7dd3fc" intensity={0} distance={5.5} decay={2} />
      </group>
      <GroundDecal
        preset={frostPreset}
        shape="circle"
        x={0}
        z={0}
        y={0.04}
        radius={frostPreset.radius}
        opacityMulRef={auraFade}
      />
    </group>
  );
}
