import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MutableRefObject } from "react";
import * as THREE from "three";
import { castAimRuntime } from "../../castAimRuntime";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { useLabPreview } from "./labPreview";
import { ELEMENT_GALLERY, type ElementId } from "./elementGallery";
import {
  createLabBeamMaterial,
  createLabChargeOrbMaterial,
  createLabGroundMarkMaterial,
  createLabMeleeSlashMaterial,
  createLabOvalShieldMaterial,
  createLabShieldBillboardMaterial,
  tickLabBeamMaterial,
  tickLabChargeOrb,
  tickLabGroundMark,
  tickLabMeleeSlash,
  tickLabOvalShield,
  tickLabShieldBillboard,
  type LabGroundMode,
} from "./labShapeMaterials";
import {
  killLightningCluster,
  moveLightningCluster,
  setLightningSegment,
  spawnLightningCluster,
  spawnLightningSegment,
} from "./lightningArcs";
import { createIceShardGeometry } from "./iceCrystalGeometry";
import type { PatternId } from "../shaders/patternUrls";

export const SHAPE_COLORS: Record<
  ElementId,
  { hot: string; mid: string; edge: string }
> = {
  fire: { hot: "#fff7ed", mid: "#fb923c", edge: "#7c2d12" },
  frost: { hot: "#f0f9ff", mid: "#e0f2fe", edge: "#79b6dd" },
  poison: { hot: "#ecfccb", mid: "#84cc16", edge: "#3f6212" },
  lightning: { hot: "#93c5fd", mid: "#38bdf8", edge: "#1e3a5f" },
  void: { hot: "#7e22ce", mid: "#4c1d95", edge: "#0c0614" },
  wind: { hot: "#f8fafc", mid: "#94a3b8", edge: "#334155" },
  heal: { hot: "#a7f3d0", mid: "#6ee7b7", edge: "#14532d" },
  holy: { hot: "#fffbeb", mid: "#fef08a", edge: "#a16207" },
  blood: { hot: "#fecaca", mid: "#ef4444", edge: "#450a0a" },
};

const GROUND_LOOK: Record<
  ElementId,
  {
    mode: LabGroundMode;
    pattern?: PatternId;
    opacity?: number;
    additive?: boolean;
    /** Optional color override (e.g. snare violet for lightning field) */
    colors?: { hot: string; mid: string; edge: string };
  }
> = {
  fire: { mode: "scorch", pattern: "ridged-cracks", opacity: 1.05 },
  frost: { mode: "frost", additive: false, opacity: 0.95 },
  poison: { mode: "poison", opacity: 0.88 },
  lightning: {
    mode: "arc",
    opacity: 1.0,
    additive: true,
    // Storm-blue field (not snare violet)
    colors: { hot: "#e0f2fe", mid: "#38bdf8", edge: "#0c4a6e" },
  },
  void: { mode: "void", opacity: 0.95, additive: false },
  wind: { mode: "wind", opacity: 0.48 },
  heal: { mode: "spiral", opacity: 0.55 },
  holy: { mode: "sigil" },
  blood: { mode: "scorch", pattern: "dissolve-noise", opacity: 0.95 },
};

const HAND_Y = 1.15;
const SPAWN = 0.55;
const BEAM_LEN = 7.2;
const STATION_SPACING = 2.8;
const GROUND_R = 1.9;

type OriginRef = MutableRefObject<{ x: number; z: number; yaw?: number }>;

function StationLabel({ element, y }: { element: ElementId; y: number }) {
  return (
    <Html position={[0, y, 0]} center distanceFactor={16} style={{ pointerEvents: "none" }}>
      <div style={stationLabelStyle}>{element}</div>
    </Html>
  );
}

function stationXs(count: number, spacing: number): number[] {
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * spacing);
}

/**
 * Textured energy beam — sandbox core/shell/halo + flowing streaks + hand charge.
 */
function BeamStation({ element, x }: { element: ElementId; x: number }) {
  const c = SHAPE_COLORS[element];
  const coreMat = useMemo(
    () => createLabBeamMaterial("core", { hot: c.hot, mid: c.mid, halo: c.edge }),
    [c.hot, c.mid, c.edge],
  );
  const shellMat = useMemo(
    () => createLabBeamMaterial("shell", { hot: c.hot, mid: c.mid, halo: c.edge }),
    [c.hot, c.mid, c.edge],
  );
  const haloMat = useMemo(
    () => createLabBeamMaterial("halo", { hot: c.hot, mid: c.mid, halo: c.edge }),
    [c.hot, c.mid, c.edge],
  );
  const orbMat = useMemo(() => createLabChargeOrbMaterial(c.hot, c.mid), [c.hot, c.mid]);
  const core = useRef<THREE.Mesh>(null);
  const shell = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const orb = useRef<THREE.Mesh>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const ringC = useRef<THREE.Mesh>(null);
  // Independent shock pulses — random speed / phase / wait between launches
  const pulses = useRef([
    { u: Math.random(), speed: 0.9 + Math.random() * 1.1, wait: Math.random() * 0.4, size: 0.7 + Math.random() * 0.5 },
    { u: Math.random(), speed: 0.9 + Math.random() * 1.1, wait: 0.2 + Math.random() * 0.5, size: 0.7 + Math.random() * 0.5 },
    { u: Math.random(), speed: 0.9 + Math.random() * 1.1, wait: 0.4 + Math.random() * 0.6, size: 0.7 + Math.random() * 0.5 },
  ]);

  useFrame((_, dt) => {
    tickLabBeamMaterial(coreMat, dt);
    tickLabBeamMaterial(shellMat, dt);
    tickLabBeamMaterial(haloMat, dt);
    tickLabChargeOrb(orbMat, dt);
    const t = performance.now() * 0.001;
    // Soft irregular hand-orb breathe (not a locked metronome)
    const pulse =
      1 +
      0.03 * Math.sin(t * 9.3 + Math.sin(t * 2.1) * 1.7) +
      0.015 * Math.sin(t * 13.7);
    const cylLen = Math.max(0.05, BEAM_LEN - SPAWN);
    const midZ = SPAWN + cylLen * 0.5;
    if (core.current) {
      core.current.position.set(0, HAND_Y, midZ);
      core.current.scale.set(0.05 * pulse, cylLen, 0.05 * pulse);
    }
    if (shell.current) {
      shell.current.position.set(0, HAND_Y, midZ);
      shell.current.scale.set(0.12 * pulse, cylLen, 0.12 * pulse);
    }
    if (halo.current) {
      halo.current.position.set(0, HAND_Y, midZ);
      halo.current.scale.set(0.22 * pulse, cylLen, 0.22 * pulse);
    }
    if (orb.current) {
      const s = 0.15 + 0.035 * (0.5 + 0.5 * Math.sin(t * 6.2 + Math.sin(t * 1.7)));
      orb.current.scale.setScalar(s / 0.15);
    }

    const rings = [ringA.current, ringB.current, ringC.current];
    for (let i = 0; i < pulses.current.length; i++) {
      const p = pulses.current[i]!;
      const mesh = rings[i];
      if (!mesh) continue;
      if (p.wait > 0) {
        p.wait -= dt;
        mesh.visible = false;
        continue;
      }
      p.u += dt * p.speed;
      if (p.u >= 1) {
        p.u = 0;
        p.speed = 0.75 + Math.random() * 1.4;
        p.wait = 0.08 + Math.random() * 0.55;
        p.size = 0.55 + Math.random() * 0.7;
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      // Slight lateral jitter so discs aren't on a perfect rail
      const jx = (Math.sin(t * 7.3 + i * 4.1 + p.u * 9.0) * 0.04) * (1 - p.u);
      mesh.position.set(jx, HAND_Y, SPAWN + p.u * cylLen);
      const s = p.size * (0.65 + p.u * 0.7);
      mesh.scale.setScalar(s);
      (mesh.material as THREE.MeshBasicMaterial).opacity =
        0.5 * (1 - p.u) * (0.7 + 0.3 * Math.sin(p.u * 12 + i));
    }
  });

  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: c.hot,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [c.hot],
  );
  const ringMatB = useMemo(() => ringMat.clone(), [ringMat]);
  const ringMatC = useMemo(() => ringMat.clone(), [ringMat]);

  return (
    <group position={[x, 0, 0]}>
      <mesh ref={orb} position={[0, HAND_Y, SPAWN]} renderOrder={42}>
        <sphereGeometry args={[0.16, 20, 16]} />
        <primitive object={orbMat} attach="material" />
      </mesh>
      <mesh ref={core} rotation={[Math.PI / 2, 0, 0]} renderOrder={40}>
        <cylinderGeometry args={[1, 1, 1, 14, 1, true]} />
        <primitive object={coreMat} attach="material" />
      </mesh>
      <mesh ref={shell} rotation={[Math.PI / 2, 0, 0]} renderOrder={39}>
        <cylinderGeometry args={[1, 1, 1, 16, 1, true]} />
        <primitive object={shellMat} attach="material" />
      </mesh>
      <mesh ref={halo} rotation={[Math.PI / 2, 0, 0]} renderOrder={38}>
        <cylinderGeometry args={[1, 1, 1, 16, 1, true]} />
        <primitive object={haloMat} attach="material" />
      </mesh>
      <mesh ref={ringA} rotation={[Math.PI / 2, 0, 0]} renderOrder={41} visible={false}>
        <ringGeometry args={[0.1, 0.18, 24]} />
        <primitive object={ringMat} attach="material" />
      </mesh>
      <mesh ref={ringB} rotation={[Math.PI / 2, 0, 0]} renderOrder={41} visible={false}>
        <ringGeometry args={[0.1, 0.16, 24]} />
        <primitive object={ringMatB} attach="material" />
      </mesh>
      <mesh ref={ringC} rotation={[Math.PI / 2, 0, 0]} renderOrder={41} visible={false}>
        <ringGeometry args={[0.08, 0.15, 24]} />
        <primitive object={ringMatC} attach="material" />
      </mesh>
      <StationLabel element={element} y={0.2} />
    </group>
  );
}

/**
 * Shield — camera-facing oval (readable top-down) + layered fresnel volume.
 * Dual shells + rim torus give depth; shaders carry energy crawl / sparks / outer glow.
 */
function ShieldStation({ element, x }: { element: ElementId; x: number }) {
  const c = SHAPE_COLORS[element];
  const billboardMat = useMemo(
    () => createLabShieldBillboardMaterial(c.mid, c.hot),
    [c.mid, c.hot],
  );
  const shellMat = useMemo(() => createLabOvalShieldMaterial(c.mid, c.hot), [c.mid, c.hot]);
  const shellOuterMat = useMemo(() => createLabOvalShieldMaterial(c.edge, c.mid), [c.edge, c.mid]);
  const glowMat = useMemo(() => createLabOvalShieldMaterial(c.mid, c.hot), [c.mid, c.hot]);
  const rimMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: c.hot,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [c.hot],
  );
  const billboard = useRef<THREE.Group>(null);
  const shell = useRef<THREE.Group>(null);
  const shellOuter = useRef<THREE.Mesh>(null);
  const shellGlow = useRef<THREE.Mesh>(null);
  const rim = useRef<THREE.Mesh>(null);
  const _camDir = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }, dt) => {
    tickLabShieldBillboard(billboardMat, dt);
    tickLabOvalShield(shellMat, dt);
    tickLabOvalShield(shellOuterMat, dt);
    tickLabOvalShield(glowMat, dt);

    camera.getWorldDirection(_camDir);
    const overhead = THREE.MathUtils.clamp(Math.abs(_camDir.y), 0, 1);
    const billboardW = THREE.MathUtils.smoothstep(overhead, 0.25, 0.7);
    const shellW = 1 - THREE.MathUtils.smoothstep(overhead, 0.35, 0.85);
    billboardMat.uniforms.uOpacity!.value = 0.25 + 0.7 * billboardW;
    shellMat.uniforms.uOpacity!.value = 0.18 + 0.5 * shellW;
    shellOuterMat.uniforms.uOpacity!.value = 0.08 + 0.28 * shellW;
    glowMat.uniforms.uOpacity!.value = 0.06 + 0.18 * shellW;
    rimMat.opacity = 0.12 + 0.35 * shellW;

    const t = performance.now() * 0.001;
    if (billboard.current) {
      billboard.current.quaternion.copy(camera.quaternion);
      // UV domain was widened for soft-edge fade (1.06→1.4, 0.88→1.15);
      // scale mesh by the same ratio so the oval stays the old world size.
      const px = 1 + 0.04 * Math.sin(t * 2.1);
      const py = 1 + 0.045 * Math.sin(t * 1.7 + 0.8);
      billboard.current.scale.set(2.17 * px, 2.51 * py, 1);
      billboard.current.position.y = -0.22;
    }
    if (shell.current) {
      const k = 0.5 + 0.5 * Math.sin(t * 1.85);
      const sx = THREE.MathUtils.lerp(1.0, 1.08, k);
      const sy = THREE.MathUtils.lerp(1.22, 1.12, 1 - k);
      shell.current.scale.set(sx, sy, sx);
      shell.current.position.y = -0.18;
      shell.current.rotation.y = t * 0.35;
      shell.current.visible = shellW > 0.08;
    }
    if (shellOuter.current) {
      const k = 0.5 + 0.5 * Math.sin(t * 1.4 + 1.2);
      shellOuter.current.scale.setScalar(THREE.MathUtils.lerp(1.06, 1.14, k));
      shellOuter.current.rotation.y = -t * 0.22;
      shellOuter.current.visible = shellW > 0.08;
    }
    if (shellGlow.current) {
      const k = 0.5 + 0.5 * Math.sin(t * 1.1 + 0.4);
      shellGlow.current.scale.setScalar(THREE.MathUtils.lerp(1.18, 1.28, k));
      shellGlow.current.rotation.y = t * 0.12;
      shellGlow.current.visible = shellW > 0.08;
    }
    if (rim.current) {
      rim.current.rotation.z = t * 1.1;
      rim.current.rotation.x = Math.PI / 2 + Math.sin(t * 0.9) * 0.1;
      const wobble = 1 + 0.035 * Math.sin(t * 2.6);
      rim.current.scale.set(wobble, wobble, 1);
      rim.current.visible = shellW > 0.1;
    }
  });

  return (
    <group position={[x, 0.88, 0]}>
      <group ref={billboard}>
        <mesh renderOrder={82}>
          <planeGeometry args={[1, 1]} />
          <primitive object={billboardMat} attach="material" />
        </mesh>
      </group>
      <group ref={shell}>
        <mesh ref={shellGlow} renderOrder={78} scale={[1.05, 1.24, 1.05]}>
          <sphereGeometry args={[0.92, 28, 20]} />
          <primitive object={glowMat} attach="material" />
        </mesh>
        <mesh renderOrder={80} scale={[0.98, 1.16, 0.98]}>
          <sphereGeometry args={[0.92, 40, 28]} />
          <primitive object={shellMat} attach="material" />
        </mesh>
        <mesh ref={shellOuter} renderOrder={79} scale={[0.98, 1.16, 0.98]}>
          <sphereGeometry args={[0.92, 32, 24]} />
          <primitive object={shellOuterMat} attach="material" />
        </mesh>
        <mesh ref={rim} renderOrder={81} scale={[1, 1.12, 1]}>
          <torusGeometry args={[0.88, 0.028, 10, 48]} />
          <primitive object={rimMat} attach="material" />
        </mesh>
      </group>
      <StationLabel element={element} y={-1.25} />
    </group>
  );
}

function GroundDebris({ element }: { element: ElementId }) {
  const c = SHAPE_COLORS[element];
  const rockMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: element === "frost" ? "#bae6fd" : "#5c3d24",
        roughness: 0.85,
        metalness: 0.05,
        transparent: element === "frost",
        opacity: element === "frost" ? 0.75 : 1,
        emissive: element === "frost" ? new THREE.Color(c.mid) : new THREE.Color("#000000"),
        emissiveIntensity: element === "frost" ? 0.25 : 0,
      }),
    [element, c.mid],
  );

  const iceMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#8adaff",
        roughness: 0.35,
        metalness: 0.05,
        transparent: true,
        opacity: 0.88,
        emissive: new THREE.Color("#e0f2fe"),
        emissiveIntensity: 0.35,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const iceShards = useMemo(() => {
    if (element !== "frost") return [];
    // Ankle-height rubble — sandbox createShardGeometry layout on the frost sheet
    const specs = [
      { seed: 3, p: [0.42, 0, 0.22] as const, s: [0.22, 0.14, 0.22] as const, yaw: 0.4 },
      { seed: 7, p: [-0.48, 0, -0.12] as const, s: [0.18, 0.11, 0.18] as const, yaw: -0.8 },
      { seed: 11, p: [0.12, 0, -0.52] as const, s: [0.2, 0.13, 0.2] as const, yaw: 1.1 },
      { seed: 15, p: [-0.22, 0, 0.48] as const, s: [0.16, 0.1, 0.16] as const, yaw: 0.2 },
      { seed: 19, p: [0.55, 0, -0.28] as const, s: [0.14, 0.09, 0.14] as const, yaw: -1.4 },
      { seed: 23, p: [-0.55, 0, 0.3] as const, s: [0.15, 0.1, 0.15] as const, yaw: 0.9 },
      { seed: 29, p: [0.05, 0, 0.08] as const, s: [0.12, 0.08, 0.12] as const, yaw: -0.3 },
    ];
    return specs.map((sp) => ({
      ...sp,
      geo: createIceShardGeometry(sp.seed, 5),
    }));
  }, [element]);

  useEffect(() => {
    return () => {
      for (const s of iceShards) s.geo.dispose();
    };
  }, [iceShards]);

  if (element === "fire") {
    const rocks = [
      { p: [0.45, 0.08, 0.2] as const, s: [0.18, 0.1, 0.14] as const, r: 0.4 },
      { p: [-0.55, 0.06, -0.15] as const, s: [0.14, 0.08, 0.12] as const, r: -0.7 },
      { p: [0.15, 0.07, -0.5] as const, s: [0.12, 0.09, 0.16] as const, r: 1.1 },
      { p: [-0.2, 0.05, 0.55] as const, s: [0.1, 0.07, 0.11] as const, r: 0.2 },
    ];
    return (
      <>
        {rocks.map((r, i) => (
          <mesh key={i} position={[...r.p]} rotation={[0.2, r.r, 0.1]} scale={[...r.s]} castShadow={false}>
            <dodecahedronGeometry args={[1, 0]} />
            <primitive object={rockMat} attach="material" />
          </mesh>
        ))}
      </>
    );
  }

  if (element === "frost") {
    return (
      <>
        {iceShards.map((sh, i) => (
          <mesh
            key={i}
            geometry={sh.geo}
            material={iceMat}
            position={[sh.p[0], 0.01, sh.p[2]]}
            rotation={[0.05, sh.yaw, 0.08]}
            scale={[...sh.s]}
            castShadow={false}
            renderOrder={9}
          />
        ))}
      </>
    );
  }

  return null;
}

/**
 * Snare-style ground filaments — radial tendrils + rim hops (elemental sandbox cage roles).
 * Uses horizontal LightningArcWorld segments so they read as real bolts, not decal paint.
 */
const SNARE_FILAMENT = {
  colorCore: "#ffffff",
  colorInner: "#c9ecff",
  colorOuter: "#3aa0ff",
  colorHalo: "#0b3fc8",
} as const;

function LightningGroundTendrils() {
  const anchor = useRef<THREE.Group>(null);
  const ids = useRef<number[]>([]);
  const veers = useRef<number[]>([]);
  const centre = useMemo(() => new THREE.Vector3(), []);

  const TENDRILS = 3;
  const RIMS = 2;
  const TOTAL = TENDRILS + RIMS;

  useEffect(() => {
    veers.current = Array.from({ length: TENDRILS }, () => (Math.random() - 0.5) * 2.0 * 0.9);
    return () => {
      for (const id of ids.current) killLightningCluster(id);
      ids.current = [];
    };
  }, []);

  useFrame(() => {
    if (!anchor.current) return;
    anchor.current.getWorldPosition(centre);
    const cx = centre.x;
    const cz = centre.z;
    const t = performance.now() * 0.001;
    const spin = t * -0.18 * Math.PI * 2;
    const hug = 0.04;
    // Low hop — stay floor-hugging rather than leaping columns
    const arch = 0.08;
    const rimArch = 0.05;
    const inner = GROUND_R * 0.12;
    const reach = GROUND_R * 0.58;

    const tendrilOpts = {
      spreadMul: 0.22,
      sag: arch,
      strands: 2,
      ...SNARE_FILAMENT,
    };
    const rimOpts = {
      spreadMul: 0.14,
      sag: rimArch,
      strands: 2,
      ...SNARE_FILAMENT,
    };

    while (ids.current.length < TOTAL) {
      const i = ids.current.length;
      const isRim = i >= TENDRILS;
      const id = spawnLightningSegment(
        cx,
        hug,
        cz,
        cx + 0.01,
        hug,
        cz + 0.01,
        isRim ? rimOpts : tendrilOpts,
      );
      if (id < 0) break;
      ids.current.push(id);
    }

    for (let i = 0; i < TENDRILS; i++) {
      const id = ids.current[i];
      if (id === undefined || id < 0) continue;
      const f = (i + 0.5) / TENDRILS;
      const veer = veers.current[i] ?? 0;
      const a0 = f * Math.PI * 2 + spin;
      const a1 = a0 + veer * 0.7;
      const ax = cx + Math.cos(a0) * inner;
      const az = cz + Math.sin(a0) * inner;
      const bx = cx + Math.cos(a1) * reach;
      const bz = cz + Math.sin(a1) * reach;
      if (!setLightningSegment(id, ax, hug, az, bx, hug + 0.01, bz)) {
        ids.current[i] = spawnLightningSegment(ax, hug, az, bx, hug + 0.01, bz, tendrilOpts);
      }
    }

    for (let i = 0; i < RIMS; i++) {
      const id = ids.current[TENDRILS + i];
      if (id === undefined || id < 0) continue;
      const base = (i / RIMS) * Math.PI * 2 + t * 0.4;
      const span = 0.35;
      const r = GROUND_R * 0.55;
      const a0 = base;
      const a1 = base + span;
      const ax = cx + Math.cos(a0) * r;
      const az = cz + Math.sin(a0) * r;
      const bx = cx + Math.cos(a1) * r;
      const bz = cz + Math.sin(a1) * r;
      if (!setLightningSegment(id, ax, hug, az, bx, hug + 0.02, bz)) {
        ids.current[TENDRILS + i] = spawnLightningSegment(ax, hug, az, bx, hug + 0.02, bz, rimOpts);
      }
    }
  });

  return <group ref={anchor} />;
}

/** Element-specific textured ground VFX. */
function GroundStation({ element, x }: { element: ElementId; x: number }) {
  const c = SHAPE_COLORS[element];
  const look = GROUND_LOOK[element];
  const colors = look.colors ?? { hot: c.hot, mid: c.mid, edge: c.edge };
  const mat = useMemo(
    () =>
      createLabGroundMarkMaterial(look.mode, colors, {
        pattern: look.pattern,
        opacity: look.opacity,
        additive: look.additive,
      }),
    [look.mode, look.pattern, look.opacity, look.additive, look.colors, colors.hot, colors.mid, colors.edge],
  );
  useFrame((_, dt) => tickLabGroundMark(mat, dt));
  return (
    <group position={[x, 0, 0]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.055, 0]}
        scale={GROUND_R * 2}
        renderOrder={8}
      >
        <planeGeometry args={[1, 1]} />
        <primitive object={mat} attach="material" />
      </mesh>
      {element === "lightning" ? <LightningGroundTendrils /> : null}
      <GroundDebris element={element} />
      <StationLabel element={element} y={0.15} />
    </group>
  );
}

/**
 * Blood caster — AW melee slash (slash01): crescent swipe on a flat disc + ghost trail.
 */
function BloodCasterBlow({
  x,
  hx,
  hy,
  hz,
}: {
  x: number;
  hx: number;
  hy: number;
  hz: number;
}) {
  const c = SHAPE_COLORS.blood;
  const slashMat = useMemo(
    () => createLabMeleeSlashMaterial(c.hot, c.mid, c.edge),
    [c.hot, c.mid, c.edge],
  );
  const ghostMat = useMemo(
    () => createLabMeleeSlashMaterial("#fecaca", "#dc2626", "#450a0a"),
    [],
  );
  const root = useRef<THREE.Group>(null);
  const slash = useRef<THREE.Mesh>(null);
  const ghost = useRef<THREE.Mesh>(null);

  useFrame((_, dt) => {
    // Looping swipe: quick draw, short hold, reset
    const cycle = 0.85;
    const t = (performance.now() * 0.001) % cycle;
    const u = t / cycle;
    // Ease out progress for the leading edge
    const progress = u < 0.55 ? Math.pow(u / 0.55, 0.65) : 1;
    const fade = u < 0.55 ? 0.55 + 0.45 * (u / 0.55) : Math.max(0, 1 - (u - 0.55) / 0.45);
    tickLabMeleeSlash(slashMat, dt, progress);
    tickLabMeleeSlash(ghostMat, dt, Math.max(0, progress - 0.12));
    slashMat.uniforms.uOpacity!.value = 0.95 * fade;
    ghostMat.uniforms.uOpacity!.value = 0.45 * fade;

    if (root.current) {
      // Slight lean like a melee arc in front of the hand
      root.current.rotation.x = -0.35;
      root.current.rotation.y = 0.15 + Math.sin(performance.now() * 0.001 * 0.4) * 0.05;
      root.current.rotation.z = -0.55 + progress * 0.35;
    }
    if (slash.current) {
      const s = 1.05 + progress * 0.12;
      slash.current.scale.setScalar(s);
    }
    if (ghost.current) {
      ghost.current.scale.setScalar(1.12 + progress * 0.08);
      ghost.current.rotation.z = -0.08;
    }
  });

  return (
    <group position={[x, 0, 0]}>
      <group ref={root} position={[hx + 0.15, hy + 0.05, hz + 0.15]}>
        <mesh ref={ghost} renderOrder={40}>
          <circleGeometry args={[0.85, 48]} />
          <primitive object={ghostMat} attach="material" />
        </mesh>
        <mesh ref={slash} renderOrder={41}>
          <circleGeometry args={[0.85, 48]} />
          <primitive object={slashMat} attach="material" />
        </mesh>
      </group>
      <pointLight position={[hx, hy, hz]} color="#ef4444" intensity={1.4} distance={2.6} decay={2} />
      <StationLabel element="blood" y={0.2} />
    </group>
  );
}

/**
 * Lightning caster — small hand core + filament strike cluster (same ribbons as emitter).
 */
function LightningCasterBlow({
  x,
  hx,
  hy,
  hz,
}: {
  x: number;
  hx: number;
  hy: number;
  hz: number;
}) {
  const hand = useRef<THREE.Group>(null);
  const clusterId = useRef(-1);
  const _wp = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    return () => {
      if (clusterId.current >= 0) killLightningCluster(clusterId.current);
      clusterId.current = -1;
    };
  }, []);

  useFrame(() => {
    if (!hand.current) return;
    hand.current.getWorldPosition(_wp);
    // Anchor slightly below hand center so short bolts fill the orb, not tower above it
    const bx = _wp.x;
    const by = _wp.y - 0.06;
    const bz = _wp.z;
    if (clusterId.current < 0 || !moveLightningCluster(clusterId.current, bx, by, bz)) {
      // Short crackle — stay in / just outside the hand core (~0.22 glow radius)
      clusterId.current = spawnLightningCluster(bx, by, bz, { length: 0.28, spreadMul: 0.35 });
    }
  });

  return (
    <group position={[x, 0, 0]}>
      <group ref={hand} position={[hx, hy, hz]}>
        <mesh renderOrder={42}>
          <sphereGeometry args={[0.1, 12, 10]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.85}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <mesh scale={2.2} renderOrder={41}>
          <sphereGeometry args={[0.1, 10, 8]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.22}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <pointLight color="#93c5fd" intensity={2.2} distance={3.0} decay={2} />
      </group>
      <StationLabel element="lightning" y={0.2} />
    </group>
  );
}

/**
 * Caster blow — element-specific charge (particles / light / form), not one retinted orb.
 */
function CasterOrbStation({ element, x }: { element: ElementId; x: number }) {
  const c = SHAPE_COLORS[element];
  const orbMat = useMemo(
    () =>
      createLabChargeOrbMaterial(
        element === "void" ? "#fae8ff" : c.hot,
        element === "void" ? "#c026d3" : c.mid,
      ),
    [element, c.hot, c.mid],
  );
  const lightMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: c.hot,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [c.hot],
  );
  const frostMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: c.hot,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    [c.hot],
  );

  const orb = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.Mesh>(null);
  const glacier = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    tickLabChargeOrb(orbMat, dt);
    const t = performance.now() * 0.001;

    if (light.current) {
      const pulse =
        element === "fire"
          ? 1 + 0.2 * Math.sin(t * 14)
          : element === "holy"
            ? 1 + 0.12 * Math.sin(t * 3.5)
            : 1 + 0.1 * Math.sin(t * 6);
      light.current.scale.setScalar(pulse);
      (light.current.material as THREE.MeshBasicMaterial).opacity =
        element === "holy" ? 0.55 + 0.2 * Math.sin(t * 4) : 0.5 + 0.35 * Math.sin(t * 10);
    }
    if (orb.current) {
      const pulse =
        element === "void"
          ? 1 + 0.08 * Math.sin(t * 2.4)
          : element === "heal"
            ? 1 + 0.07 * Math.sin(t * 2.5)
            : 1 + 0.06 * Math.sin(t * 4);
      orb.current.scale.setScalar(pulse);
      if (element === "void") orb.current.rotation.y = t * 0.9;
      orbMat.uniforms.uOpacity!.value = element === "void" ? 0.72 : 0.42;
    }
    if (glacier.current) {
      glacier.current.rotation.y = t * 0.35;
    }
  });

  const hx = 0.2;
  const hy = HAND_Y;
  const hz = SPAWN;

  // ── Fire: soft light flare (particles carry the look) ──
  if (element === "fire") {
    return (
      <group position={[x, 0, 0]}>
        <mesh ref={light} position={[hx, hy, hz]} renderOrder={42}>
          <sphereGeometry args={[0.18, 12, 10]} />
          <primitive object={lightMat} attach="material" />
        </mesh>
        <mesh position={[hx, hy, hz]} scale={2.2} renderOrder={41}>
          <sphereGeometry args={[0.18, 10, 8]} />
          <meshBasicMaterial
            color={c.mid}
            transparent
            opacity={0.2}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <pointLight position={[hx, hy, hz]} color={c.hot} intensity={2.2} distance={3.5} decay={2} />
        <StationLabel element={element} y={0.2} />
      </group>
    );
  }

  // ── Frost: small glacier shards (smoke/ice particles emit around) ──
  if (element === "frost") {
    const shards = [
      { p: [0.08, 0.12, 0.05] as const, s: [0.07, 0.28, 0.07] as const, r: [0.2, 0.4, 0.1] as const },
      { p: [-0.1, 0.06, 0.08] as const, s: [0.05, 0.2, 0.05] as const, r: [-0.3, -0.5, 0.2] as const },
      { p: [0.02, 0.18, -0.06] as const, s: [0.06, 0.24, 0.06] as const, r: [0.1, 0.8, -0.2] as const },
      { p: [0.12, 0.02, -0.04] as const, s: [0.045, 0.14, 0.045] as const, r: [0.4, -0.3, 0.15] as const },
    ];
    return (
      <group position={[x, 0, 0]}>
        <group ref={glacier} position={[hx, 0, hz]}>
          {shards.map((sh, i) => (
            <mesh
              key={i}
              position={[sh.p[0], hy + sh.p[1], sh.p[2]]}
              rotation={[...sh.r]}
              scale={[...sh.s]}
              renderOrder={40}
            >
              <octahedronGeometry args={[1, 0]} />
              <primitive object={frostMat} attach="material" />
            </mesh>
          ))}
        </group>
        <StationLabel element={element} y={0.2} />
      </group>
    );
  }

  // ── Poison / wind: particle-only ──
  if (element === "poison" || element === "wind") {
    return (
      <group position={[x, 0, 0]}>
        <StationLabel element={element} y={0.2} />
      </group>
    );
  }

  // ── Lightning: bright core + real filament strikes (no plane lines) ──
  if (element === "lightning") {
    return <LightningCasterBlow x={x} hx={hx} hy={hy} hz={hz} />;
  }

  // ── Holy: small hand light ──
  if (element === "holy") {
    return (
      <group position={[x, 0, 0]}>
        <mesh ref={light} position={[hx, hy, hz]} renderOrder={42}>
          <sphereGeometry args={[0.12, 12, 10]} />
          <primitive object={lightMat} attach="material" />
        </mesh>
        <mesh position={[hx, hy, hz]} scale={2.4} renderOrder={41}>
          <sphereGeometry args={[0.12, 10, 8]} />
          <meshBasicMaterial
            color={c.mid}
            transparent
            opacity={0.18}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <pointLight position={[hx, hy, hz]} color={c.hot} intensity={1.6} distance={2.8} decay={2} />
        <StationLabel element={element} y={0.2} />
      </group>
    );
  }

  // ── Blood: AW melee slash — crescent swipe (slash01 flat-sphere recipe) ──
  if (element === "blood") {
    return <BloodCasterBlow x={x} hx={hx} hy={hy} hz={hz} />;
  }

  // ── Void: small readable sphere ──
  if (element === "void") {
    return (
      <group position={[x, 0, 0]}>
        <mesh ref={orb} position={[hx, hy, hz]} renderOrder={40}>
          <sphereGeometry args={[0.18, 20, 14]} />
          <primitive object={orbMat} attach="material" />
        </mesh>
        <mesh position={[hx, hy, hz]} scale={1.55} renderOrder={39}>
          <sphereGeometry args={[0.18, 16, 12]} />
          <meshBasicMaterial
            color="#c026d3"
            transparent
            opacity={0.28}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
            side={THREE.BackSide}
          />
        </mesh>
        <mesh position={[hx, hy, hz]} renderOrder={41}>
          <sphereGeometry args={[0.07, 10, 8]} />
          <meshBasicMaterial
            color="#fae8ff"
            transparent
            opacity={0.55}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <StationLabel element={element} y={0.2} />
      </group>
    );
  }

  // ── Heal: soft sphere (leaves from particles) ──
  return (
    <group position={[x, 0, 0]}>
      <mesh ref={orb} position={[hx, hy, hz]} rotation={[Math.PI * 0.12, 0, 0]} renderOrder={40}>
        <sphereGeometry args={[0.22, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.7]} />
        <primitive object={orbMat} attach="material" />
      </mesh>
      <StationLabel element={element} y={0.2} />
    </group>
  );
}

/**
 * Impact — elemental ground mark flash (same identities as Ground) + brief splash.
 * No generic retinted circle.
 */
function ImpactFlashStation({ element, x }: { element: ElementId; x: number }) {
  const c = SHAPE_COLORS[element];
  const look = GROUND_LOOK[element];
  const colors = look.colors ?? { hot: c.hot, mid: c.mid, edge: c.edge };
  const markMat = useMemo(
    () =>
      createLabGroundMarkMaterial(look.mode, colors, {
        pattern: look.pattern,
        opacity: look.opacity,
        additive: look.additive,
      }),
    [look.mode, look.pattern, look.opacity, look.additive, look.colors, colors.hot, colors.mid, colors.edge],
  );
  const mark = useRef<THREE.Mesh>(null);
  const burst = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    tickLabGroundMark(markMat, dt);
    // Looping impact pulse — expand + fade (lab preview)
    const t = (performance.now() * 0.001 % 1.1) / 1.1;
    const expand = 0.35 + t * 0.85;
    const fade = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.85);
    if (mark.current) {
      mark.current.scale.setScalar(GROUND_R * 1.15 * expand);
      markMat.uniforms.uOpacity!.value = (look.opacity ?? 0.9) * fade * 0.95;
      mark.current.visible = fade > 0.02;
    }
    if (burst.current) {
      burst.current.scale.setScalar(0.5 + t * 0.9);
      burst.current.visible = fade > 0.05;
      burst.current.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshBasicMaterial;
        if (mat?.transparent) mat.opacity = 0.55 * fade * (1 - t);
      });
    }
  });

  // Element-specific burst accent above the mark (not a shared dome)
  const burstMesh =
    element === "fire" ? (
      <mesh position={[0, 0.15, 0]} renderOrder={34}>
        <sphereGeometry args={[0.35, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshBasicMaterial
          color={c.hot}
          transparent
          opacity={0.45}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    ) : element === "frost" ? (
      <>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * 0.35, 0.12, Math.sin(a) * 0.35]}
              rotation={[0.3, a, 0.1]}
              scale={[0.06, 0.18, 0.06]}
              renderOrder={34}
            >
              <octahedronGeometry args={[1, 0]} />
              <meshBasicMaterial
                color={c.hot}
                transparent
                opacity={0.7}
                depthWrite={false}
                toneMapped={false}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
          );
        })}
      </>
    ) : element === "lightning" ? (
      <>
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + 0.2;
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * 0.15, 0.2, Math.sin(a) * 0.15]}
              rotation={[0, a, Math.PI / 2]}
              renderOrder={34}
            >
              <planeGeometry args={[0.04, 0.55]} />
              <meshBasicMaterial
                color={c.hot}
                transparent
                opacity={0.8}
                depthWrite={false}
                toneMapped={false}
                blending={THREE.AdditiveBlending}
                side={THREE.DoubleSide}
              />
            </mesh>
          );
        })}
      </>
    ) : element === "holy" ? (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]} renderOrder={34}>
        <ringGeometry args={[0.25, 0.42, 6]} />
        <meshBasicMaterial
          color={c.hot}
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    ) : element === "blood" ? (
      <>
        {[-0.4, -0.1, 0.2, 0.5].map((zAng, i) => (
          <mesh
            key={i}
            position={[0.05 * i, 0.1, 0]}
            rotation={[-Math.PI / 2, 0, zAng]}
            renderOrder={34}
          >
            <planeGeometry args={[0.05, 0.7]} />
            <meshBasicMaterial
              color={i % 2 === 0 ? c.hot : c.mid}
              transparent
              opacity={0.7}
              depthWrite={false}
              toneMapped={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </>
    ) : element === "void" ? (
      <mesh position={[0, 0.14, 0]} renderOrder={34}>
        <sphereGeometry args={[0.28, 14, 10]} />
        <meshBasicMaterial
          color="#e879f9"
          transparent
          opacity={0.35}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    ) : null;

  return (
    <group position={[x, 0, 0]}>
      <mesh
        ref={mark}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.06, 0]}
        renderOrder={32}
      >
        <planeGeometry args={[1, 1]} />
        <primitive object={markMat} attach="material" />
      </mesh>
      <group ref={burst}>{burstMesh}</group>
      <GroundDebris element={element} />
      <StationLabel element={element} y={0.35} />
    </group>
  );
}

/**
 * Telegraph — single rim outline (AoeRimMarker) + AW impact charge fill (GroundDecal).
 * Outline stays full-shape; interior fills from origin as progress advances.
 * Spell Lab relation toggle: self = compare all; ally/enemy = that team only.
 */
function TelegraphPreview() {
  const progressRef = useRef(0.45);
  const friendOp = useRef(1);
  const enemyOp = useRef(1);
  const [relation, setRelation] = useState(() => castAimRuntime.relationPreview);

  useEffect(() => {
    return castAimRuntime.subscribe(() => {
      setRelation(castAimRuntime.relationPreview);
    });
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    progressRef.current = Math.sin(t * 0.65) * 0.5 + 0.5;
    friendOp.current = 0.85 + 0.15 * Math.sin(t * 1.2);
    enemyOp.current = 0.85 + 0.15 * Math.sin(t * 1.2 + 1);
  });

  const rim = {
    fill: 0,
    rimWidth: 0.014,
    glowWidth: 0.028,
    noise: 0.06,
    opacity: 0.9,
  } as const;

  const showAlly = relation === "self" || relation === "ally";
  const showEnemy = relation === "self" || relation === "enemy";
  const allyX = relation === "ally" ? 0 : -3.8;
  const enemyCircleX = relation === "enemy" ? -1.6 : 0;
  const enemyConeX = relation === "enemy" ? 1.6 : 3.9;

  return (
    <group position={[0, 0.05, 3.4]}>
      {showAlly ? (
        <>
          <GroundDecal
            preset={{ ...groundPresets.telegraphFriendly, additive: true, opacity: 0.55 }}
            x={allyX}
            y={0.045}
            z={0}
            radius={2.6}
            progressRef={progressRef}
            growExpand
          />
          <AoeRimMarker
            x={allyX}
            z={0}
            y={0.055}
            radius={2.6}
            color="#22c55e"
            hotColor="#bbf7d0"
            {...rim}
            opacityMulRef={friendOp}
            pulse
          />
          <Html position={[allyX, 0.35, 0]} center distanceFactor={18} style={{ pointerEvents: "none" }}>
            <div style={labelStyle}>Friendly</div>
          </Html>
        </>
      ) : null}
      {showEnemy ? (
        <>
          <GroundDecal
            preset={{ ...groundPresets.telegraphEnemy, additive: true, opacity: 0.55 }}
            x={enemyCircleX}
            y={0.045}
            z={0}
            radius={2.6}
            progressRef={progressRef}
            growExpand
          />
          <AoeRimMarker
            x={enemyCircleX}
            z={0}
            y={0.055}
            radius={2.6}
            color="#ef4444"
            hotColor="#fecaca"
            {...rim}
            opacityMulRef={enemyOp}
            pulse
          />
          <GroundDecal
            preset={{ ...groundPresets.telegraphEnemyCone, additive: true, opacity: 0.5 }}
            x={enemyConeX}
            y={0.045}
            z={0}
            yaw={0}
            radius={3.4}
            progressRef={progressRef}
            growExpand
          />
          <AoeRimMarker
            x={enemyConeX}
            z={0}
            y={0.055}
            radius={3.4}
            shape="cone"
            halfAngle={Math.PI / 3}
            color="#ef4444"
            hotColor="#fecaca"
            {...rim}
            opacityMulRef={enemyOp}
            pulse
          />
          <Html
            position={[enemyCircleX, 0.35, 0]}
            center
            distanceFactor={18}
            style={{ pointerEvents: "none" }}
          >
            <div style={labelStyle}>Enemy</div>
          </Html>
          <Html
            position={[enemyConeX, 0.35, 0]}
            center
            distanceFactor={18}
            style={{ pointerEvents: "none" }}
          >
            <div style={labelStyle}>Enemy cone</div>
          </Html>
        </>
      ) : null}
      <Html position={[0, 0.55, -1.4]} center distanceFactor={20} style={{ pointerEvents: "none" }}>
        <div style={{ ...labelStyle, opacity: 0.8, fontSize: 10 }}>
          Outline = full zone · interior = AW impact charge
          {relation !== "self" ? ` · as ${relation}` : ""}
        </div>
      </Html>
    </group>
  );
}

/**
 * Shape VFX are mesh/decal behaviors — not particle retints.
 * Particles from shapeShowcase are accents only.
 */
export function LabShapePreview({ originRef }: { originRef?: OriginRef }) {
  const { telegraph, shape, focus } = useLabPreview();
  const root = useRef<THREE.Group>(null);

  const elements: ElementId[] =
    focus === "gallery"
      ? ELEMENT_GALLERY.map((e) => e.id)
      : focus
        ? [focus]
        : [];

  useFrame(() => {
    const o = originRef?.current;
    if (!root.current) return;
    root.current.position.set(o?.x ?? 0, 0, o?.z ?? 0);
    // Telegraph must face look-ahead; shape gallery stays world-X so particles match.
    root.current.rotation.y = showTelegraph ? (o?.yaw ?? 0) : 0;
  });

  const showTelegraph = telegraph || shape === "telegraph";
  const xs = stationXs(Math.max(1, elements.length), STATION_SPACING);

  if (!showTelegraph && shape === "emitter") return null;
  if (!showTelegraph && elements.length === 0 && shape !== "telegraph") return null;

  return (
    <group ref={root}>
      {showTelegraph ? <TelegraphPreview /> : null}
      {!showTelegraph && shape === "beam"
        ? elements.map((el, i) => <BeamStation key={el} element={el} x={xs[i]!} />)
        : null}
      {!showTelegraph && shape === "ground"
        ? elements.map((el, i) => <GroundStation key={el} element={el} x={xs[i]!} />)
        : null}
      {!showTelegraph && shape === "shield"
        ? elements.map((el, i) => <ShieldStation key={el} element={el} x={xs[i]!} />)
        : null}
      {!showTelegraph && shape === "caster"
        ? elements.map((el, i) => <CasterOrbStation key={el} element={el} x={xs[i]!} />)
        : null}
      {!showTelegraph && shape === "impact"
        ? elements.map((el, i) => <ImpactFlashStation key={el} element={el} x={xs[i]!} />)
        : null}
    </group>
  );
}

const labelStyle: CSSProperties = {
  color: "#f8fafc",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textShadow: "0 1px 5px #000",
  whiteSpace: "nowrap",
};

const stationLabelStyle: CSSProperties = {
  color: "#e2e8f0",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  textShadow: "0 1px 4px #000",
  whiteSpace: "nowrap",
};

export { LabShapePreview as LabTelegraphPreview };
