import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BLOOD_RUSH_CAST } from "@battlebeasts/shared";
import { abilityVfxColor } from "../colors";
import { createCirclePointMaterial } from "../materials/circlePoint";

const WISP_COUNT = 16;
const BLOOD = "#9f1239";
const BLOOD_HOT = "#f87171";

type CastLite = {
  castAbilityId?: string;
  castPhase?: string;
};

/**
 * Blood Rush crouch charge — rising red wisps + soft ground pulse that builds
 * through anticipation/cast, then drops before the sprint.
 */
export function BloodRushChargeAura({
  room,
  sessionId,
}: {
  room: Room;
  sessionId: string;
}) {
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const haze = useRef<THREE.Mesh>(null);
  const chargeStart = useRef(0);
  const positions = useMemo(() => new Float32Array(WISP_COUNT * 3), []);
  const sizes = useMemo(() => new Float32Array(WISP_COUNT), []);
  const alphas = useMemo(() => new Float32Array(WISP_COUNT), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return g;
  }, [positions, sizes, alphas]);

  const color = abilityVfxColor("bloodRush", BLOOD_HOT);
  const mat = useMemo(() => createCirclePointMaterial(color), [color]);
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BLOOD,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const hazeMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BLOOD,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  const specs = useMemo(
    () =>
      Array.from({ length: WISP_COUNT }, (_, i) => ({
        ang: (i / WISP_COUNT) * Math.PI * 2,
        radius: 0.16 + (i % 5) * 0.045,
        baseY: 0.12 + (i % 3) * 0.08,
        rise: 0.85 + (i % 4) * 0.18,
        size: 0.035 + (i % 3) * 0.018,
        speed: 0.7 + (i % 5) * 0.14,
        phase: i * 0.53,
      })),
    [],
  );

  useFrame(({ clock }) => {
    const g = root.current;
    if (!g) return;
    const p = room.state?.players?.get(sessionId) as CastLite | undefined;
    const charging =
      p?.castAbilityId === "bloodRush" &&
      (p.castPhase === "anticipation" || p.castPhase === "cast");
    if (!charging) {
      g.visible = false;
      chargeStart.current = 0;
      ringMat.opacity = 0;
      hazeMat.opacity = 0;
      return;
    }

    if (chargeStart.current === 0) {
      chargeStart.current = performance.now();
    }

    const chargeMs = Math.max(1, BLOOD_RUSH_CAST.chargeMs);
    const elapsed = performance.now() - chargeStart.current;
    const charge01 = Math.max(0, Math.min(1, elapsed / chargeMs));
    // Ease in so early crouch stays subtle, then ramps hard near release.
    const intensity = charge01 * charge01 * (0.35 + 0.65 * charge01);

    g.visible = true;
    g.position.set(0, 0, 0);

    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * (3.2 + charge01 * 4));
    if (ring.current) {
      const r = 0.42 + intensity * 0.38 + pulse * 0.04;
      ring.current.scale.set(r, r, 1);
      ringMat.opacity = 0.12 + intensity * 0.38 * pulse;
    }
    if (haze.current) {
      const h = 0.55 + intensity * 0.35;
      haze.current.scale.set(h, 1, h);
      hazeMat.opacity = 0.06 + intensity * 0.16;
    }

    const t = clock.elapsedTime;
    for (let i = 0; i < WISP_COUNT; i++) {
      const spec = specs[i]!;
      const cycle = (t * spec.speed * (0.85 + intensity * 0.55) + spec.phase) % 1;
      const ang = spec.ang + t * (0.55 + intensity * 0.9);
      const outward = 0.75 + cycle * (0.55 + intensity * 0.45);
      positions[i * 3] = Math.cos(ang) * spec.radius * outward;
      positions[i * 3 + 1] = spec.baseY + cycle * spec.rise * (0.55 + intensity * 0.7);
      positions[i * 3 + 2] = Math.sin(ang) * spec.radius * outward;
      const fade =
        cycle < 0.1 ? cycle / 0.1 : cycle > 0.55 ? 1 - (cycle - 0.55) / 0.45 : 1;
      sizes[i] = spec.size * (0.7 + cycle * 1.35 + intensity * 0.4) * 38;
      alphas[i] = Math.max(0, fade) * (0.22 + intensity * 0.55);
    }
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.aSize!.needsUpdate = true;
    geo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} material={ringMat} renderOrder={2}>
        <ringGeometry args={[0.72, 1, 40]} />
      </mesh>
      <mesh ref={haze} position={[0, 0.55, 0]} material={hazeMat} renderOrder={2}>
        <sphereGeometry args={[0.55, 16, 12]} />
      </mesh>
      <points geometry={geo} material={mat} frustumCulled={false} />
    </group>
  );
}
