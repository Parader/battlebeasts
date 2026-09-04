import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { smooth01 } from "../easing";
import { createCirclePointMaterial } from "../materials/circlePoint";
import { createEnergyRingMaterial } from "../materials/energyBall";

const DEBRIS = 12;
const CRYSTAL = "#6ee7ff";
const CRYSTAL_HOT = "#e0f7ff";

/**
 * Runic Shard manual shatter — compress → rune flash → thin ring + debris (no sphere boom).
 */
export function RunicShardShatterEffect({ shot }: { shot: OneShotEffect }) {
  const group = useRef<THREE.Group>(null);
  const flash = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);

  const flashMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: CRYSTAL_HOT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const ringMat = useMemo(() => createEnergyRingMaterial(CRYSTAL, 0), []);

  const debrisPos = useMemo(() => new Float32Array(DEBRIS * 3), []);
  const debrisSize = useMemo(() => new Float32Array(DEBRIS), []);
  const debrisAlpha = useMemo(() => new Float32Array(DEBRIS), []);
  const debrisDir = useMemo(
    () =>
      Array.from({ length: DEBRIS }, () => {
        const a = Math.random() * Math.PI * 2;
        return {
          x: Math.cos(a),
          y: 0.15 + Math.random() * 0.35,
          z: Math.sin(a),
          speed: 1.2 + Math.random() * 1.6,
        };
      }),
    [],
  );

  const debrisGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(debrisPos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(debrisSize, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(debrisAlpha, 1));
    return geo;
  }, [debrisPos, debrisSize, debrisAlpha]);

  const debrisMat = useMemo(() => createCirclePointMaterial(CRYSTAL_HOT), []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    if (ms >= shot.life) {
      g.visible = false;
      return;
    }
    g.visible = true;

    // 0–50 compress/flash, 50–90 break, fade out.
    const flashT = smooth01(Math.min(1, ms / 50));
    const breakT = ms < 40 ? 0 : Math.min(1, (ms - 40) / 90);
    const fade = ms < 70 ? 1 : 1 - Math.min(1, (ms - 70) / (shot.life - 70));

    if (flash.current) {
      const s = THREE.MathUtils.lerp(0.12, 0.45, flashT) * (1 - breakT * 0.35);
      flash.current.scale.setScalar(s);
      flashMat.opacity = flashT * (1 - breakT) * 0.95 * fade;
    }
    if (ring.current) {
      const r = THREE.MathUtils.lerp(0.2, 1.1, breakT);
      ring.current.scale.setScalar(r);
      ringMat.opacity = (1 - breakT) * 0.7 * fade;
    }

    for (let i = 0; i < DEBRIS; i++) {
      const d = debrisDir[i]!;
      const t = breakT;
      debrisPos[i * 3] = d.x * d.speed * t * 0.55;
      debrisPos[i * 3 + 1] = d.y * d.speed * t * 0.45;
      debrisPos[i * 3 + 2] = d.z * d.speed * t * 0.55;
      debrisSize[i] = (0.04 + (1 - t) * 0.03) * 36;
      debrisAlpha[i] = (1 - t) * 0.85 * fade;
    }
    debrisGeo.attributes.position!.needsUpdate = true;
    debrisGeo.attributes.aSize!.needsUpdate = true;
    debrisGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={group} position={[shot.x, shot.y, shot.z]}>
      <mesh ref={flash} material={flashMat} renderOrder={8}>
        <sphereGeometry args={[1, 12, 12]} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} material={ringMat} renderOrder={7}>
        <ringGeometry args={[0.35, 0.48, 32]} />
      </mesh>
      <points geometry={debrisGeo} material={debrisMat} renderOrder={6} />
    </group>
  );
}
