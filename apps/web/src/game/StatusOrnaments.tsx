import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { STATUSES } from "@battlebeasts/shared";
import { createLightningBoltMaterial, tickLightningBolt } from "./vfx/materials/lightningBolt";
import { createCirclePointMaterial } from "./vfx/materials/circlePoint";
import { CounterStatusFx } from "./CounterStatusFx";
import { HandShieldFx } from "./HandShieldFx";
import { SoulMarkOrnament } from "./SoulMarkOrnament";
import { SoulRelayOrnament } from "./SoulRelayOrnament";

export type StatusRowLite = {
  statusId: string;
  stacks?: number;
};

type StatusMapLike = {
  forEach: (cb: (row: { statusId?: string; stacks?: number }) => void) => void;
} | null | undefined;

/** Shared empty list — avoid allocating when a unit has no statuses. */
const EMPTY_STATUS_ROWS: StatusRowLite[] = [];

/** Read active status rows from a Colyseus MapSchema-like object. */
export function collectStatusRows(map: StatusMapLike): StatusRowLite[] {
  if (!map) return EMPTY_STATUS_ROWS;
  const rows: StatusRowLite[] = [];
  map.forEach((row) => {
    if (row?.statusId && STATUSES[row.statusId]) {
      rows.push({ statusId: row.statusId, stacks: row.stacks ?? 1 });
    }
  });
  return rows.length === 0 ? EMPTY_STATUS_ROWS : rows;
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
  /** Character scene root — used for Counter second-skin glow. */
  characterRoot?: THREE.Object3D | null;
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
const POISON_WISP_COUNT = 6;
const WEAKEN_WISP_COUNT = 7;
const BURN_WISP_COUNT = 10;
/** Flat overlapping ovals that spin around chained feet. */
const CHAIN_OVAL_COUNT = 18;
/** Any DoT that should show the emanating poison cloud. */
const POISON_STATUS_IDS = new Set(["poisoned"]);
const BURN_STATUS_IDS = new Set(["burning"]);
const WEAKEN_STATUS_IDS = new Set(["weakened"]);

/**
 * World-space malus ornaments over a unit (stun tornado, poison, bleed, slow)
 * plus Surge lightning / Counter glow while buffed.
 */
export function StatusOrnaments({ getStatuses, headY = 2.15, characterRoot = null }: Props) {
  const stun = useRef<THREE.Group>(null);
  const stunRings = useRef<(THREE.Group | null)[]>([null, null, null]);
  const poison = useRef<THREE.Group>(null);
  const poisonPoints = useRef<THREE.Points>(null);
  const weaken = useRef<THREE.Group>(null);
  const weakenPoints = useRef<THREE.Points>(null);
  const burn = useRef<THREE.Group>(null);
  const burnWisps = useRef<(THREE.Mesh | null)[]>([]);
  const bleed = useRef<THREE.Group>(null);
  const soulSever = useRef<THREE.Group>(null);
  const slow = useRef<THREE.Group>(null);
  const rooted = useRef<THREE.Group>(null);
  const rootShards = useRef<(THREE.Mesh | null)[]>([]);
  /** 0 = faded out, 1 = fully visible (frost ice spikes). */
  const rootReveal = useRef(0);
  const chained = useRef<THREE.Group>(null);
  const chainLift = useRef<THREE.Group>(null);
  const chainOvals = useRef<(THREE.Mesh | null)[]>([]);
  /** 0 = faded out, 1 = fully visible (chain ground rings). */
  const chainReveal = useRef(0);
  const surge = useRef<THREE.Group>(null);
  const bolts = useRef<(THREE.Mesh | null)[]>([]);

  const stunMats = useMemo(
    () => [basicMat("#ffffff", 0.8), basicMat("#f8fafc", 0.65), basicMat("#e2e8f0", 0.5)] as const,
    [],
  );
  const poisonPositions = useMemo(() => new Float32Array(POISON_WISP_COUNT * 3), []);
  const poisonSizes = useMemo(() => new Float32Array(POISON_WISP_COUNT), []);
  const poisonAlphas = useMemo(() => new Float32Array(POISON_WISP_COUNT), []);
  const poisonGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(poisonPositions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(poisonSizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(poisonAlphas, 1));
    return geo;
  }, [poisonPositions, poisonSizes, poisonAlphas]);
  /** Same Points + circle.png path as dart bursts — not SpriteMaterial (that hung the tab). */
  const poisonPointMat = useMemo(() => createCirclePointMaterial("#4ade80"), []);
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

  const weakenPositions = useMemo(() => new Float32Array(WEAKEN_WISP_COUNT * 3), []);
  const weakenSizes = useMemo(() => new Float32Array(WEAKEN_WISP_COUNT), []);
  const weakenAlphas = useMemo(() => new Float32Array(WEAKEN_WISP_COUNT), []);
  const weakenGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(weakenPositions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(weakenSizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(weakenAlphas, 1));
    return geo;
  }, [weakenPositions, weakenSizes, weakenAlphas]);
  const weakenPointMat = useMemo(() => createCirclePointMaterial("#94a3b8"), []);
  const weakenCoreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#334155",
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const weakenRingMat = useMemo(() => basicMat("#94a3b8", 0.45), []);

  useEffect(() => {
    return () => {
      poisonGeo.dispose();
      poisonPointMat.dispose();
      weakenGeo.dispose();
      weakenPointMat.dispose();
    };
  }, [poisonGeo, poisonPointMat, weakenGeo, weakenPointMat]);
  const burnMats = useMemo(
    () =>
      Array.from({ length: BURN_WISP_COUNT }, (_, i) =>
        new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? "#fff7ed" : i % 3 === 1 ? "#fb923c" : "#ea580c",
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      ),
    [],
  );
  const burnCoreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#7c2d12",
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const bleedMats = useMemo(() => [0, 1, 2, 3].map(() => basicMat("#f87171", 0.65)), []);
  const soulSeverMats = useMemo(
    () => [0, 1, 2, 3, 4].map(() => basicMat("#EF4444", 0.55)),
    [],
  );
  const slowMat = useMemo(() => basicMat("#93c5fd", 0.5), []);
  const rootIceMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#0c4a6e",
        emissive: "#7dd3fc",
        emissiveIntensity: 0.55,
        roughness: 0.35,
        metalness: 0.15,
        transparent: true,
        opacity: 0.92,
      }),
    [],
  );
  const rootGlowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#e0f2fe",
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const chainOvalMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#6b6b74",
        metalness: 0.78,
        roughness: 0.4,
        emissive: "#2f2f36",
        emissiveIntensity: 0.2,
        transparent: true,
        opacity: 1,
      }),
    [],
  );
  const chainGlowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#a1a1aa",
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
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

  const weakenWispSpecs = useMemo(
    () =>
      Array.from({ length: WEAKEN_WISP_COUNT }, (_, i) => {
        const a = (i / WEAKEN_WISP_COUNT) * Math.PI * 2 + 0.15;
        return {
          ang: a,
          radius: 0.24 + (i % 4) * 0.06,
          baseY: 0.48 + (i % 3) * 0.16,
          rise: 0.48 + (i % 5) * 0.1,
          size: 0.048 + (i % 3) * 0.02,
          speed: 0.4 + (i % 4) * 0.1,
          phase: i * 0.67,
          spin: 0.5 + (i % 3) * 0.28,
        };
      }),
    [],
  );

  const burnWispSpecs = useMemo(
    () =>
      Array.from({ length: BURN_WISP_COUNT }, (_, i) => {
        const a = (i / BURN_WISP_COUNT) * Math.PI * 2 + 0.2;
        return {
          ang: a,
          radius: 0.2 + (i % 4) * 0.065,
          baseY: 0.5 + (i % 3) * 0.16,
          rise: 0.6 + (i % 5) * 0.14,
          size: 0.045 + (i % 3) * 0.022,
          speed: 0.55 + (i % 4) * 0.14,
          phase: i * 0.81,
          spin: 0.75 + (i % 3) * 0.4,
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
    const t = clock.elapsedTime;
    const safeDt = Math.min(0.05, dt);
    const has = (id: string) => rows.some((r) => r.statusId === id);

    // Frost / chain fades always tick — even when that status was the last
    // (otherwise rows.length===0 returns early and snaps the VFX off).
    const revealSpeed = 5;
    if (rooted.current) {
      const wantRoot = has("rooted");
      rootReveal.current = THREE.MathUtils.clamp(
        rootReveal.current + (wantRoot ? 1 : -1) * safeDt * revealSpeed,
        0,
        1,
      );
      const p = rootReveal.current;
      const eased = p * p * (3 - 2 * p);
      rooted.current.visible = p > 0.001;
      rootIceMat.opacity = 0.92 * eased;
      rootGlowMat.opacity = (0.28 + 0.15 * (0.5 + 0.5 * Math.sin(t * 3.2))) * eased;
      if (p > 0.001) {
        for (let i = 0; i < rootShards.current.length; i++) {
          const mesh = rootShards.current[i];
          if (!mesh) continue;
          const pulse = 0.85 + 0.15 * Math.sin(t * 5 + i);
          mesh.scale.y = pulse;
        }
        rootIceMat.emissiveIntensity = (0.4 + 0.25 * (0.5 + 0.5 * Math.sin(t * 4))) * eased;
      }
    }
    if (chained.current && chainLift.current) {
      const wantChain = has("chained");
      chainReveal.current = THREE.MathUtils.clamp(
        chainReveal.current + (wantChain ? 1 : -1) * safeDt * revealSpeed,
        0,
        1,
      );
      const p = chainReveal.current;
      const eased = p * p * (3 - 2 * p);
      chained.current.visible = p > 0.001;
      chainLift.current.position.y = 0.03;
      chainOvalMat.opacity = eased;
      chainGlowMat.opacity = (0.2 + 0.1 * (0.5 + 0.5 * Math.sin(t * 3.2))) * eased;
      if (p > 0.001) {
        chained.current.rotation.y += safeDt * 2.4;
        chainOvalMat.emissiveIntensity = (0.18 + 0.12 * (0.5 + 0.5 * Math.sin(t * 4))) * eased;
        for (let i = 0; i < chainOvals.current.length; i++) {
          const mesh = chainOvals.current[i];
          if (!mesh) continue;
          mesh.position.y = 0.04 + 0.01 * Math.sin(t * 5 + i * 0.7);
        }
      }
    }

    if (rows.length === 0) {
      if (stun.current) stun.current.visible = false;
      if (poison.current) poison.current.visible = false;
      if (weaken.current) weaken.current.visible = false;
      if (burn.current) burn.current.visible = false;
      if (bleed.current) bleed.current.visible = false;
      if (soulSever.current) soulSever.current.visible = false;
      if (slow.current) slow.current.visible = false;
      if (surge.current) surge.current.visible = false;
      moveSeeded.current = false;
      trailDir.current.x = 0;
      trailDir.current.z = -1;
      return;
    }

    const poisoned = rows.some((r) => POISON_STATUS_IDS.has(r.statusId));
    const weakened = rows.some((r) => WEAKEN_STATUS_IDS.has(r.statusId));
    const burning = rows.some((r) => BURN_STATUS_IDS.has(r.statusId));

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
        for (let i = 0; i < POISON_WISP_COUNT; i++) {
          const spec = wispSpecs[i]!;
          const cycle = (t * spec.speed + spec.phase) % 1;
          const ang = spec.ang + t * spec.spin;
          const y = spec.baseY + cycle * spec.rise;
          const outward = 0.85 + cycle * 0.55;
          poisonPositions[i * 3] = Math.cos(ang) * spec.radius * outward;
          poisonPositions[i * 3 + 1] = y;
          poisonPositions[i * 3 + 2] = Math.sin(ang) * spec.radius * outward;
          const fade = cycle < 0.15 ? cycle / 0.15 : cycle > 0.55 ? 1 - (cycle - 0.55) / 0.45 : 1;
          // Size into the same distance formula as AdditiveParticleBurst (×40)
          poisonSizes[i] = spec.size * (0.7 + cycle * 1.1) * 36;
          poisonAlphas[i] = Math.max(0, fade) * (0.35 + (i % 3) * 0.08);
        }
        poisonGeo.attributes.position!.needsUpdate = true;
        poisonGeo.attributes.aSize!.needsUpdate = true;
        poisonGeo.attributes.aAlpha!.needsUpdate = true;
        poisonCoreMat.opacity = 0.18 + 0.1 * (0.5 + 0.5 * Math.sin(t * 4.2));
      }
    }
    if (weaken.current) {
      weaken.current.visible = weakened;
      if (weakened) {
        for (let i = 0; i < WEAKEN_WISP_COUNT; i++) {
          const spec = weakenWispSpecs[i]!;
          const cycle = (t * spec.speed + spec.phase) % 1;
          const ang = spec.ang + t * spec.spin;
          const y = spec.baseY + cycle * spec.rise;
          const outward = 0.9 + cycle * 0.5;
          weakenPositions[i * 3] = Math.cos(ang) * spec.radius * outward;
          weakenPositions[i * 3 + 1] = y;
          weakenPositions[i * 3 + 2] = Math.sin(ang) * spec.radius * outward;
          const fade = cycle < 0.15 ? cycle / 0.15 : cycle > 0.55 ? 1 - (cycle - 0.55) / 0.45 : 1;
          weakenSizes[i] = spec.size * (0.75 + cycle * 1.05) * 36;
          weakenAlphas[i] = Math.max(0, fade) * (0.4 + (i % 3) * 0.07);
        }
        weakenGeo.attributes.position!.needsUpdate = true;
        weakenGeo.attributes.aSize!.needsUpdate = true;
        weakenGeo.attributes.aAlpha!.needsUpdate = true;
        weakenCoreMat.opacity = 0.22 + 0.1 * (0.5 + 0.5 * Math.sin(t * 3.6));
        weaken.current.rotation.y = t * 0.55;
      }
    }
    if (burn.current) {
      burn.current.visible = burning;
      if (burning) {
        for (let i = 0; i < burnWisps.current.length; i++) {
          const mesh = burnWisps.current[i];
          const spec = burnWispSpecs[i];
          const mat = burnMats[i];
          if (!mesh || !spec || !mat) continue;
          const cycle = (t * spec.speed + spec.phase) % 1;
          const ang = spec.ang + t * spec.spin;
          const y = spec.baseY + cycle * spec.rise;
          const outward = 0.8 + cycle * 0.5;
          mesh.position.set(
            Math.cos(ang) * spec.radius * outward,
            y,
            Math.sin(ang) * spec.radius * outward,
          );
          const s = spec.size * (0.65 + cycle * 1.2);
          mesh.scale.setScalar(s);
          const fade = cycle < 0.12 ? cycle / 0.12 : cycle > 0.5 ? 1 - (cycle - 0.5) / 0.5 : 1;
          mat.opacity = Math.max(0, fade) * (0.28 + (i % 3) * 0.07);
        }
        burnCoreMat.opacity = 0.16 + 0.12 * (0.5 + 0.5 * Math.sin(t * 5.1));
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
    if (soulSever.current) {
      soulSever.current.visible = has("soulSevered");
      if (soulSever.current.visible) {
        for (let i = 0; i < soulSever.current.children.length; i++) {
          const d = soulSever.current.children[i]!;
          const phase = i * 1.35;
          const cycle = (t * 0.7 + phase) % 0.7;
          d.position.y = -0.02 - cycle * 1.05;
          const mat = soulSeverMats[i];
          if (mat) mat.opacity = 0.2 + 0.5 * (1 - cycle / 0.7);
        }
      }
    }
    if (slow.current) {
      slow.current.visible = has("slowed") || has("frostChill") || has("poisonMiasma");
      if (slow.current.visible) {
        slow.current.rotation.y += safeDt * 0.9;
        slow.current.position.y = 0.12 + 0.03 * Math.sin(t * 2);
        const chillStacks = rows.find((r) => r.statusId === "frostChill")?.stacks ?? 0;
        slowMat.opacity = 0.32 + Math.min(10, chillStacks) * 0.05;
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
      trailDir.current.x = 0;
      trailDir.current.z = -1;
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
        <points
          ref={poisonPoints}
          geometry={poisonGeo}
          material={poisonPointMat}
          frustumCulled={false}
        />
      </group>

      <group ref={weaken} visible={false}>
        <mesh position={[0, 0.95, 0]} scale={[0.48, 0.72, 0.4]}>
          <sphereGeometry args={[0.55, 10, 10]} />
          <primitive object={weakenCoreMat} attach="material" />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
          <ringGeometry args={[0.38, 0.52, 28]} />
          <primitive object={weakenRingMat} attach="material" />
        </mesh>
        <points
          ref={weakenPoints}
          geometry={weakenGeo}
          material={weakenPointMat}
          frustumCulled={false}
        />
      </group>

      <group ref={burn} visible={false}>
        <mesh position={[0, 1.0, 0]} scale={[0.5, 0.8, 0.42]}>
          <sphereGeometry args={[0.55, 10, 10]} />
          <primitive object={burnCoreMat} attach="material" />
        </mesh>
        {burnMats.map((mat, i) => (
          <mesh
            key={`burn-${i}`}
            ref={(el) => {
              burnWisps.current[i] = el;
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

      {/* Soul Sever — violet soul-bleed drips while imprint is active. */}
      <group ref={soulSever} position={[0, 1.4, 0.12]} visible={false}>
        {soulSeverMats.map((mat, i) => (
          <mesh key={i} position={[(i - 2) * 0.07, 0, (i % 2) * 0.06]}>
            <sphereGeometry args={[0.038, 6, 6]} />
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

      {/* Frost Mist — ice spikes around the feet */}
      <group ref={rooted} position={[0, 0.02, 0]} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[0.22, 0.42, 20]} />
          <primitive object={rootGlowMat} attach="material" />
        </mesh>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const a = (i / 8) * Math.PI * 2 + 0.12;
          const h = 0.72 + (i % 3) * 0.12;
          const lean = 0.18 + (i % 2) * 0.08;
          return (
            <mesh
              key={`outer-${i}`}
              ref={(el) => {
                rootShards.current[i] = el;
              }}
              material={rootIceMat}
              position={[Math.cos(a) * 0.34, h * 0.48, Math.sin(a) * 0.34]}
              rotation={[lean, a + Math.PI / 2, i % 2 === 0 ? 0.08 : -0.1]}
            >
              <coneGeometry args={[0.038, h, 3]} />
            </mesh>
          );
        })}
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2 + 0.4;
          const h = 0.42 + (i % 2) * 0.1;
          const idx = 8 + i;
          return (
            <mesh
              key={`inner-${i}`}
              ref={(el) => {
                rootShards.current[idx] = el;
              }}
              material={rootIceMat}
              position={[Math.cos(a) * 0.18, h * 0.45, Math.sin(a) * 0.18]}
              rotation={[0.55, a, 0.2]}
            >
              <coneGeometry args={[0.028, h, 3]} />
            </mesh>
          );
        })}
      </group>

      {/* Chain Jump — spinning ground chain links */}
      <group ref={chained} position={[0, 0, 0]} visible={false}>
        <group ref={chainLift} position={[0, 0.03, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
            <ringGeometry args={[0.28, 0.52, 24]} />
            <primitive object={chainGlowMat} attach="material" />
          </mesh>
          {Array.from({ length: CHAIN_OVAL_COUNT }, (_, i) => {
            const a = (i / CHAIN_OVAL_COUNT) * Math.PI * 2;
            const r = 0.38;
            return (
              <mesh
                key={`oval-${i}`}
                ref={(el) => {
                  chainOvals.current[i] = el;
                }}
                material={chainOvalMat}
                position={[Math.cos(a) * r, 0.04, Math.sin(a) * r]}
                rotation={[-Math.PI / 2, 0, a + Math.PI / 2]}
                scale={[1.55, 0.88, 1]}
              >
                <torusGeometry args={[0.048, 0.013, 5, 14]} />
              </mesh>
            );
          })}
        </group>
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

      <CounterStatusFx characterRoot={characterRoot} getStatuses={getStatuses} />
      <HandShieldFx characterRoot={characterRoot} getStatuses={getStatuses} />
      <SoulRelayOrnament
        getActive={() => getStatuses().some((r) => r.statusId === "soulRelayLinked")}
      />
      <SoulMarkOrnament
        getStacks={() => {
          let max = 0;
          for (const r of getStatuses()) {
            if (r.statusId === "soulMarked") max = Math.max(max, r.stacks ?? 1);
          }
          return max;
        }}
      />
    </group>
  );
}
