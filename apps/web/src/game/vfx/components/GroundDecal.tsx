import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GroundDecalPreset, GroundShape } from "../kit/types";
import {
  applyGroundDecalPreset,
  createGroundDecalMaterial,
  setGroundDecalOpacity,
  setGroundDecalProgress,
  tickGroundDecal,
} from "../materials/groundDecal";
import { softEnvelope } from "../easing";

export type GroundDecalProps = {
  preset: GroundDecalPreset;
  /** Overrides preset.shape when set. */
  shape?: GroundShape;
  x?: number;
  y?: number;
  z?: number;
  /** Yaw for oriented shapes (cone/line/rect/arc). */
  yaw?: number;
  radius?: number;
  born?: number;
  life?: number;
  /** Manual 0..1 when not using born/life. */
  progress?: number;
};

/**
 * Elemental ground mark — one plane, shape + element from preset.
 */
export function GroundDecal({
  preset,
  shape,
  x = 0,
  y = 0.03,
  z = 0,
  yaw = 0,
  radius,
  born,
  life,
  progress,
}: GroundDecalProps) {
  const mesh = useRef<THREE.Mesh>(null);
  const resolvedShape = shape ?? preset.shape;
  const r = radius ?? preset.radius;
  const lifeMs = life ?? preset.lifeMs;

  const mat = useMemo(
    () => createGroundDecalMaterial(preset, resolvedShape),
    // Recreate when element/shape identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset.element, resolvedShape, preset.additive],
  );

  useEffect(() => {
    applyGroundDecalPreset(mat, preset, resolvedShape);
  }, [mat, preset, resolvedShape]);

  useEffect(() => () => mat.dispose(), [mat]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;

    let age = progress;
    if (born !== undefined && lifeMs > 0) {
      age = (performance.now() - born) / lifeMs;
    }
    if (age === undefined) {
      setGroundDecalProgress(mat, 1);
      setGroundDecalOpacity(mat, preset.opacity);
      m.visible = true;
      tickGroundDecal(mat, dt);
      return;
    }

    const t = THREE.MathUtils.clamp(age, 0, 1);
    // Expand once outward — never shrink (that read as a second shockwave).
    const expand = THREE.MathUtils.smoothstep(t, 0, 0.08);
    const fade = softEnvelope(t, preset.appearEnd ?? 0.12, preset.fadeStart ?? 0.55);
    setGroundDecalProgress(mat, expand);
    setGroundDecalOpacity(mat, preset.opacity * fade);
    m.visible = t < 1 && fade > 0.02;
    const spin = preset.spin ?? 0;
    if (spin !== 0) m.rotation.z += spin * dt;
    tickGroundDecal(mat, dt, spin);
  });

  return (
    <mesh
      ref={mesh}
      position={[x, y, z]}
      rotation={[-Math.PI / 2, 0, yaw]}
      scale={[r * 2, r * 2, 1]}
    >
      <planeGeometry args={[1, 1]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}
