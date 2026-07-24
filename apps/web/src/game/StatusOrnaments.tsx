import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { STATUSES } from "@battlebeasts/shared";

export type StatusRowLite = {
  statusId: string;
  stacks?: number;
};

type StatusMapLike = {
  forEach: (cb: (row: { statusId?: string; stacks?: number }) => void) => void;
} | null | undefined;

/** Read active status rows from a Colyseus MapSchema-like object. */
export function collectStatusRows(map: StatusMapLike): StatusRowLite[] {
  if (!map) return [];
  const rows: StatusRowLite[] = [];
  map.forEach((row) => {
    if (row?.statusId && STATUSES[row.statusId]) {
      rows.push({ statusId: row.statusId, stacks: row.stacks ?? 1 });
    }
  });
  return rows;
}

type Props = {
  /** Polled each frame — keep allocation light. */
  getStatuses: () => StatusRowLite[];
  /** Height of ornaments above character origin (feet). */
  headY?: number;
};

function basicMat(color: string, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

/**
 * World-space malus ornaments over a unit (stun tornado, poison, bleed, slow).
 */
export function StatusOrnaments({ getStatuses, headY = 2.15 }: Props) {
  const stun = useRef<THREE.Group>(null);
  const stunRings = useRef<(THREE.Group | null)[]>([null, null, null]);
  const poison = useRef<THREE.Group>(null);
  const bleed = useRef<THREE.Group>(null);
  const slow = useRef<THREE.Group>(null);

  const stunMats = useMemo(
    () => [basicMat("#ffffff", 0.8), basicMat("#f8fafc", 0.65), basicMat("#e2e8f0", 0.5)] as const,
    [],
  );
  const poisonMat = useMemo(() => basicMat("#a78bfa", 0.55), []);
  const bleedMats = useMemo(() => [0, 1, 2, 3].map(() => basicMat("#f87171", 0.65)), []);
  const slowMat = useMemo(() => basicMat("#93c5fd", 0.5), []);

  /** Partial arcs: small→large top→bottom, decentered pivots, desynced spin. */
  const stunLayers = useMemo(
    () =>
      [
        { radius: 0.07, tube: 0.012, y: 0.14, arc: Math.PI * 2, pivot: 0.02, speed: 5.4, phase: 0.2, tilt: 0.28 },
        { radius: 0.105, tube: 0.014, y: 0.075, arc: Math.PI * 2, pivot: 0.028, speed: -3.7, phase: 1.9, tilt: 0.18 },
        { radius: 0.145, tube: 0.015, y: 0.015, arc: Math.PI * 2, pivot: 0.035, speed: 2.6, phase: 3.7, tilt: 0.12 },
      ] as const,
    [],
  );

  useFrame(({ clock }, dt) => {
    const rows = getStatuses();
    const has = (id: string) => rows.some((r) => r.statusId === id);
    const t = clock.elapsedTime;
    const safeDt = Math.min(0.05, dt);

    if (stun.current) {
      stun.current.visible = has("stunned");
      if (stun.current.visible) {
        stun.current.position.y = headY + 0.02 * Math.sin(t * 3.4);
        for (let i = 0; i < stunLayers.length; i++) {
          const layer = stunLayers[i]!;
          const g = stunRings.current[i];
          if (!g) continue;
          g.rotation.y = t * layer.speed + layer.phase;
          // Slight independent bob so rings don't share one rhythm
          g.position.y = layer.y + 0.006 * Math.sin(t * (2.1 + i * 1.3) + layer.phase);
        }
      }
    }
    if (poison.current) {
      poison.current.visible = has("poisoned");
      if (poison.current.visible) {
        poison.current.rotation.y -= safeDt * 1.6;
        poison.current.position.y = headY - 0.35 + 0.06 * Math.sin(t * 3.2);
      }
    }
    if (bleed.current) {
      bleed.current.visible = has("bleeding");
      if (bleed.current.visible) {
        for (let i = 0; i < bleed.current.children.length; i++) {
          const d = bleed.current.children[i]!;
          const phase = i * 1.7;
          const cycle = (t * 0.55 + phase) % 0.55;
          d.position.y = -0.05 - cycle;
          const mat = bleedMats[i];
          if (mat) mat.opacity = 0.25 + 0.45 * (1 - cycle / 0.55);
        }
      }
    }
    if (slow.current) {
      slow.current.visible = has("slowed");
      if (slow.current.visible) {
        slow.current.rotation.y += safeDt * 0.9;
        slow.current.position.y = 0.12 + 0.03 * Math.sin(t * 2);
      }
    }
  });

  return (
    <group>
      {/* Stun — partial decentered arcs stacked as a mini tornado */}
      <group ref={stun} position={[0, headY, 0]} visible={false}>
        {stunLayers.map((layer, i) => (
          <group
            key={i}
            ref={(el) => {
              stunRings.current[i] = el;
            }}
            position={[0, layer.y, 0]}
          >
            {/* Offset mesh from pivot so spin orbits off-center */}
            <mesh
              position={[layer.pivot, 0, 0]}
              rotation={[Math.PI / 2 + layer.tilt, 0, layer.phase * 0.15]}
            >
              <torusGeometry args={[layer.radius, layer.tube, 6, 28, layer.arc]} />
              <primitive object={stunMats[i]!} attach="material" />
            </mesh>
          </group>
        ))}
      </group>

      {/* Poison — violet orbs orbiting upper torso */}
      <group ref={poison} position={[0, headY - 0.35, 0]} visible={false}>
        {[0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * 0.38, Math.sin(a * 2) * 0.08, Math.sin(a) * 0.38]}
            >
              <sphereGeometry args={[0.07, 8, 8]} />
              <primitive object={poisonMat} attach="material" />
            </mesh>
          );
        })}
      </group>

      {/* Bleed — red droplets falling from chest */}
      <group ref={bleed} position={[0, 1.35, 0.15]} visible={false}>
        {bleedMats.map((mat, i) => (
          <mesh key={i} position={[(i - 1.5) * 0.08, 0, (i % 2) * 0.05]}>
            <sphereGeometry args={[0.045, 6, 6]} />
            <primitive object={mat} attach="material" />
          </mesh>
        ))}
      </group>

      {/* Slow — icy ring around the feet */}
      <group ref={slow} position={[0, 0.12, 0]} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.55, 24]} />
          <primitive object={slowMat} attach="material" />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, Math.PI / 5]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.3, 0.38, 20]} />
          <primitive object={slowMat} attach="material" />
        </mesh>
      </group>
    </group>
  );
}
