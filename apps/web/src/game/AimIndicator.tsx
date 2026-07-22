import { useMemo } from "react";
import * as THREE from "three";

type Props = {
  /** Accent color; readable on dark ground. */
  color?: string;
  /** Ring radius in world units. */
  radius?: number;
};

/**
 * Ground-plane aim cue meshes (circle + forward tip).
 * Parent should set `rotation.y` to gameplay aim yaw each frame.
 * Tip points along local +Z (yaw 0 = world +Z).
 */
export function AimIndicator({ color = "#7dd3fc", radius = 0.55 }: Props) {
  const tipGeom = useMemo(() => {
    const shape = new THREE.Shape();
    const w = 0.14;
    const depth = 0.18;
    // Shape is XY; after rotateX(-90°) → XZ with +Y mapping to -Z.
    // Put the tip on -Y so it lands on +Z (yaw 0 / aim forward).
    shape.moveTo(0, -(radius + depth));
    shape.lineTo(w, -(radius - 0.02));
    shape.lineTo(-w, -(radius - 0.02));
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [radius]);

  return (
    <group position={[0, 0.025, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <ringGeometry args={[radius - 0.035, radius, 48]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={tipGeom} renderOrder={2}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.85}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
