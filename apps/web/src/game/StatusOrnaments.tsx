import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { STATUSES } from "@battlebeasts/shared";
import { createLightningBoltMaterial, tickLightningBolt } from "./vfx/materials/lightningBolt";

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

export function hasStatusId(map: StatusMapLike, statusId: string): boolean {
  if (!map) return false;
  let found = false;
  map.forEach((row) => {
    if (row?.statusId === statusId) found = true;
  });
  return found;
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

const BOLT_COUNT = 6;
const SURGE_COLOR = "#67e8f9";
const SURGE_HOT = "#fef08a";
const POISON_WISP_COUNT = 10;
/** Any DoT that should show the emanating poison cloud. */
const POISON_STATUS_IDS = new Set(["poisoned", "spikeVenom"]);

/**
 * World-space malus ornaments over a unit (stun tornado, poison, bleed, slow)
 * plus Surge lightning bolts while hasted.
 */
export function StatusOrnaments({ getStatuses, headY = 2.15 }: Props) {
  const stun = useRef<THREE.Group>(null);
  const stunRings = useRef<(THREE.Group | null)[]>([null, null, null]);
  const poison = useRef<THREE.Group>(null);
  const poisonWisps = useRef<(THREE.Mesh | null)[]>([]);
  const bleed = useRef<THREE.Group>(null);
  const slow = useRef<THREE.Group>(null);
  const surge = useRef<THREE.Group>(null);
  const bolts = useRef<(THREE.Mesh | null)[]>([]);

  const stunMats = useMemo(
    () => [basicMat("#ffffff", 0.8), basicMat("#f8fafc", 0.65), basicMat("#e2e8f0", 0.5)] as const,
    [],
  );
  const poisonMats = useMemo(
    () =>
      Array.from({ length: POISON_WISP_COUNT }, (_, i) =>
        new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? "#166534" : i % 3 === 1 ? "#14532d" : "#4ade80",
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      ),
    [],
  );
  const poisonCoreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#052e16",
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const bleedMats = useMemo(() => [0, 1, 2, 3].map(() => basicMat("#f87171", 0.65)), []);
  const slowMat = useMemo(() => basicMat("#93c5fd", 0.5), []);
  const boltMats = useMemo(
    () =>
      Array.from({ length: BOLT_COUNT }, (_, i) =>
        createLightningBoltMaterial(SURGE_COLOR, {
          hot: SURGE_HOT,
          opacity: 0.9,
          seed: 11 + i * 7.3,
        }),
      ),
    [],
  );

  const stunLayers = useMemo(
    () =>
      [
        { radius: 0.07, tube: 0.012, y: 0.14, arc: Math.PI * 2, pivot: 0.02, speed: 5.4, phase: 0.2, tilt: 0.28 },
        { radius: 0.105, tube: 0.014, y: 0.075, arc: Math.PI * 2, pivot: 0.028, speed: -3.7, phase: 1.9, tilt: 0.18 },
        { radius: 0.145, tube: 0.015, y: 0.015, arc: Math.PI * 2, pivot: 0.035, speed: 2.6, phase: 3.7, tilt: 0.12 },
      ] as const,
    [],
  );

  const wispSpecs = useMemo(
    () =>
      Array.from({ length: POISON_WISP_COUNT }, (_, i) => {
        const a = (i / POISON_WISP_COUNT) * Math.PI * 2;
        return {
          ang: a,
          radius: 0.22 + (i % 4) * 0.07,
          baseY: 0.55 + (i % 3) * 0.18,
          rise: 0.55 + (i % 5) * 0.12,
          size: 0.05 + (i % 3) * 0.025,
          speed: 0.45 + (i % 4) * 0.12,
          phase: i * 0.73,
          spin: 0.6 + (i % 3) * 0.35,
        };
      }),
    [],
  );

  const boltRefresh = useRef(0);
  const root = useRef<THREE.Group>(null);
  const worldPos = useRef(new THREE.Vector3());
  const prevWorld = useRef(new THREE.Vector3());
  const moveSeeded = useRef(false);
  /** Local XZ unit vector opposite travel (wake). Falls back to −Z when still. */
  const trailDir = useRef({ x: 0, z: -1 });

  useFrame(({ clock }, dt) => {
    const rows = getStatuses();
    const has = (id: string) => rows.some((r) => r.statusId === id);
    const poisoned = rows.some((r) => POISON_STATUS_IDS.has(r.statusId));
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
          g.position.y = layer.y + 0.006 * Math.sin(t * (2.1 + i * 1.3) + layer.phase);
        }
      }
    }
    if (poison.current) {
      poison.current.visible = poisoned;
      if (poisoned) {
        for (let i = 0; i < poisonWisps.current.length; i++) {
          const mesh = poisonWisps.current[i];
          const spec = wispSpecs[i];
          const mat = poisonMats[i];
          if (!mesh || !spec || !mat) continue;
          const cycle = (t * spec.speed + spec.phase) % 1;
          const ang = spec.ang + t * spec.spin;
          const y = spec.baseY + cycle * spec.rise;
          const outward = 0.85 + cycle * 0.55;
          mesh.position.set(
            Math.cos(ang) * spec.radius * outward,
            y,
            Math.sin(ang) * spec.radius * outward,
          );
          const s = spec.size * (0.7 + cycle * 1.1);
          mesh.scale.setScalar(s);
          // Fade in low, peak mid, dissolve as it drifts up
          const fade = cycle < 0.15 ? cycle / 0.15 : cycle > 0.55 ? 1 - (cycle - 0.55) / 0.45 : 1;
          mat.opacity = Math.max(0, fade) * (0.22 + (i % 3) * 0.06);
        }
        poisonCoreMat.opacity = 0.18 + 0.1 * (0.5 + 0.5 * Math.sin(t * 4.2));
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

    const surged = has("surged");
    if (surge.current) surge.current.visible = surged;

    if (surged && root.current) {
      for (const mat of boltMats) tickLightningBolt(mat, safeDt);

      // World motion → local XZ (parent body yaw), wake = opposite travel.
      root.current.getWorldPosition(worldPos.current);
      if (!moveSeeded.current) {
        prevWorld.current.copy(worldPos.current);
        moveSeeded.current = true;
      } else {
        const wdx = worldPos.current.x - prevWorld.current.x;
        const wdz = worldPos.current.z - prevWorld.current.z;
        prevWorld.current.copy(worldPos.current);
        const parent = root.current.parent;
        const yaw = parent?.rotation.y ?? 0;
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        // Inverse of yaw: world → local
        const lx = wdx * c - wdz * s;
        const lz = wdx * s + wdz * c;
        const spd = Math.hypot(lx, lz);
        if (spd > 0.0008) {
          trailDir.current.x = -lx / spd;
          trailDir.current.z = -lz / spd;
        }
      }

      boltRefresh.current -= safeDt;
      if (boltRefresh.current <= 0) {
        boltRefresh.current = 0.07 + Math.random() * 0.1;
        const tx = trailDir.current.x;
        const tz = trailDir.current.z;
        // Perpendicular in XZ for lateral scatter
        const px = -tz;
        const pz = tx;
        // Align bolt stroke (+X) with wake axis
        const boltYaw = Math.atan2(-tz, tx);

        for (let i = 0; i < bolts.current.length; i++) {
          const m = bolts.current[i];
          if (!m) continue;
          const row = i / Math.max(1, bolts.current.length - 1);
          const back = 0.12 + row * 0.45 + Math.random() * 0.05;
          const lateral = (Math.random() - 0.5) * (0.18 + row * 0.28);
          const h = 0.6 + Math.random() * 0.95 + row * 0.08;
          m.position.set(tx * back + px * lateral, h, tz * back + pz * lateral);
          m.rotation.set(
            (Math.random() - 0.5) * 0.18,
            boltYaw + (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.12,
          );
          const len = 0.42 + Math.random() * 0.4 + row * 0.1;
          const height = 0.09 + Math.random() * 0.05;
          m.scale.set(len, height, 1);
          m.visible = Math.random() > 0.15;
        }
      }
    } else {
      moveSeeded.current = false;
      trailDir.current = { x: 0, z: -1 };
      for (const m of bolts.current) {
        if (m) m.visible = false;
      }
    }
  });

  return (
    <group ref={root}>
      <group ref={stun} position={[0, headY, 0]} visible={false}>
        {stunLayers.map((layer, i) => (
          <group
            key={i}
            ref={(el) => {
              stunRings.current[i] = el;
            }}
            position={[0, layer.y, 0]}
          >
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

      <group ref={poison} visible={false}>
        {/* Soft torso haze */}
        <mesh position={[0, 1.05, 0]} scale={[0.55, 0.85, 0.45]}>
          <sphereGeometry args={[0.55, 10, 10]} />
          <primitive object={poisonCoreMat} attach="material" />
        </mesh>
        {poisonMats.map((mat, i) => (
          <mesh
            key={i}
            ref={(el) => {
              poisonWisps.current[i] = el;
            }}
          >
            <sphereGeometry args={[1, 6, 6]} />
            <primitive object={mat} attach="material" />
          </mesh>
        ))}
      </group>

      <group ref={bleed} position={[0, 1.35, 0.15]} visible={false}>
        {bleedMats.map((mat, i) => (
          <mesh key={i} position={[(i - 1.5) * 0.08, 0, (i % 2) * 0.05]}>
            <sphereGeometry args={[0.045, 6, 6]} />
            <primitive object={mat} attach="material" />
          </mesh>
        ))}
      </group>

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

      <group ref={surge} visible={false}>
        {boltMats.map((mat, i) => (
          <mesh
            key={`bolt-${i}`}
            ref={(el) => {
              bolts.current[i] = el;
            }}
            visible={false}
          >
            <planeGeometry args={[1, 1]} />
            <primitive object={mat} attach="material" />
          </mesh>
        ))}
      </group>
    </group>
  );
}
