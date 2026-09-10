import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { createSmokePointMaterial } from "./vfx/materials/circlePoint";
import { getSmokeTexture } from "./vfx/smokeTexture";

const ORB = "#a16207";
const ORB_HOT = "#fde68a";
const SMOKE_COUNT = 10;
const AMBIENT_COUNT = 18;

type Props = {
  /** Polled each frame — true while spellbreakerCharge is active. */
  getActive: () => boolean;
  /** Stacks 1–3 for orb count / size. */
  getStacks?: () => number;
};

/**
 * Yellow Spellbreaker orbs beside the caster + slow ambient motes around the body.
 * Appears as soon as a projectile is blocked; lingers for the full charge duration.
 */
export function SpellbreakerOrbOrnament({ getActive, getStacks }: Props) {
  const root = useRef<THREE.Group>(null);
  const orbRoot = useRef<THREE.Group>(null);
  const reveal = useRef(0);
  const orbRefs = useRef<(THREE.Mesh | null)[]>([]);

  const orbMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: ORB,
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
    const mat = createSmokePointMaterial(ORB_HOT);
    if (mat.uniforms.uMap) mat.uniforms.uMap.value = getSmokeTexture();
    return mat;
  }, []);

  const ambPos = useMemo(() => new Float32Array(AMBIENT_COUNT * 3), []);
  const ambSize = useMemo(() => new Float32Array(AMBIENT_COUNT), []);
  const ambAlpha = useMemo(() => new Float32Array(AMBIENT_COUNT), []);
  const ambGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(ambPos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(ambSize, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(ambAlpha, 1));
    return geo;
  }, [ambPos, ambSize, ambAlpha]);
  const ambMat = useMemo(() => createSmokePointMaterial("#fbbf24"), []);

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

  const ambSpecs = useMemo(
    () =>
      Array.from({ length: AMBIENT_COUNT }, (_, i) => ({
        ang: (i / AMBIENT_COUNT) * Math.PI * 2 + 0.2,
        radius: 0.45 + (i % 5) * 0.12,
        baseY: 0.35 + (i % 4) * 0.28,
        rise: 0.55 + (i % 3) * 0.2,
        size: 0.04 + (i % 3) * 0.015,
        speed: 0.12 + (i % 4) * 0.04,
        phase: i * 0.53,
        spin: 0.15 + (i % 3) * 0.06,
      })),
    [],
  );

  useFrame(({ clock }, dt) => {
    const g = root.current;
    if (!g) return;
    const want = getActive();
    const safeDt = Math.min(0.05, dt);
    // Slow fade-out so orbs don't vanish the moment status updates.
    reveal.current = THREE.MathUtils.clamp(
      reveal.current + (want ? 1 : -1) * safeDt * (want ? 5 : 1.1),
      0,
      1,
    );
    const p = reveal.current;
    const eased = p * p * (3 - 2 * p);
    g.visible = p > 0.01;
    if (p <= 0.01) {
      orbMat.opacity = 0;
      return;
    }

    const t = clock.elapsedTime;
    const stacks = Math.max(1, Math.min(3, getStacks?.() ?? 1));
    const bob = Math.sin(t * 1.6) * 0.05;
    if (orbRoot.current) {
      orbRoot.current.position.set(-0.55, 1.15 + bob, 0.1);
    }

    for (let i = 0; i < 3; i++) {
      const mesh = orbRefs.current[i];
      if (!mesh) continue;
      if (i >= stacks) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      const ang = t * 1.1 + (i / stacks) * Math.PI * 2;
      const r = 0.12 + stacks * 0.03;
      mesh.position.set(
        Math.cos(ang) * r,
        Math.sin(t * 2.2 + i) * 0.04,
        Math.sin(ang) * r,
      );
      mesh.scale.setScalar(0.095 + 0.012 * stacks);
    }
    orbMat.opacity = 0.8 * eased;

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const spec = wispSpecs[i]!;
      const cycle = (t * spec.speed + spec.phase) % 1;
      const ang = spec.ang + t * spec.spin;
      const y = spec.baseY + cycle * spec.rise;
      const outward = 0.55 + cycle * 0.9;
      smokePositions[i * 3] = Math.cos(ang) * spec.radius * outward - 0.55;
      smokePositions[i * 3 + 1] = 1.15 + bob + y;
      smokePositions[i * 3 + 2] = Math.sin(ang) * spec.radius * outward + 0.1;
      const fade =
        cycle < 0.12 ? cycle / 0.12 : cycle > 0.55 ? 1 - (cycle - 0.55) / 0.45 : 1;
      smokeSizes[i] = spec.size * (0.85 + cycle * 1.35) * 34;
      smokeAlphas[i] = Math.max(0, fade) * eased * (0.5 + (i % 3) * 0.08);
    }
    smokeGeo.attributes.position!.needsUpdate = true;
    smokeGeo.attributes.aSize!.needsUpdate = true;
    smokeGeo.attributes.aAlpha!.needsUpdate = true;

    // Slow ambient particles around the character (not racing).
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      const spec = ambSpecs[i]!;
      const cycle = (t * spec.speed + spec.phase) % 1;
      const ang = spec.ang + t * spec.spin;
      const y = spec.baseY + cycle * spec.rise;
      const outward = 0.85 + cycle * 0.35;
      ambPos[i * 3] = Math.cos(ang) * spec.radius * outward;
      ambPos[i * 3 + 1] = y;
      ambPos[i * 3 + 2] = Math.sin(ang) * spec.radius * outward;
      const fade =
        cycle < 0.2 ? cycle / 0.2 : cycle > 0.7 ? 1 - (cycle - 0.7) / 0.3 : 1;
      ambSize[i] = spec.size * (0.8 + cycle * 0.6) * 28;
      ambAlpha[i] = Math.max(0, fade) * eased * 0.35;
    }
    ambGeo.attributes.position!.needsUpdate = true;
    ambGeo.attributes.aSize!.needsUpdate = true;
    ambGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={root} visible={false}>
      <group ref={orbRoot}>
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            ref={(el) => {
              orbRefs.current[i] = el;
            }}
            renderOrder={24}
          >
            <sphereGeometry args={[1, 12, 10]} />
            <primitive object={orbMat} attach="material" />
          </mesh>
        ))}
      </group>
      <points geometry={smokeGeo} renderOrder={25}>
        <primitive object={smokePointMat} attach="material" />
      </points>
      <points geometry={ambGeo} frustumCulled={false} renderOrder={22}>
        <primitive object={ambMat} attach="material" />
      </points>
    </group>
  );
}
