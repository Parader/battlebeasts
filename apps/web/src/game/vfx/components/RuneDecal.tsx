import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { createRuneMaterial, tickRuneMaterial } from "../materials/rune";
import { softEnvelope } from "../easing";

export type RuneDecalProps = {
  color: string;
  size?: number;
  y?: number;
  progress?: number;
  born?: number;
  life?: number;
  spin?: number;
};

/** Flat ground rune / sigil decal — soft-eased appear/fade. */
export function RuneDecal({
  color,
  size = 1.4,
  y = 0.05,
  progress,
  born,
  life,
  spin = 0.6,
}: RuneDecalProps) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => createRuneMaterial(color, { opacity: 0 }), [color]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    m.rotation.z += spin * dt;
    tickRuneMaterial(mat, dt);

    let age: number | undefined = progress;
    if (born !== undefined && life !== undefined && life > 0) {
      age = (performance.now() - born) / life;
    }

    if (age !== undefined) {
      const t = THREE.MathUtils.clamp(age, 0, 1);
      const amp = softEnvelope(t, 0.4, 0.55);
      mat.uniforms.uOpacity!.value = amp * 0.85;
      m.scale.setScalar(size * (0.35 + amp * 0.65));
      m.visible = t < 1 && amp > 0.01;
    }
  });

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} scale={size * 0.35}>
      <planeGeometry args={[1, 1]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}
