import { Billboard } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";

type Props = {
  /** Live 0..1 fill ratio (read each frame). */
  ratioRef: MutableRefObject<number>;
  /** Live visibility (read each frame). */
  visibleRef: MutableRefObject<boolean>;
  y?: number;
  fillColor?: string;
};

/**
 * Shared camera-facing HP bar geometry (player / decoy parity).
 * bg 1.05×0.08, fill 1×0.055, `#111827` / green fill.
 */
export function CombatHpBarBillboard({
  ratioRef,
  visibleRef,
  y = 2.2,
  fillColor = "#4ade80",
}: Props) {
  const root = useRef<THREE.Group>(null);
  const fill = useRef<THREE.Mesh>(null);
  const fillMat = useRef<THREE.MeshBasicMaterial>(null);
  const lastFillColor = useRef(fillColor);

  useFrame(() => {
    const g = root.current;
    const m = fill.current;
    if (!g || !m) return;
    if (!visibleRef.current) {
      g.visible = false;
      return;
    }
    const r = Math.max(0, Math.min(1, ratioRef.current));
    g.visible = true;
    m.scale.x = Math.max(0.001, r);
    m.position.x = -0.5 * (1 - r);
    const mat = fillMat.current;
    if (mat && lastFillColor.current !== fillColor) {
      lastFillColor.current = fillColor;
      mat.color.set(fillColor);
    }
  });

  return (
    <Billboard position={[0, y, 0]} follow renderOrder={1000}>
      <group ref={root} visible={false} renderOrder={1000}>
        <mesh renderOrder={1000}>
          <planeGeometry args={[1.05, 0.08]} />
          <meshBasicMaterial
            color="#111827"
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={fill} position={[0, 0, 0.01]} renderOrder={1001}>
          <planeGeometry args={[1, 0.055]} />
          <meshBasicMaterial
            ref={fillMat}
            color={fillColor}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </Billboard>
  );
}
