import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { createSmokePointMaterial } from "./vfx/materials/circlePoint";

const BLOOD = "#EF4444";
const BLOOD_HOT = "#FCA5A5";
const MOTES = 10;

type Props = {
  /** Polled each frame — true while bloodPactEmpower is active. */
  getActive: () => boolean;
};

/**
 * Persistent Blood Pact buff: crimson rings at the feet + rising motes around the body.
 */
export function BloodPactOrnament({ getActive }: Props) {
  const root = useRef<THREE.Group>(null);
  const reveal = useRef(0);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const ringC = useRef<THREE.Mesh>(null);
  const motePos = useMemo(() => new Float32Array(MOTES * 3), []);
  const moteSize = useMemo(() => new Float32Array(MOTES), []);
  const moteAlpha = useMemo(() => new Float32Array(MOTES), []);
  const moteGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(moteSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(moteAlpha, 1));
    return g;
  }, [motePos, moteSize, moteAlpha]);
  const moteMat = useMemo(() => createSmokePointMaterial(BLOOD_HOT), []);

  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BLOOD,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const ringHotMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BLOOD_HOT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const on = getActive();
    reveal.current = THREE.MathUtils.damp(reveal.current, on ? 1 : 0, on ? 10 : 6, dt);
    const r = reveal.current;
    g.visible = r > 0.01;
    if (!g.visible) return;

    const t = performance.now() * 0.001;
    ringMat.opacity = 0.4 * r;
    ringHotMat.opacity = 0.28 * r * (0.7 + Math.sin(t * 4) * 0.3);
    if (ringA.current) {
      ringA.current.rotation.z = t * 0.4;
      const s = 0.68 + Math.sin(t * 2.2) * 0.02;
      ringA.current.scale.setScalar(s);
    }
    if (ringB.current) {
      ringB.current.rotation.z = -t * 0.6;
      const s = 0.88 + Math.sin(t * 1.7 + 1) * 0.03;
      ringB.current.scale.setScalar(s);
    }
    if (ringC.current) {
      ringC.current.rotation.z = t * 0.8;
      ringC.current.scale.setScalar(0.48);
    }

    for (let i = 0; i < MOTES; i++) {
      const ang = (i / MOTES) * Math.PI * 2 + t * 0.9;
      const cycle = (t * 0.35 + i * 0.13) % 1;
      const rr = 0.35 + (i % 3) * 0.08;
      motePos[i * 3] = Math.cos(ang) * rr;
      motePos[i * 3 + 1] = 0.35 + cycle * 1.35;
      motePos[i * 3 + 2] = Math.sin(ang) * rr;
      moteSize[i] = (0.04 + (i % 2) * 0.02) * 26;
      moteAlpha[i] = r * (1 - cycle) * 0.7;
    }
    moteGeo.attributes.position!.needsUpdate = true;
    moteGeo.attributes.aSize!.needsUpdate = true;
    moteGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={ringA} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} renderOrder={22}>
        <ringGeometry args={[0.965, 1.0, 48]} />
        <primitive object={ringMat} attach="material" />
      </mesh>
      <mesh ref={ringB} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} renderOrder={23}>
        <ringGeometry args={[0.97, 1.0, 48]} />
        <primitive object={ringHotMat} attach="material" />
      </mesh>
      <mesh ref={ringC} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} renderOrder={24}>
        <ringGeometry args={[0.95, 1.0, 4]} />
        <primitive object={ringHotMat} attach="material" />
      </mesh>
      <points geometry={moteGeo} frustumCulled={false} renderOrder={25}>
        <primitive object={moteMat} attach="material" />
      </points>
    </group>
  );
}
