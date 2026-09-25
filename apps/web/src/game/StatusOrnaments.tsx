import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createLightningBoltMaterial, tickLightningBolt } from "./vfx/materials/lightningBolt";
import { createCirclePointMaterial } from "./vfx/materials/circlePoint";
import {
  createLabGroundMarkMaterial,
  tickLabGroundMark,
} from "./vfx/engine/labShapeMaterials";
import { CounterStatusFx } from "./CounterStatusFx";
import { HandShieldFx } from "./HandShieldFx";
import { HexAnchorOrnament } from "./HexAnchorOrnament";
import { BindingRootedOrnament } from "./BindingRootedOrnament";
import { SpellbreakerOrbOrnament } from "./SpellbreakerOrbOrnament";
import { SoulMarkOrnament } from "./SoulMarkOrnament";
import { RejuvenationOrnament } from "./RejuvenationOrnament";
import { PoisonOrnament } from "./PoisonOrnament";
import { SoulRelayOrnament } from "./SoulRelayOrnament";
import { BloodPactOrnament } from "./BloodPactOrnament";
import { StatusAuraFx } from "./vfx/StatusAuraFx";
import { STATUSES } from "@battlebeasts/shared";
import { type StatusRowLite } from "./statusBadgeUtils";

type Props = {
  /** Polled each frame — keep allocation light. */
  getStatuses: () => StatusRowLite[];
  /** Height of ornaments above character origin (feet). */
  headY?: number;
  /** Character scene root — used for Counter second-skin glow. */
  characterRoot?: THREE.Object3D | null;
  /** The local player's own body: status auras skip distance gating and show self-only FX. */
  local?: boolean;
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
/** Flat overlapping ovals that spin around chained feet. */
const CHAIN_OVAL_COUNT = 18;

const _tempQuat = new THREE.Quaternion();
const _tempEuler = new THREE.Euler(0, 0, 0, "YXZ");

function buildExposedChevronsGeo(): THREE.BufferGeometry {
  const angles = [-0.46, 0, 0.46]; // Radians across the 90° (-0.785 to +0.785) sector
  const rIn = 0.58;
  const rOut = 0.70;
  const rNotch = 0.65;
  const halfSpread = 0.07;
  const positions: number[] = [];

  for (const a of angles) {
    const tx = rIn * Math.sin(a);
    const tz = rIn * Math.cos(a);

    const lx = rOut * Math.sin(a - halfSpread);
    const lz = rOut * Math.cos(a - halfSpread);

    const rx = rOut * Math.sin(a + halfSpread);
    const rz = rOut * Math.cos(a + halfSpread);

    const nx = rNotch * Math.sin(a);
    const nz = rNotch * Math.cos(a);

    // Triangle 1: (Tip, Left, Notch)
    positions.push(tx, 0, tz);
    positions.push(lx, 0, lz);
    positions.push(nx, 0, nz);

    // Triangle 2: (Tip, Notch, Right)
    positions.push(tx, 0, tz);
    positions.push(nx, 0, nz);
    positions.push(rx, 0, rz);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * World-space malus ornaments over a unit (stun tornado, poison, bleed, slow)
 * plus Surge lightning / Counter glow while buffed.
 */
export function StatusOrnaments({
  getStatuses,
  headY = 2.15,
  characterRoot = null,
  local = false,
}: Props) {
  const stun = useRef<THREE.Group>(null);
  const stunRings = useRef<(THREE.Group | null)[]>([null, null, null]);
  const fearGroup = useRef<THREE.Group>(null);
  const fearOrbs = useRef<(THREE.Mesh | null)[]>([null, null, null]);
  const fearAuras = useRef<(THREE.Mesh | null)[]>([null, null, null]);
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
  const shockedGroup = useRef<THREE.Group>(null);
  const shockedMark = useRef<THREE.Mesh>(null);
  const exposedAngleGroup = useRef<THREE.Group>(null);
  const exposedReveal = useRef(0);
  const lastExposedAngle = useRef(0);

  const stunMats = useMemo(
    () => [basicMat("#ffffff", 0.8), basicMat("#f8fafc", 0.65), basicMat("#e2e8f0", 0.5)] as const,
    [],
  );

  const fearOrbMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#18042b",
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    [],
  );
  const fearAuraMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#c084fc",
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const FEAR_WISP_COUNT = 15;
  const fearPositions = useMemo(() => new Float32Array(FEAR_WISP_COUNT * 3), []);
  const fearSizes = useMemo(() => new Float32Array(FEAR_WISP_COUNT), []);
  const fearAlphas = useMemo(() => new Float32Array(FEAR_WISP_COUNT), []);
  const fearGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(fearPositions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(fearSizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(fearAlphas, 1));
    return geo;
  }, [fearPositions, fearSizes, fearAlphas]);
  const fearPointMat = useMemo(() => createCirclePointMaterial("#a855f7"), []);
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

  const SHOCK_GROUND_SIZE = 0.85;
  const shockedGroundMat = useMemo(
    () =>
      createLabGroundMarkMaterial(
        "arc",
        { hot: "#e0f2fe", mid: "#38bdf8", edge: "#0c4a6e" },
        { opacity: 0.9, additive: true },
      ),
    [],
  );

  const exposedArcBandGeo = useMemo(
    () => new THREE.RingGeometry(0.48, 0.64, 36, 1, -Math.PI * 0.75, Math.PI * 0.5),
    [],
  );
  const exposedArcCoreGeo = useMemo(
    () => new THREE.RingGeometry(0.535, 0.565, 36, 1, -Math.PI * 0.75, Math.PI * 0.5),
    [],
  );
  const exposedLightSpillGeo = useMemo(
    () => new THREE.RingGeometry(0.22, 0.76, 36, 1, -Math.PI * 0.75, Math.PI * 0.5),
    [],
  );
  const exposedChevronsGeo = useMemo(() => buildExposedChevronsGeo(), []);

  const exposedBandMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#f97316",
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const exposedCoreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#fef08a",
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const exposedSpillMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ea580c",
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const exposedChevronMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#fdba74",
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      stunMats.forEach((m) => m.dispose());
      fearOrbMat.dispose();
      fearAuraMat.dispose();
      fearGeo.dispose();
      fearPointMat.dispose();
      slowMat.dispose();
      rootIceMat.dispose();
      rootGlowMat.dispose();
      chainOvalMat.dispose();
      chainGlowMat.dispose();
      boltMats.forEach((m) => m.dispose());
      shockedGroundMat.dispose();
      exposedArcBandGeo.dispose();
      exposedArcCoreGeo.dispose();
      exposedLightSpillGeo.dispose();
      exposedChevronsGeo.dispose();
      exposedBandMat.dispose();
      exposedCoreMat.dispose();
      exposedSpillMat.dispose();
      exposedChevronMat.dispose();
    };
  }, [
    stunMats,
    fearOrbMat,
    fearAuraMat,
    fearGeo,
    fearPointMat,
    slowMat,
    rootIceMat,
    rootGlowMat,
    chainOvalMat,
    chainGlowMat,
    boltMats,
    shockedGroundMat,
    exposedArcBandGeo,
    exposedArcCoreGeo,
    exposedLightSpillGeo,
    exposedChevronsGeo,
    exposedBandMat,
    exposedCoreMat,
    exposedSpillMat,
    exposedChevronMat,
  ]);

  const stunLayers = useMemo(
    () =>
      [
        { radius: 0.07, tube: 0.012, y: 0.14, arc: Math.PI * 2, pivot: 0.02, speed: 5.4, phase: 0.2, tilt: 0.28 },
        { radius: 0.105, tube: 0.014, y: 0.075, arc: Math.PI * 2, pivot: 0.028, speed: -3.7, phase: 1.9, tilt: 0.18 },
        { radius: 0.145, tube: 0.015, y: 0.015, arc: Math.PI * 2, pivot: 0.035, speed: 2.6, phase: 3.7, tilt: 0.12 },
      ] as const,
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
      if (fearGroup.current) fearGroup.current.visible = false;
      if (slow.current) slow.current.visible = false;
      if (surge.current) surge.current.visible = false;
      if (shockedGroup.current) shockedGroup.current.visible = false;
      if (shockedMark.current) shockedMark.current.visible = false;
      shockedGroundMat.uniforms.uOpacity!.value = 0;
      if (exposedAngleGroup.current) exposedAngleGroup.current.visible = false;
      exposedReveal.current = 0;
      exposedBandMat.opacity = 0;
      exposedCoreMat.opacity = 0;
      exposedSpillMat.opacity = 0;
      exposedChevronMat.opacity = 0;
      moveSeeded.current = false;
      trailDir.current.x = 0;
      trailDir.current.z = -1;
      for (const m of bolts.current) {
        if (m) m.visible = false;
      }
      return;
    }

    const feared = has("feared");

    if (fearGroup.current) {
      fearGroup.current.visible = feared;
      if (feared) {
        fearGroup.current.position.y = headY + 0.12 + 0.03 * Math.sin(t * 5.0);
        const orbitR = 0.34;
        for (let i = 0; i < 3; i++) {
          const ang = t * 6.2 + (i * Math.PI * 2) / 3;
          const ox = Math.cos(ang) * orbitR;
          const oz = Math.sin(ang) * orbitR;
          const oy = 0.06 * Math.sin(t * 8.0 + i * 2.1);
          const oMesh = fearOrbs.current[i];
          if (oMesh) {
            oMesh.position.set(ox, oy, oz);
          }
          const aMesh = fearAuras.current[i];
          if (aMesh) {
            aMesh.position.set(ox, oy, oz);
            const pulse = 1.0 + 0.18 * Math.sin(t * 10.0 + i);
            aMesh.scale.setScalar(pulse);
          }
        }
        for (let j = 0; j < FEAR_WISP_COUNT; j++) {
          const orbIdx = j % 3;
          const ang = t * 6.2 + (orbIdx * Math.PI * 2) / 3 - (Math.floor(j / 3) + 1) * 0.18;
          const trailR = orbitR * (0.95 - (j / FEAR_WISP_COUNT) * 0.2);
          fearPositions[j * 3] = Math.cos(ang) * trailR;
          fearPositions[j * 3 + 1] = 0.05 * Math.sin(t * 8.0 + orbIdx * 2.1) + ((j % 4) - 1.5) * 0.03;
          fearPositions[j * 3 + 2] = Math.sin(ang) * trailR;
          fearSizes[j] = 0.14 * (1.0 - (j / FEAR_WISP_COUNT) * 0.45) * 28;
          fearAlphas[j] = 0.75 * (1.0 - (j / FEAR_WISP_COUNT) * 0.55);
        }
        fearGeo.attributes.position!.needsUpdate = true;
        fearGeo.attributes.aSize!.needsUpdate = true;
        fearGeo.attributes.aAlpha!.needsUpdate = true;
      }
    }

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
    if (slow.current) {
      // Shocked uses the lab ground mark — don't stack the old slow ring circles.
      const wantSlowRings =
        (has("slowed") || has("frostChill") || has("poisonMiasma") || has("gravityFieldSlow")) &&
        !has("shocked");
      slow.current.visible = wantSlowRings;
      if (wantSlowRings) {
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

    const nowMs = Date.now();
    const shockRow = rows.find((r) => {
      if (r.statusId !== "shocked") return false;
      if (typeof r.expiresAt === "number" && r.expiresAt > 0 && nowMs >= r.expiresAt) return false;
      return true;
    });
    const shockStacks = shockRow ? Math.max(1, Math.floor(Number(shockRow.stacks) || 1)) : 0;
    const wantShock = shockStacks > 0;
    if (shockedGroup.current) shockedGroup.current.visible = wantShock;
    if (shockedMark.current) shockedMark.current.visible = wantShock;
    if (wantShock) {
      tickLabGroundMark(shockedGroundMat, safeDt);
      const stack01 = Math.min(1, shockStacks / 3);
      const pulse = 0.72 + 0.28 * Math.sin(t * 5.2);
      shockedGroundMat.uniforms.uOpacity!.value = (0.55 + 0.35 * stack01) * pulse;
      const s = SHOCK_GROUND_SIZE * (0.92 + 0.08 * stack01);
      shockedMark.current?.scale.set(s, s, s);
    } else {
      shockedGroundMat.uniforms.uOpacity!.value = 0;
    }

    const exposed = rows.find((r) => r.statusId === "exposedAngle");
    const wantExposed = Boolean(exposed);
    exposedReveal.current = THREE.MathUtils.clamp(
      exposedReveal.current + (wantExposed ? 1 : -1) * safeDt * 7,
      0,
      1,
    );
    const expP = exposedReveal.current;
    if (exposedAngleGroup.current) {
      if (expP <= 0.001) {
        exposedAngleGroup.current.visible = false;
      } else {
        exposedAngleGroup.current.visible = true;
        if (exposed && typeof exposed.angle === "number") {
          lastExposedAngle.current = exposed.angle;
        }
        if (root.current) {
          root.current.getWorldQuaternion(_tempQuat);
          _tempEuler.setFromQuaternion(_tempQuat);
          exposedAngleGroup.current.rotation.y = lastExposedAngle.current - _tempEuler.y;
        }
        const pulse = 0.82 + 0.18 * Math.sin(t * 4.8);
        const breath = 1.0 + 0.025 * Math.sin(t * 3.2);
        exposedBandMat.opacity = 0.75 * expP * pulse;
        exposedCoreMat.opacity = 0.95 * expP * pulse;
        exposedSpillMat.opacity = 0.28 * expP * pulse;
        exposedChevronMat.opacity = 0.92 * expP * (0.65 + 0.35 * Math.sin(t * 5.5));
        exposedAngleGroup.current.scale.set(breath, 1, breath);
      }
    }
  });

  return (
    <group ref={root}>
      {/* Feared: 3 orbiting shadowballs above the head with luminous aura and wisps */}
      <group ref={fearGroup} position={[0, headY, 0]} visible={false}>
        {[0, 1, 2].map((i) => (
          <group key={i}>
            <mesh
              ref={(el) => {
                fearOrbs.current[i] = el;
              }}
            >
              <sphereGeometry args={[0.075, 12, 12]} />
              <primitive object={fearOrbMat} attach="material" />
            </mesh>
            <mesh
              ref={(el) => {
                fearAuras.current[i] = el;
              }}
            >
              <sphereGeometry args={[0.115, 12, 12]} />
              <primitive object={fearAuraMat} attach="material" />
            </mesh>
          </group>
        ))}
        <points geometry={fearGeo} material={fearPointMat} frustumCulled={false} />
      </group>

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

      {/* Burning / poisoned / bleeding / chilled / regen live on ParticleWorld. */}
      <StatusAuraFx getStatuses={getStatuses} local={local} />

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

      {/* Shocked — small lab lightning ground mark (no body bolts / tendrils) */}
      <group ref={shockedGroup} visible={false}>
        <mesh
          ref={shockedMark}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.04, 0]}
          scale={SHOCK_GROUND_SIZE}
          renderOrder={8}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1]} />
          <primitive object={shockedGroundMat} attach="material" />
        </mesh>
      </group>

      {/* Exposed Angle (DES_14) — illuminated 90° vulnerability light zone on ground circle */}
      <group ref={exposedAngleGroup} position={[0, 0.028, 0]} visible={false}>
        {/* Soft radial light spill / wash under the circle */}
        <mesh
          geometry={exposedLightSpillGeo}
          material={exposedSpillMat}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={3}
        />
        {/* Main glowing amber arc band along the ground circle */}
        <mesh
          geometry={exposedArcBandGeo}
          material={exposedBandMat}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.002, 0]}
          renderOrder={4}
        />
        {/* Bright incandescent hot core line */}
        <mesh
          geometry={exposedArcCoreGeo}
          material={exposedCoreMat}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.004, 0]}
          renderOrder={5}
        />
        {/* Inward-pointing vulnerability warning chevrons */}
        <mesh
          geometry={exposedChevronsGeo}
          material={exposedChevronMat}
          position={[0, 0.006, 0]}
          renderOrder={6}
        />
      </group>

      <CounterStatusFx characterRoot={characterRoot} getStatuses={getStatuses} />
      <HandShieldFx characterRoot={characterRoot} getStatuses={getStatuses} />
      <HexAnchorOrnament
        getActive={() => getStatuses().some((r) => r.statusId === "hexAnchored")}
      />
      <BindingRootedOrnament
        getActive={() => getStatuses().some((r) => r.statusId === "bindingRooted")}
      />
      <SpellbreakerOrbOrnament
        getActive={() => getStatuses().some((r) => r.statusId === "spellbreakerCharge")}
        getStacks={() => {
          for (const r of getStatuses()) {
            if (r.statusId === "spellbreakerCharge") return r.stacks ?? 1;
          }
          return 1;
        }}
      />
      <BloodPactOrnament
        getActive={() => getStatuses().some((r) => r.statusId === "bloodPactEmpower")}
      />
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
      <PoisonOrnament
        getStacks={() => {
          let max = 0;
          for (const r of getStatuses()) {
            if (r.statusId === "poisoned") max = Math.max(max, r.stacks ?? 1);
          }
          return max;
        }}
      />
      <RejuvenationOrnament
        getStacks={() => {
          let max = 0;
          for (const r of getStatuses()) {
            if (r.statusId === "rejuvenated" || r.statusId === "overflowingGraceHot") {
              max = Math.max(max, r.stacks ?? 1);
            }
          }
          return max;
        }}
      />
      <BuffAppearBurst getStatuses={getStatuses} y={headY * 0.55} />
    </group>
  );
}

/** Expanding ring when a buff status first lands — draws the eye to a new talent/spell buff. */
function BuffAppearBurst({
  getStatuses,
  y,
}: {
  getStatuses: () => StatusRowLite[];
  y: number;
}) {
  const ring = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#fde68a",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const seen = useRef(new Set<string>());
  const seeded = useRef(false);
  const age = useRef(-1);

  useFrame((_, dt) => {
    const rows = getStatuses();
    const buffIds: string[] = [];
    for (const row of rows) {
      const def = STATUSES[row.statusId];
      if (def?.polarity !== "buff") continue;
      if (row.statusId === "rejuvenated" || row.statusId === "overflowingGraceHot") continue;
      buffIds.push(row.statusId);
    }

    if (!seeded.current) {
      for (const id of buffIds) seen.current.add(id);
      seeded.current = true;
    } else {
      for (const id of buffIds) {
        if (!seen.current.has(id)) {
          seen.current.add(id);
          age.current = 0;
          const color = STATUSES[id]?.color;
          if (color) mat.color.set(color);
        }
      }
      for (const id of [...seen.current]) {
        if (!buffIds.includes(id)) seen.current.delete(id);
      }
    }

    const mesh = ring.current;
    if (!mesh) return;
    if (age.current < 0) {
      mesh.visible = false;
      return;
    }
    age.current += Math.min(0.05, Math.max(0, dt));
    const u = Math.min(1, age.current / 0.42);
    mesh.visible = u < 1;
    const s = 0.4 + u * 1.55;
    mesh.scale.set(s, s, s);
    mat.opacity = (1 - u) * (1 - u) * 0.9;
    if (u >= 1) age.current = -1;
  });

  return (
    <mesh ref={ring} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.38, 0.56, 28]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}
