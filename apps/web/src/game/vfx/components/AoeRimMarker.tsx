import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createAoeRimMarkerMaterial,
  setAoeRimMarkerAspect,
  setAoeRimMarkerHalfAngle,
  setAoeRimMarkerOpacity,
  setAoeRimMarkerProgress,
  tickAoeRimMarkerMaterial,
  tintAoeRimMarkerMaterial,
  type AoeRimMarkerMaterialOpts,
  type AoeRimShape,
} from "../materials/aoeRimMarker";

export type AoeRimMarkerProps = {
  /** World XZ center (ignored if parented under a posed group). */
  x?: number;
  z?: number;
  y?: number;
  /**
   * Circle / cone: outer radius.
   * Capsule: half-width of the corridor (end-cap radius).
   */
  radius: number;
  /** Capsule total length along local +X (required for `shape="capsule"`). */
  length?: number;
  /** Cone half-angle from facing (radians). Required for `shape="cone"`. */
  halfAngle?: number;
  shape?: AoeRimShape;
  /** Base tint — rim + soft fill. */
  color: string;
  /** Bright rim core (optional; auto-derived from color). */
  hotColor?: string;
  /** Soft center wash strength (0..1). Default ~0.22. */
  fill?: number;
  rimWidth?: number;
  glowWidth?: number;
  noise?: number;
  /** Static opacity multiplier. */
  opacity?: number;
  /** Live opacity (e.g. telegraph fade) — preferred over `opacity`. */
  opacityMulRef?: { current: number };
  /**
   * Live 0..1 outer radius (circle / cone). Grows the rim with the spell.
   * Defaults to full size when omitted.
   */
  progressRef?: { current: number };
  /** Subtle breathing pulse on the rim. */
  pulse?: boolean;
  renderOrder?: number;
};

const sharedGeo = new THREE.PlaneGeometry(1, 1);

/**
 * Reusable AoE telegraph: energetic outer rim + faint interior wash.
 * - `shape="circle"` — volcano telegraphs, nova zones
 * - `shape="capsule"` — firewall / line corridors (`length` + `radius` half-width)
 * - `shape="cone"` — frontal pie slices (`halfAngle` + `radius`)
 * Tint with `color` for fire (red/orange), frost (cyan), poison (green), etc.
 */
export function AoeRimMarker({
  x = 0,
  z = 0,
  y = 0.028,
  radius,
  length,
  halfAngle = 0.7,
  shape = "circle",
  color,
  hotColor,
  fill,
  rimWidth,
  glowWidth,
  noise,
  opacity = 0.55,
  opacityMulRef,
  progressRef,
  pulse = true,
  renderOrder = -1,
}: AoeRimMarkerProps) {
  const mesh = useRef<THREE.Mesh>(null);
  const halfW = Math.max(0.05, radius);
  const totalLen = shape === "capsule" ? Math.max(halfW * 2, length ?? halfW * 2) : halfW * 2;
  const aspect = totalLen / (halfW * 2);

  const opts = useMemo<AoeRimMarkerMaterialOpts>(
    () => ({ color, hotColor, fill, rimWidth, glowWidth, noise, shape, aspect, halfAngle }),
    // Recreate only when look identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [color, hotColor, fill, rimWidth, glowWidth, noise, shape],
  );
  const mat = useMemo(() => createAoeRimMarkerMaterial(opts), [opts]);

  useEffect(() => {
    tintAoeRimMarkerMaterial(mat, color, hotColor);
  }, [mat, color, hotColor]);

  useEffect(() => {
    setAoeRimMarkerAspect(mat, aspect);
  }, [mat, aspect]);

  useEffect(() => {
    setAoeRimMarkerHalfAngle(mat, halfAngle);
  }, [mat, halfAngle]);

  useEffect(() => () => mat.dispose(), [mat]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    tickAoeRimMarkerMaterial(mat, dt);
    if (progressRef) {
      setAoeRimMarkerProgress(mat, progressRef.current);
    }
    const mul = (opacityMulRef?.current ?? 1) * opacity;
    const breathe = pulse ? 0.92 + 0.08 * Math.sin(performance.now() * 0.006) : 1;
    setAoeRimMarkerOpacity(mat, mul * breathe);
    m.visible = mul > 0.02;
  });

  const sx = shape === "capsule" ? totalLen : halfW * 2;
  const sy = halfW * 2;

  return (
    <mesh
      ref={mesh}
      position={[x, y, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[sx, sy, 1]}
      geometry={sharedGeo}
      material={mat}
      renderOrder={renderOrder}
      frustumCulled={false}
    />
  );
}
