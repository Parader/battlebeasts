import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ABILITIES } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope, smooth01 } from "../easing";
import {
  GEO_SPIKE_KNOB,
  GEO_SPIKE_STALK,
  GEO_SPIKE_THORN,
  GEO_SPIKE_TIP,
} from "../sharedGeo";

/** Root / wood browns — earthy, not poison green. */
const ROOT_COLORS = [
  { bark: "#3B2314", tip: "#8B5A2B" },
  { bark: "#2A1810", tip: "#A67C52" },
  { bark: "#4A2F1C", tip: "#C4A484" },
  { bark: "#1F120C", tip: "#6B4423" },
  { bark: "#5C3A21", tip: "#D2B48C" },
] as const;

/**
 * Concentric rings — tall center, then circumference levels getting smaller.
 * radiusFrac is relative to hit radius.
 */
const RINGS: ReadonlyArray<{
  count: number;
  radiusFrac: number;
  height: number;
  thick: number;
}> = [
  { count: 1, radiusFrac: 0, height: 1.05, thick: 0.85 },
  { count: 6, radiusFrac: 0.32, height: 0.78, thick: 0.64 },
  { count: 10, radiusFrac: 0.58, height: 0.52, thick: 0.46 },
  { count: 14, radiusFrac: 0.82, height: 0.32, thick: 0.32 },
  { count: 18, radiusFrac: 1.0, height: 0.2, thick: 0.24 },
];

type SpikeSpec = {
  ox: number;
  oz: number;
  yaw: number;
  leanX: number;
  leanZ: number;
  height: number;
  thick: number;
  delay: number;
  thornLean: number;
  thornYaw: number;
  thornScale: number;
  colorIdx: number;
  hasThorns: boolean;
};

function hash01(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Underground Pulse — brown root spikes in concentric rings
 * (center tall → outer circumference tiny). No poison mist.
 */
export function UndergroundPulseEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const stalksRef = useRef<THREE.Group>(null);
  const hitR = Math.max(1.2, shot.radius ?? ABILITIES.undergroundPulse?.radius ?? 2.2);
  const life = Math.max(700, shot.life || 750);
  const seedKey = Math.floor(shot.key * 7919 + shot.x * 100 + shot.z * 37);

  const spikes = useMemo((): SpikeSpec[] => {
    const out: SpikeSpec[] = [];
    let idx = 0;
    for (let ring = 0; ring < RINGS.length; ring++) {
      const r = RINGS[ring]!;
      const ringR = hitR * r.radiusFrac;
      for (let i = 0; i < r.count; i++) {
        const ang =
          r.count === 1
            ? hash01(seedKey + ring * 17) * Math.PI * 2
            : (i / r.count) * Math.PI * 2 + hash01(seedKey + ring * 31 + i) * 0.28;
        const jitter = ring === 0 ? 0 : (hash01(seedKey + idx * 13) - 0.5) * 0.08 * hitR;
        out.push({
          ox: Math.cos(ang) * (ringR + jitter),
          oz: Math.sin(ang) * (ringR + jitter),
          yaw: ang + (hash01(seedKey + idx * 7) - 0.5) * 0.45,
          leanX: (hash01(seedKey + idx * 11) - 0.5) * (0.18 + ring * 0.06),
          leanZ: (hash01(seedKey + idx * 19) - 0.5) * (0.18 + ring * 0.06),
          height: r.height * (0.88 + hash01(seedKey + idx * 23) * 0.24),
          thick: r.thick * (0.88 + hash01(seedKey + idx * 29) * 0.24),
          delay: ring * 0.04 + hash01(seedKey + idx * 37) * 0.03,
          thornLean: 0.4 + hash01(seedKey + idx * 41) * 0.35,
          thornYaw: ang + Math.PI * 0.35,
          thornScale: 0.32 + hash01(seedKey + idx * 43) * 0.2,
          colorIdx: Math.floor(hash01(seedKey + idx * 47) * ROOT_COLORS.length),
          hasThorns: ring <= 1,
        });
        idx++;
      }
    }
    return out;
  }, [hitR, seedKey]);

  const barkMats = useMemo(
    () =>
      ROOT_COLORS.map(
        (c) =>
          new THREE.MeshStandardMaterial({
            color: c.bark,
            emissive: c.bark,
            emissiveIntensity: 0.25,
            roughness: 0.9,
            metalness: 0.02,
            transparent: true,
            opacity: 1,
          }),
      ),
    [],
  );
  const tipMats = useMemo(
    () =>
      ROOT_COLORS.map(
        (c) =>
          new THREE.MeshBasicMaterial({
            color: c.tip,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            toneMapped: false,
          }),
      ),
    [],
  );
  const residueMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#3B2314",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const residue = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    if (ms >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const age = ms / life;
    const amp = softEnvelope(age, 0.08, 0.5);

    if (stalksRef.current) {
      for (let i = 0; i < stalksRef.current.children.length; i++) {
        const group = stalksRef.current.children[i] as THREE.Group;
        const spec = spikes[i];
        if (!spec) continue;
        const local = Math.max(0, ms / 1000 - spec.delay);
        const sprout = smooth01(Math.min(1, local / 0.11));
        const hold = local < 0.34 ? 1 : 1 - smooth01(Math.min(1, (local - 0.34) / 0.36));
        const h = Math.max(0.03, sprout * hold * spec.height);
        const thick = spec.thick * (0.55 + sprout * 0.45);
        group.visible = sprout > 0.02 && hold > 0.02;
        group.scale.set(thick, h, thick);
        group.position.set(spec.ox, 0, spec.oz);
      }
      for (const mat of barkMats) {
        mat.opacity = Math.max(0.2, amp);
        mat.emissiveIntensity = 0.12 + amp * 0.22;
      }
      for (const mat of tipMats) {
        mat.opacity = amp * 0.9;
      }
    }

    if (residue.current) {
      const rt = smooth01(Math.min(1, Math.max(0, ms - 40) / 140));
      const fade = age < 0.5 ? 1 : 1 - smooth01((age - 0.5) / 0.45);
      residue.current.scale.setScalar(THREE.MathUtils.lerp(0.35, hitR * 0.95, rt));
      residueMat.opacity = 0.22 * rt * fade;
    }
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]}>
      <mesh
        ref={residue}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.018, 0]}
        material={residueMat}
        renderOrder={2}
      >
        <circleGeometry args={[1, 28]} />
      </mesh>

      <group ref={stalksRef}>
        {spikes.map((r, i) => {
          const bark = barkMats[r.colorIdx]!;
          const tip = tipMats[r.colorIdx]!;
          return (
            <group
              key={i}
              rotation={[r.leanX, r.yaw, r.leanZ]}
              position={[r.ox, 0, r.oz]}
            >
              <mesh material={bark} position={[0, 0.5, 0]} geometry={GEO_SPIKE_STALK} />
              <mesh
                material={bark}
                position={[0, 0.06, 0]}
                rotation={[Math.PI, 0, 0]}
                scale={[1.25, 0.45, 1.25]}
                geometry={GEO_SPIKE_KNOB}
              />
              {r.hasThorns && (
                <mesh
                  material={bark}
                  position={[0.035, 0.38, 0]}
                  rotation={[r.thornLean, r.thornYaw, 0.12]}
                  scale={[r.thornScale, r.thornScale * 0.85, r.thornScale]}
                  geometry={GEO_SPIKE_THORN}
                />
              )}
              <mesh
                material={tip}
                position={[0, 0.88, 0]}
                scale={[0.7, 1.05, 0.7]}
                geometry={GEO_SPIKE_TIP}
              />
            </group>
          );
        })}
      </group>
    </group>
  );
}
