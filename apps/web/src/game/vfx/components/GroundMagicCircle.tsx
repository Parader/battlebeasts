import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { createEnergyRingMaterial } from "../materials/energyBall";
import { createRuneMaterial, tickRuneMaterial } from "../materials/rune";
import { softEnvelope } from "../easing";

export type GroundMagicCircleProps = {
  color: string;
  radius?: number;
  progress?: number;
  born?: number;
  life?: number;
  y?: number;
  spin?: number;
  showRune?: boolean;
  /** Normalized lifetime when appear finishes (default soft). */
  appearEnd?: number;
  /** Normalized lifetime when fade begins. */
  fadeStart?: number;
};

/**
 * Ground telegraph: additive ring + optional spinning rune disc.
 * Soft-eased appear/fade so it doesn't pop 0→100.
 */
export function GroundMagicCircle({
  color,
  radius = 1.2,
  progress,
  born,
  life,
  y = 0.04,
  spin = 1.2,
  showRune = true,
  appearEnd = 0.4,
  fadeStart = 0.55,
}: GroundMagicCircleProps) {
  const group = useRef<THREE.Group>(null);
  const ringMat = useMemo(() => createEnergyRingMaterial(color, 0), [color]);
  const runeMat = useMemo(
    () => createRuneMaterial(color, { opacity: 0, spokes: 6 }),
    [color],
  );

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;

    let age: number | undefined = progress;
    if (born !== undefined && life !== undefined && life > 0) {
      age = (performance.now() - born) / life;
    }

    if (age !== undefined) {
      const t = THREE.MathUtils.clamp(age, 0, 1);
      const amp = softEnvelope(t, appearEnd, fadeStart);
      g.scale.setScalar(0.25 + amp * 0.85);
      ringMat.opacity = amp * 0.8;
      runeMat.uniforms.uOpacity!.value = amp * 0.65;
      g.visible = t < 1 && amp > 0.01;
    } else {
      g.visible = true;
      g.scale.setScalar(1);
      ringMat.opacity = 0.85;
      runeMat.uniforms.uOpacity!.value = 0.75;
    }

    g.rotation.z += spin * dt;
    tickRuneMaterial(runeMat, dt);
  });

  const outer = radius;
  const inner = radius * 0.72;

  return (
    <group ref={group} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={0.25}>
      <mesh>
        <ringGeometry args={[inner, outer, 48]} />
        <primitive object={ringMat} attach="material" />
      </mesh>
      {showRune && (
        <mesh scale={radius * 1.7}>
          <planeGeometry args={[1, 1]} />
          <primitive object={runeMat} attach="material" />
        </mesh>
      )}
    </group>
  );
}
