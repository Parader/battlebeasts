import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { smooth01 } from "../easing";
import { createCirclePointMaterial } from "../materials/circlePoint";
import { ASTRAL_CHAIN_COLORS } from "./astralChainPalette";

const N = 10;

/**
 * Astral Chain break — dissolve (expire) or snap (escape).
 * shot at caster; originX/Z = target end.
 */
export function AstralChainBreakEffect({ shot }: { shot: OneShotEffect }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const escape = (shot.variant ?? 0) === 1;

  const posA = useMemo(() => new Float32Array(6), []);
  const posB = useMemo(() => new Float32Array(6), []);
  const geoA = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(posA, 3));
    return g;
  }, [posA]);
  const geoB = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(posB, 3));
    return g;
  }, [posB]);

  const lineMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: escape ? ASTRAL_CHAIN_COLORS.highlight : ASTRAL_CHAIN_COLORS.bright,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [escape],
  );
  const lineA = useMemo(() => new THREE.Line(geoA, lineMat), [geoA, lineMat]);
  const lineB = useMemo(() => new THREE.Line(geoB, lineMat), [geoB, lineMat]);
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: ASTRAL_CHAIN_COLORS.bright,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const motePos = useMemo(() => new Float32Array(N * 3), []);
  const moteSize = useMemo(() => new Float32Array(N), []);
  const moteAlpha = useMemo(() => new Float32Array(N), []);
  const dirs = useMemo(
    () =>
      Array.from({ length: N }, () => {
        const a = Math.random() * Math.PI * 2;
        return {
          x: Math.cos(a),
          y: 0.15 + Math.random() * 0.5,
          z: Math.sin(a),
          speed: (escape ? 1.4 : 0.8) + Math.random() * 0.8,
        };
      }),
    [escape],
  );
  const moteGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(moteSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(moteAlpha, 1));
    return g;
  }, [motePos, moteSize, moteAlpha]);
  const pointMat = useMemo(() => createCirclePointMaterial(ASTRAL_CHAIN_COLORS.highlight), []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    if (ms >= shot.life) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const t = Math.min(1, ms / shot.life);
    const fade = 1 - smooth01(Math.max(0, (t - 0.35) / 0.65));
    const split = smooth01(Math.min(1, ms / (escape ? 90 : 140)));

    const ax = 0;
    const ay = 0;
    const az = 0;
    const bx = (typeof shot.originX === "number" ? shot.originX : shot.x) - shot.x;
    const by = 0;
    const bz = (typeof shot.originZ === "number" ? shot.originZ : shot.z) - shot.z;
    const mx = (ax + bx) * 0.5;
    const my = -0.12;
    const mz = (az + bz) * 0.5;

    // Half A: caster → midpoint (retracts toward caster)
    const aPull = split;
    posA[0] = ax;
    posA[1] = ay;
    posA[2] = az;
    posA[3] = THREE.MathUtils.lerp(mx, ax, aPull);
    posA[4] = THREE.MathUtils.lerp(my, ay, aPull);
    posA[5] = THREE.MathUtils.lerp(mz, az, aPull);
    // Half B: target → midpoint
    posB[0] = bx;
    posB[1] = by;
    posB[2] = bz;
    posB[3] = THREE.MathUtils.lerp(mx, bx, aPull);
    posB[4] = THREE.MathUtils.lerp(my, by, aPull);
    posB[5] = THREE.MathUtils.lerp(mz, bz, aPull);
    geoA.attributes.position!.needsUpdate = true;
    geoB.attributes.position!.needsUpdate = true;
    lineMat.opacity = 0.85 * fade;

    if (ring.current) {
      ring.current.position.set(bx, by, bz);
      ring.current.rotation.x = -Math.PI / 2;
      const ringT = escape ? smooth01(Math.min(1, ms / 70)) : 0;
      ring.current.scale.setScalar(THREE.MathUtils.lerp(0.1, 0.45, ringT));
      ringMat.opacity = escape ? ringT * (1 - t) * 0.7 : 0;
    }

    for (let i = 0; i < N; i++) {
      const d = dirs[i]!;
      const fromMid = i < N / 2;
      const ox = fromMid ? mx : bx;
      const oy = fromMid ? my : by;
      const oz = fromMid ? mz : bz;
      motePos[i * 3] = ox + d.x * d.speed * split * 0.45;
      motePos[i * 3 + 1] = oy + d.y * d.speed * split * 0.35;
      motePos[i * 3 + 2] = oz + d.z * d.speed * split * 0.45;
      moteSize[i] = (0.025 + (1 - split) * 0.02) * (escape ? 40 : 32);
      moteAlpha[i] = (1 - split * 0.85) * fade * 0.75;
    }
    moteGeo.attributes.position!.needsUpdate = true;
    moteGeo.attributes.aSize!.needsUpdate = true;
    moteGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={group} position={[shot.x, shot.y ?? 1.15, shot.z]}>
      <primitive object={lineA} renderOrder={8} />
      <primitive object={lineB} renderOrder={8} />
      <mesh ref={ring} material={ringMat} renderOrder={7}>
        <ringGeometry args={[0.55, 0.72, 24]} />
      </mesh>
      <points geometry={moteGeo} material={pointMat} renderOrder={9} frustumCulled={false} />
    </group>
  );
}
