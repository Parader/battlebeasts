import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createRuneMaterial, tickRuneMaterial } from "./vfx/materials/rune";

const CORE = "#7c3aed";
const HOT = "#ddd6fe";

type Props = {
  /** Polled each frame — true while bindingRooted is active. */
  getActive: () => boolean;
};

/**
 * Binding Sigil bind — thin violet rings + spinning rune at the feet.
 * Deliberately not frost ice (generic `rooted` keeps those spikes).
 */
export function BindingRootedOrnament({ getActive }: Props) {
  const root = useRef<THREE.Group>(null);
  const outer = useRef<THREE.Mesh>(null);
  const hex = useRef<THREE.Mesh>(null);
  const reveal = useRef(0);

  const outerMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: CORE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const hexMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: HOT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const runeMat = useMemo(() => createRuneMaterial(HOT, { opacity: 0, spokes: 8 }), []);

  useEffect(
    () => () => {
      outerMat.dispose();
      hexMat.dispose();
      runeMat.dispose();
    },
    [outerMat, hexMat, runeMat],
  );

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const want = getActive();
    const safeDt = Math.min(0.05, dt);
    reveal.current = THREE.MathUtils.clamp(
      reveal.current + (want ? 1 : -1) * safeDt * 7,
      0,
      1,
    );
    const p = reveal.current;
    const eased = p * p * (3 - 2 * p);
    g.visible = p > 0.01;
    if (p <= 0.01) {
      outerMat.opacity = 0;
      hexMat.opacity = 0;
      runeMat.uniforms.uOpacity!.value = 0;
      return;
    }

    tickRuneMaterial(runeMat, safeDt);
    const t = performance.now() * 0.001;
    const pulse = 0.92 + 0.08 * Math.sin(t * 6);
    if (outer.current) outer.current.scale.setScalar(pulse);
    if (hex.current) hex.current.rotation.z += safeDt * 1.1;
    g.rotation.y += safeDt * 0.35;
    outerMat.opacity = 0.7 * eased * pulse;
    hexMat.opacity = 0.55 * eased;
    runeMat.uniforms.uOpacity!.value = 0.62 * eased;
  });

  return (
    <group ref={root} position={[0, 0.04, 0]} visible={false}>
      <mesh ref={outer} rotation={[-Math.PI / 2, 0, 0]} renderOrder={22}>
        <ringGeometry args={[0.36, 0.385, 48]} />
        <primitive object={outerMat} attach="material" />
      </mesh>
      <mesh
        ref={hex}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.006, 0]}
        renderOrder={23}
      >
        <ringGeometry args={[0.16, 0.2, 6]} />
        <primitive object={hexMat} attach="material" />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        scale={0.55}
        renderOrder={21}
      >
        <planeGeometry args={[1, 1]} />
        <primitive object={runeMat} attach="material" />
      </mesh>
    </group>
  );
}
