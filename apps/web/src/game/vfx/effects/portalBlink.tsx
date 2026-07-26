import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { createCirclePointMaterial } from "../materials/circlePoint";

/** variant 0 = depart (shrink), 1 = arrive (pop in). */
const DEPART = 0;
const ARRIVE = 1;

const DARK_PARTICLE_COUNT = 22;
const ARRIVE_PARTICLE_COUNT = 28;

/**
 * Portal blink FX — depart is a quick shrinking bubble + dark motes;
 * arrive is a short static ring pop (no spin).
 */
export function PortalBlinkEffect({ shot }: { shot: OneShotEffect }) {
  const isDepart = (shot.variant ?? DEPART) === DEPART;
  return isDepart ? <PortalDepartEffect shot={shot} /> : <PortalArriveEffect shot={shot} />;
}

function PortalDepartEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const bubble = useRef<THREE.Mesh>(null);
  const rim = useRef<THREE.Mesh>(null);
  /** Charge scale baked at blink (0.18–1). */
  const startScale = Math.max(0.2, Math.min(1.15, shot.radius ?? 1));
  const positions = useMemo(() => new Float32Array(DARK_PARTICLE_COUNT * 3), []);
  const sizes = useMemo(() => new Float32Array(DARK_PARTICLE_COUNT), []);
  const alphas = useMemo(() => new Float32Array(DARK_PARTICLE_COUNT), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: DARK_PARTICLE_COUNT }, (_, i) => ({
        ang: (i / DARK_PARTICLE_COUNT) * Math.PI * 2,
        elev: (i % 5) * 0.18 - 0.2,
        r0: 0.35 + (i % 4) * 0.1,
        drift: 0.35 + (i % 3) * 0.15,
      })),
    [],
  );
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return g;
  }, [positions, sizes, alphas]);

  const bubbleMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#2e1065",
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );
  const rimMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: shot.color,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [shot.color],
  );
  const pointMat = useMemo(() => createCirclePointMaterial("#1c1917"), []);

  useEffect(() => {
    return () => {
      geo.dispose();
      bubbleMat.dispose();
      rimMat.dispose();
      pointMat.dispose();
    };
  }, [geo, bubbleMat, rimMat, pointMat]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = (performance.now() - shot.born) / Math.max(1, shot.life);
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(shot.x, shot.y, shot.z);

    // Collapse from channel size → point (only the fast part)
    const t = Math.min(1, age);
    const ease = t * t;
    const scale = Math.max(0.02, startScale * (1 - ease));
    const fade = 1 - t;
    if (bubble.current) bubble.current.scale.setScalar(scale);
    if (rim.current) rim.current.scale.setScalar(scale * 1.03);
    bubbleMat.opacity = 0.2 * fade;
    rimMat.opacity = 0.28 * fade;

    for (let i = 0; i < DARK_PARTICLE_COUNT; i++) {
      const s = seeds[i]!;
      const r = s.r0 * startScale * (1 - ease * 0.9) + ease * 0.04;
      positions[i * 3] = Math.cos(s.ang) * r;
      positions[i * 3 + 1] = s.elev * startScale * (1 - ease * 0.7) - ease * 0.2;
      positions[i * 3 + 2] = Math.sin(s.ang) * r;
      sizes[i] = (0.03 + (i % 3) * 0.01) * (1 - ease * 0.45) * 36;
      alphas[i] = fade * (0.45 + (i % 3) * 0.1);
    }
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.aSize!.needsUpdate = true;
    geo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={bubble} material={bubbleMat}>
        <sphereGeometry args={[0.85, 18, 14]} />
      </mesh>
      <mesh ref={rim} material={rimMat}>
        <sphereGeometry args={[0.85, 18, 14]} />
      </mesh>
      <points geometry={geo} material={pointMat} frustumCulled={false} />
    </group>
  );
}

function PortalArriveEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringInner = useRef<THREE.Mesh>(null);
  const positions = useMemo(() => new Float32Array(ARRIVE_PARTICLE_COUNT * 3), []);
  const sizes = useMemo(() => new Float32Array(ARRIVE_PARTICLE_COUNT), []);
  const alphas = useMemo(() => new Float32Array(ARRIVE_PARTICLE_COUNT), []);
  const splash = useMemo(
    () =>
      Array.from({ length: ARRIVE_PARTICLE_COUNT }, (_, i) => {
        const a = (i / ARRIVE_PARTICLE_COUNT) * Math.PI * 2 + (i % 3) * 0.11;
        return {
          ang: a,
          speed: 1.1 + (i % 5) * 0.22,
          lift: 0.15 + (i % 4) * 0.08,
          size: 0.055 + (i % 3) * 0.02,
        };
      }),
    [],
  );
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return g;
  }, [positions, sizes, alphas]);

  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: shot.color,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [shot.color],
  );
  const innerMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#e9d5ff",
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const pointMat = useMemo(() => createCirclePointMaterial(shot.color), [shot.color]);

  useEffect(() => {
    return () => {
      geo.dispose();
      ringMat.dispose();
      innerMat.dispose();
      pointMat.dispose();
    };
  }, [geo, ringMat, innerMat, pointMat]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = (performance.now() - shot.born) / Math.max(1, shot.life);
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(shot.x, 0.05, shot.z);

    // Grow outward while fading (fast)
    const t = Math.min(1, age);
    const fade = 1 - t;
    const scale = 0.55 + t * 1.65;
    if (ring.current) ring.current.scale.setScalar(scale);
    if (ringInner.current) ringInner.current.scale.setScalar(scale * 0.7);
    ringMat.opacity = 0.85 * fade;
    innerMat.opacity = 0.45 * fade;

    // Outward splash — ease-out so it bursts quickly then drifts
    const burst = 1 - (1 - t) * (1 - t);
    for (let i = 0; i < ARRIVE_PARTICLE_COUNT; i++) {
      const s = splash[i]!;
      const r = 0.12 + burst * s.speed;
      const y = 0.06 + Math.sin(burst * Math.PI) * s.lift;
      positions[i * 3] = Math.cos(s.ang) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(s.ang) * r;
      sizes[i] = s.size * (0.85 + fade * 0.4) * 42;
      alphas[i] = fade * (0.55 + (i % 3) * 0.1);
    }
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.aSize!.needsUpdate = true;
    geo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={ring} material={ringMat} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.48, 0.045, 8, 32]} />
      </mesh>
      <mesh ref={ringInner} material={innerMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <torusGeometry args={[0.32, 0.028, 6, 28]} />
      </mesh>
      <points geometry={geo} material={pointMat} frustumCulled={false} />
    </group>
  );
}
