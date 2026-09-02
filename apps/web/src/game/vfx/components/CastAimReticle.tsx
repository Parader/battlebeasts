import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CAST_AIM_COLOR, CAST_AIM_HOT } from "../../castAimRuntime";
import { createRuneMaterial, tickRuneMaterial } from "../materials/rune";

/**
 * Artistic place-aim ornament — concentric rings, diamond petals, soft rune.
 * Parent scale already matches aim radius (unit circle). Kept quiet so the
 * outer AoE rim stays the main read.
 */
export function CastAimReticle({
  color = CAST_AIM_COLOR,
  hotColor = CAST_AIM_HOT,
  y = 0.034,
}: {
  color?: string;
  hotColor?: string;
  y?: number;
}) {
  const spin = useRef<THREE.Group>(null);
  const runeMat = useMemo(
    () => createRuneMaterial(color, { opacity: 0.14, spokes: 8 }),
    [color],
  );

  useEffect(() => {
    runeMat.uniforms.uColor!.value.set(color);
  }, [runeMat, color]);

  useEffect(() => () => runeMat.dispose(), [runeMat]);

  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.y += dt * 0.18;
    tickRuneMaterial(runeMat, dt);
  });

  return (
    <group position={[0, y, 0]}>
      {/* Soft radial wash */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <circleGeometry args={[0.82, 48]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.04}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Mid filigree ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <ringGeometry args={[0.5, 0.525, 64]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.18}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Inner halo */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <ringGeometry args={[0.2, 0.225, 48]} />
        <meshBasicMaterial
          color={hotColor}
          transparent
          opacity={0.2}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Four diamond petals (cardinals) */}
      {[0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map((ang) => (
        <mesh
          key={ang}
          rotation={[-Math.PI / 2, 0, ang + Math.PI / 4]}
          position={[Math.sin(ang) * 0.36, 0.001, Math.cos(ang) * 0.36]}
          renderOrder={2}
        >
          <planeGeometry args={[0.06, 0.06]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.16}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Tiny outer tick marks between petals */}
      {[Math.PI / 4, (Math.PI * 3) / 4, (Math.PI * 5) / 4, (Math.PI * 7) / 4].map((ang) => (
        <mesh
          key={`t${ang}`}
          rotation={[-Math.PI / 2, 0, ang]}
          position={[Math.sin(ang) * 0.6, 0.001, Math.cos(ang) * 0.6]}
          renderOrder={2}
        >
          <planeGeometry args={[0.012, 0.05]} />
          <meshBasicMaterial
            color={hotColor}
            transparent
            opacity={0.14}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Slow-spinning sigil disc */}
      <group ref={spin}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} scale={0.3}>
          <circleGeometry args={[1, 48]} />
          <primitive object={runeMat} attach="material" />
        </mesh>
      </group>

      {/* Soft center glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} renderOrder={4}>
        <circleGeometry args={[0.04, 20]} />
        <meshBasicMaterial
          color={hotColor}
          transparent
          opacity={0.28}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
