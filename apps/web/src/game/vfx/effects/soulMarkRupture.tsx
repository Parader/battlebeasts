import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { smooth01 } from "../easing";
import { getVfxCircleTexture } from "../materials/circlePoint";
import { acquireEnergyRingMaterial } from "../materials/energyBall";
import { useSpellLight } from "../spellLights";
import { burstElementRole } from "../engine";
import {
  easeOutCubic,
  GEO_SOUL_CENTER,
  GEO_SOUL_INNER_RING,
  GEO_SOUL_OUTER_RING,
  GEO_SOUL_RUNE_ARM,
  GEO_SOUL_SHOCK_RING,
  GEO_SOUL_VERT_RING,
  SOUL_MARK_COLORS,
  SOUL_RUNE_ANGLES,
  SOUL_RUNE_RADIUS,
} from "./soulMarkPalette";

/** Modest size bump for rupture only — keeps the tuned look, scales uniformly. */
const RUPTURE_SCALE = 1.12;

const IMPLODE_MS = 70;
const SNAP_START_MS = 70;
const SNAP_MS = 50;
const RUPTURE_START_MS = 120;
const RUPTURE_MS = 160;
const VERT_RING_DELAY_MS = 25;
const RUNE_BREAK_MS = 180;

const STREAK_COUNT = 12;

/** Shock ring geo outer radius — used to convert target world radius → scale. */
const SHOCK_OUTER_R = 0.17;
const VERT_OUTER_R = 0.11;

type Streak = {
  active: boolean;
  born: number;
  life: number;
  dir: THREE.Vector3;
  speed: number;
  len: number;
};

type RuneFrag = {
  x: number;
  y: number;
  rot: number;
  vx: number;
  rotV: number;
  breakDist: number;
};

function makeGlowMaterial(color: string, opacity: number): THREE.MeshBasicMaterial {
  const tex = getVfxCircleTexture();
  return new THREE.MeshBasicMaterial({
    map: tex,
    alphaMap: tex,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
}

function makeRingMaterial(color: string, opacity: number): THREE.MeshBasicMaterial {
  const mat = acquireEnergyRingMaterial(color, opacity);
  mat.depthTest = false;
  return mat;
}

function randomStreakDir(): THREE.Vector3 {
  const dir = new THREE.Vector3(
    (Math.random() - 0.5) * 2,
    0.15 + Math.random() * 0.85,
    (Math.random() - 0.5) * 2,
  );
  if (Math.random() < 0.15) dir.y = -0.2 - Math.random() * 0.4;
  return dir.normalize();
}

/**
 * Soul Rupture — mark meshes plus a ParticleWorld void impact.
 * No spherical explosion shell.
 */
export function SoulMarkRuptureEffect({ shot }: { shot: OneShotEffect }) {
  const { camera } = useThree();
  const spellLight = useSpellLight();
  const group = useRef<THREE.Group>(null);
  const markGroup = useRef<THREE.Group>(null);
  const outerRing = useRef<THREE.Mesh>(null);
  const innerRing = useRef<THREE.Mesh>(null);
  const centerGlow = useRef<THREE.Mesh>(null);
  const runeArms = useRef<(THREE.Mesh | null)[]>([null, null, null]);
  const flashOuter = useRef<THREE.Mesh>(null);
  const flashInner = useRef<THREE.Mesh>(null);
  const shockRing = useRef<THREE.Mesh>(null);
  const vertRing = useRef<THREE.Mesh>(null);
  const streakRefs = useRef<(THREE.Mesh | null)[]>([]);

  const outerMat = useMemo(() => makeRingMaterial(SOUL_MARK_COLORS.primary, 1), []);
  const innerMat = useMemo(() => makeRingMaterial(SOUL_MARK_COLORS.bright, 0.8), []);
  const centerMat = useMemo(() => makeRingMaterial(SOUL_MARK_COLORS.deepViolet, 0.65), []);
  const armMats = useMemo(
    () => [0, 1, 2].map(() => makeRingMaterial(SOUL_MARK_COLORS.bright, 0.85)),
    [],
  );
  const flashOuterMat = useMemo(() => makeGlowMaterial(SOUL_MARK_COLORS.bright, 0), []);
  const flashInnerMat = useMemo(() => makeGlowMaterial(SOUL_MARK_COLORS.hotFlash, 0), []);
  const shockMat = useMemo(() => makeRingMaterial(SOUL_MARK_COLORS.bright, 0), []);
  const vertMat = useMemo(() => makeRingMaterial(SOUL_MARK_COLORS.primary, 0), []);
  const streakMats = useMemo(
    () =>
      Array.from({ length: STREAK_COUNT }, () =>
        new THREE.MeshBasicMaterial({
          color: SOUL_MARK_COLORS.bright,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
      ),
    [],
  );

  const markSpin = useRef(0);
  const ruptureSpawned = useRef(false);

  const streaks = useRef<Streak[]>(
    Array.from({ length: STREAK_COUNT }, () => ({
      active: false,
      born: 0,
      life: 0.18,
      dir: new THREE.Vector3(0, 1, 0),
      speed: 4,
      len: 0.3,
    })),
  );
  const streakUp = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const streakQuat = useMemo(() => new THREE.Quaternion(), []);

  const runeFrags = useRef<RuneFrag[]>(
    [0, 1, 2].map((i) => ({
      x: Math.cos(SOUL_RUNE_ANGLES[i]!) * SOUL_RUNE_RADIUS,
      y: Math.sin(SOUL_RUNE_ANGLES[i]!) * SOUL_RUNE_RADIUS,
      rot: SOUL_RUNE_ANGLES[i]! + Math.PI / 2,
      vx: Math.cos(SOUL_RUNE_ANGLES[i]!),
      rotV: (0.5 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1),
      breakDist: 0.3 + Math.random() * 0.2,
    })),
  );
  const runeBreakStarted = useRef(false);

  const groundY = 0.03;
  const torsoY = 0;

  useEffect(() => {
    burstElementRole("void", "impact", shot.x, shot.y, shot.z);
  }, [shot.key, shot.x, shot.y, shot.z]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    if (ms >= shot.life) {
      g.visible = false;
      spellLight.off();
      return;
    }
    g.visible = true;

    const implodeT = smooth01(Math.min(1, ms / IMPLODE_MS));
    const snapT = ms < SNAP_START_MS ? 0 : Math.min(1, (ms - SNAP_START_MS) / SNAP_MS);
    const ruptureT =
      ms < RUPTURE_START_MS ? 0 : Math.min(1, (ms - RUPTURE_START_MS) / RUPTURE_MS);
    const vertT =
      ms < RUPTURE_START_MS + VERT_RING_DELAY_MS
        ? 0
        : Math.min(1, (ms - RUPTURE_START_MS - VERT_RING_DELAY_MS) / (RUPTURE_MS - VERT_RING_DELAY_MS));
    const breakT =
      ms < RUPTURE_START_MS ? 0 : Math.min(1, (ms - RUPTURE_START_MS) / RUNE_BREAK_MS);

    // ── 1. Implosion — ground rune collapses inward ──
    if (markGroup.current) {
      const suck = THREE.MathUtils.lerp(1, 0.25, easeOutCubic(implodeT));
      markGroup.current.scale.setScalar(suck * RUPTURE_SCALE);
      markSpin.current += dt * (0.25 + implodeT * 2.75);
      markGroup.current.rotation.z = markSpin.current;
      const markAlpha = THREE.MathUtils.lerp(1, 0.7, implodeT) * (1 - ruptureT * 0.95);
      outerMat.opacity = markAlpha * 0.85;
      innerMat.opacity = markAlpha * 0.7;
      centerMat.opacity = markAlpha * 0.55;

      if (!runeBreakStarted.current) {
        for (let i = 0; i < 3; i++) {
          const arm = runeArms.current[i];
          const frag = runeFrags.current[i]!;
          if (!arm) continue;
          arm.position.set(frag.x, frag.y, 0.002);
          arm.rotation.z = frag.rot;
          armMats[i]!.opacity = markAlpha * 0.8;
        }
      }
    }

    // ── 2. Core snap — small camera-facing flash, white stays tiny ──
    const snapVisible = snapT > 0 && snapT < 1;
    if (flashOuter.current && flashInner.current) {
      flashOuter.current.visible = snapVisible;
      flashInner.current.visible = snapVisible;
      if (snapVisible) {
        flashOuter.current.quaternion.copy(camera.quaternion);
        flashInner.current.quaternion.copy(camera.quaternion);
        const scale =
          snapT < 0.45
            ? THREE.MathUtils.lerp(0.15, 0.55, snapT / 0.45)
            : THREE.MathUtils.lerp(0.55, 0.35, (snapT - 0.45) / 0.55);
        flashOuter.current.scale.setScalar(scale);
        flashInner.current.scale.setScalar(scale * 0.26);
        const opacity =
          snapT < 0.25 ? snapT / 0.25 : 1 - (snapT - 0.25) / 0.75;
        flashOuterMat.opacity = opacity * 0.7;
        flashInnerMat.opacity = opacity * 0.95;
        spellLight.emit(shot.x, shot.y, shot.z, SOUL_MARK_COLORS.hotFlash, opacity * 6, 5);
      } else {
        spellLight.off();
      }
    }

    // ── 3. Main rupture layers ──
    if (ms >= RUPTURE_START_MS && !ruptureSpawned.current) {
      ruptureSpawned.current = true;
      runeBreakStarted.current = true;
      const now = performance.now();
      for (let i = 0; i < STREAK_COUNT; i++) {
        const s = streaks.current[i]!;
        s.active = true;
        s.born = now + i * 8;
        s.life = 0.12 + Math.random() * 0.12;
        s.dir = randomStreakDir();
        s.speed = 3 + Math.random() * 3;
        s.len = 0.18 + Math.random() * 0.28;
      }
    }

    // Layer A — horizontal shock ring at torso.
    if (shockRing.current) {
      shockRing.current.visible = ruptureT > 0 && ruptureT < 1;
      if (ruptureT > 0) {
        const ringEase = easeOutCubic(ruptureT);
        const worldR = THREE.MathUtils.lerp(0.15, 1.3, ringEase);
        shockRing.current.scale.setScalar(worldR / SHOCK_OUTER_R);
        shockMat.opacity = 1 * (1 - ringEase);
      }
    }

    // Layer B — vertical ring, delayed.
    if (vertRing.current) {
      vertRing.current.visible = vertT > 0 && vertT < 1;
      if (vertT > 0) {
        const ringEase = easeOutCubic(vertT);
        const worldR = THREE.MathUtils.lerp(0.1, 0.9, ringEase);
        vertRing.current.scale.setScalar(worldR / VERT_OUTER_R);
        vertRing.current.rotation.y += dt * (2.5 + ringEase * 3);
        vertMat.opacity = 0.85 * (1 - ringEase);
      }
    }

    // Layer C — psychic streak planes.
    const now = performance.now();
    for (let i = 0; i < STREAK_COUNT; i++) {
      const s = streaks.current[i]!;
      const mesh = streakRefs.current[i];
      const mat = streakMats[i]!;
      if (!mesh || !s.active) {
        if (mesh) mesh.visible = false;
        continue;
      }
      const age = (now - s.born) / 1000;
      if (age < 0 || age >= s.life) {
        mesh.visible = false;
        s.active = false;
        continue;
      }
      mesh.visible = true;
      const u = age / s.life;
      const travel = s.speed * age;
      mesh.position.set(s.dir.x * travel, s.dir.y * travel, s.dir.z * travel);
      streakQuat.setFromUnitVectors(streakUp, s.dir);
      if (Number.isFinite(streakQuat.x)) mesh.quaternion.copy(streakQuat);
      mesh.scale.set(0.055, s.len * (1 - u * 0.35), 1);
      mat.opacity = (1 - u) * 0.9;
      mat.color.set(u < 0.3 ? SOUL_MARK_COLORS.hotFlash : SOUL_MARK_COLORS.bright);
    }

    // Rune breakup — arms fly outward on ground plane.
    if (runeBreakStarted.current && breakT > 0) {
      const breakEase = easeOutCubic(breakT);
      for (let i = 0; i < 3; i++) {
        const arm = runeArms.current[i];
        const frag = runeFrags.current[i]!;
        const mat = armMats[i]!;
        if (!arm) continue;
        arm.visible = breakT < 0.98;
        const dist = frag.breakDist * breakEase;
        arm.position.set(frag.x + frag.vx * dist, frag.y + Math.sin(SOUL_RUNE_ANGLES[i]!) * dist, 0.004);
        arm.rotation.z = frag.rot + frag.rotV * breakEase * 1.4;
        mat.opacity = Math.max(0, 0.85 * (1 - breakEase));
      }
    }

  });

  return (
    <group ref={group} position={[shot.x, shot.y, shot.z]}>
      {/* Ground rune — implodes then breaks apart */}
      <group
        ref={markGroup}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -shot.y + groundY, 0]}
      >
        <mesh ref={outerRing} geometry={GEO_SOUL_OUTER_RING} material={outerMat} renderOrder={2} />
        <mesh ref={innerRing} geometry={GEO_SOUL_INNER_RING} material={innerMat} renderOrder={3} />
        <mesh ref={centerGlow} geometry={GEO_SOUL_CENTER} material={centerMat} renderOrder={4} />
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            ref={(el) => {
              runeArms.current[i] = el;
            }}
            geometry={GEO_SOUL_RUNE_ARM}
            material={armMats[i]}
            renderOrder={5}
          />
        ))}
      </group>

      {/* Torso-centered layers */}
      <group position={[0, torsoY, 0]} scale={RUPTURE_SCALE}>
        <mesh ref={flashOuter} material={flashOuterMat} renderOrder={9} visible={false}>
          <planeGeometry args={[1, 1]} />
        </mesh>
        <mesh ref={flashInner} material={flashInnerMat} renderOrder={10} visible={false}>
          <planeGeometry args={[1, 1]} />
        </mesh>

        <mesh
          ref={shockRing}
          rotation={[-Math.PI / 2, 0, 0]}
          geometry={GEO_SOUL_SHOCK_RING}
          material={shockMat}
          renderOrder={8}
          visible={false}
        />
        <mesh
          ref={vertRing}
          rotation={[0, 0, 0]}
          geometry={GEO_SOUL_VERT_RING}
          material={vertMat}
          renderOrder={7}
          visible={false}
        />

        {Array.from({ length: STREAK_COUNT }, (_, i) => (
          <mesh
            key={`streak-${i}`}
            ref={(el) => {
              streakRefs.current[i] = el;
            }}
            visible={false}
            material={streakMats[i]}
            renderOrder={6}
          >
            <planeGeometry args={[1, 1]} />
          </mesh>
        ))}

      </group>
    </group>
  );
}
