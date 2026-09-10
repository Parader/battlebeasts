import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { createSmokePointMaterial } from "./vfx/materials/circlePoint";
import { getSmokeTexture } from "./vfx/smokeTexture";

const HEX = "#8B2DCE";
const HEX_HOT = "#e9d5ff";
const SMOKE = "#2e1065";
const SMOKE_HOT = "#6b21a8";
const SMOKE_COUNT = 10;

type Props = {
  /** Polled each frame — true while hexAnchored is active. */
  getActive: () => boolean;
};

/**
 * Persistent Hex Anchor mark: feet pentagon + hovering shadow-smoke orb beside the body.
 */
export function HexAnchorOrnament({ getActive }: Props) {
  const root = useRef<THREE.Group>(null);
  const feet = useRef<THREE.Group>(null);
  const smokeRoot = useRef<THREE.Group>(null);
  const reveal = useRef(0);
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  const orb = useRef<THREE.Mesh>(null);

  const outerMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: HEX,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const innerMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: HEX_HOT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const coreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: HEX,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const orbMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: SMOKE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.NormalBlending,
      }),
    [],
  );

  const smokePositions = useMemo(() => new Float32Array(SMOKE_COUNT * 3), []);
  const smokeSizes = useMemo(() => new Float32Array(SMOKE_COUNT), []);
  const smokeAlphas = useMemo(() => new Float32Array(SMOKE_COUNT), []);
  const smokeGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(smokePositions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(smokeSizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(smokeAlphas, 1));
    return geo;
  }, [smokePositions, smokeSizes, smokeAlphas]);
  const smokePointMat = useMemo(() => {
    const mat = createSmokePointMaterial(SMOKE_HOT);
    if (mat.uniforms.uMap) mat.uniforms.uMap.value = getSmokeTexture();
    return mat;
  }, []);

  const wispSpecs = useMemo(
    () =>
      Array.from({ length: SMOKE_COUNT }, (_, i) => ({
        ang: (i / SMOKE_COUNT) * Math.PI * 2,
        radius: 0.08 + (i % 3) * 0.035,
        baseY: -0.05 + (i % 4) * 0.04,
        rise: 0.28 + (i % 3) * 0.08,
        size: 0.055 + (i % 3) * 0.02,
        speed: 0.55 + (i % 4) * 0.12,
        phase: i * 0.71,
        spin: 0.7 + (i % 3) * 0.25,
      })),
    [],
  );

  useFrame(({ clock }, dt) => {
    const g = root.current;
    if (!g) return;
    const want = getActive();
    const safeDt = Math.min(0.05, dt);
    reveal.current = THREE.MathUtils.clamp(
      reveal.current + (want ? 1 : -1) * safeDt * 6,
      0,
      1,
    );
    const p = reveal.current;
    const eased = p * p * (3 - 2 * p);
    g.visible = p > 0.01;
    if (p <= 0.01) {
      outerMat.opacity = 0;
      innerMat.opacity = 0;
      coreMat.opacity = 0;
      orbMat.opacity = 0;
      return;
    }

    const t = clock.elapsedTime;
    const pulse = 0.85 + 0.15 * Math.sin(t * 5.5);
    // Feet sigil spins; smoke orb stays fixed beside the body and just follows.
    if (feet.current) feet.current.rotation.y += safeDt * 0.85;
    if (outer.current) outer.current.scale.setScalar(0.95 + 0.06 * pulse);
    if (inner.current) inner.current.scale.setScalar(0.9 + 0.08 * (1 - pulse));
    outerMat.opacity = 0.55 * eased * pulse;
    innerMat.opacity = 0.4 * eased;
    coreMat.opacity = 0.28 * eased * pulse;

    if (smokeRoot.current) {
      const bob = Math.sin(t * 2.4) * 0.06;
      const sway = Math.sin(t * 1.7) * 0.04;
      smokeRoot.current.position.set(0.58 + sway, 1.15 + bob, 0.12);
      smokeRoot.current.visible = true;
    }
    if (orb.current) {
      const s = 0.11 + 0.018 * Math.sin(t * 4.2);
      orb.current.scale.setScalar(s);
    }
    orbMat.opacity = 0.72 * eased;

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const spec = wispSpecs[i]!;
      const cycle = (t * spec.speed + spec.phase) % 1;
      const ang = spec.ang + t * spec.spin;
      const y = spec.baseY + cycle * spec.rise;
      const outward = 0.55 + cycle * 0.9;
      smokePositions[i * 3] = Math.cos(ang) * spec.radius * outward;
      smokePositions[i * 3 + 1] = y;
      smokePositions[i * 3 + 2] = Math.sin(ang) * spec.radius * outward;
      const fade =
        cycle < 0.12 ? cycle / 0.12 : cycle > 0.55 ? 1 - (cycle - 0.55) / 0.45 : 1;
      smokeSizes[i] = spec.size * (0.85 + cycle * 1.35) * 34;
      smokeAlphas[i] = Math.max(0, fade) * eased * (0.45 + (i % 3) * 0.08);
    }
    smokeGeo.attributes.position!.needsUpdate = true;
    smokeGeo.attributes.aSize!.needsUpdate = true;
    smokeGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={root} position={[0, 0.05, 0]} visible={false}>
      <group ref={feet}>
        <mesh ref={outer} rotation={[-Math.PI / 2, 0, 0]} renderOrder={22}>
          <ringGeometry args={[0.42, 0.62, 5]} />
          <primitive object={outerMat} attach="material" />
        </mesh>
        <mesh
          ref={inner}
          rotation={[-Math.PI / 2, 0, Math.PI / 5]}
          position={[0, 0.008, 0]}
          renderOrder={21}
        >
          <ringGeometry args={[0.22, 0.36, 5]} />
          <primitive object={innerMat} attach="material" />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} renderOrder={20}>
          <circleGeometry args={[0.14, 5]} />
          <primitive object={coreMat} attach="material" />
        </mesh>
      </group>

      <group ref={smokeRoot} position={[0.58, 1.15, 0.12]}>
        <mesh ref={orb} renderOrder={24}>
          <sphereGeometry args={[1, 12, 10]} />
          <primitive object={orbMat} attach="material" />
        </mesh>
        <points geometry={smokeGeo} renderOrder={25}>
          <primitive object={smokePointMat} attach="material" />
        </points>
      </group>
    </group>
  );
}
