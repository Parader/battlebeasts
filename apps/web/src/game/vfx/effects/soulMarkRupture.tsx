import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { smooth01 } from "../easing";
import { createCirclePointMaterial, createSmokePointMaterial, getVfxCircleTexture } from "../materials/circlePoint";
import { acquireEnergyRingMaterial } from "../materials/energyBall";
import { useSpellLight } from "../spellLights";
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
const RESIDUE_START_MS = 280;
const VERT_RING_DELAY_MS = 25;
const RUNE_BREAK_MS = 180;

const IMPLODE_PARTICLE_COUNT = 8;
const INWARD_WISP_COUNT = 3;
const STREAK_COUNT = 12;
const SHADOW_WISP_COUNT = 5;
const RESIDUE_MOTE_COUNT = 3;

/** Shock ring geo outer radius — used to convert target world radius → scale. */
const SHOCK_OUTER_R = 0.17;
const VERT_OUTER_R = 0.11;

type ImplodeParticle = {
  x: number;
  y: number;
  z: number;
  speed: number;
};

type Streak = {
  active: boolean;
  born: number;
  life: number;
  dir: THREE.Vector3;
  speed: number;
  len: number;
};

type ShadowWisp = {
  active: boolean;
  born: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  size: number;
  dark: boolean;
};

type ResidueMote = {
  active: boolean;
  born: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vy: number;
  size: number;
  smoke: boolean;
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
 * Soul Rupture — layered psychic burst: implode → snap → rings/streaks/wisps → residue.
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
  const residueSpawned = useRef(false);

  const implodeParticles = useRef<ImplodeParticle[]>(
    Array.from({ length: IMPLODE_PARTICLE_COUNT }, () => {
      const ang = Math.random() * Math.PI * 2;
      const elev = (Math.random() - 0.3) * 1.2;
      const r = 0.45 + Math.random() * 0.35;
      return {
        x: Math.cos(ang) * r,
        y: 0.35 + elev * 0.4,
        z: Math.sin(ang) * r,
        speed: 2.2 + Math.random() * 1.8,
      };
    }),
  );

  const inwardWispPos = useMemo(() => new Float32Array(INWARD_WISP_COUNT * 3), []);
  const inwardWispAlpha = useMemo(() => new Float32Array(INWARD_WISP_COUNT), []);
  const inwardWispSize = useMemo(() => new Float32Array(INWARD_WISP_COUNT), []);
  const inwardWispGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(inwardWispPos, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(inwardWispAlpha, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(inwardWispSize, 1));
    return geo;
  }, [inwardWispPos, inwardWispAlpha, inwardWispSize]);
  const inwardWispMat = useMemo(() => createCirclePointMaterial(SOUL_MARK_COLORS.primary), []);

  const implodePos = useMemo(() => new Float32Array(IMPLODE_PARTICLE_COUNT * 3), []);
  const implodeAlpha = useMemo(() => new Float32Array(IMPLODE_PARTICLE_COUNT), []);
  const implodeSize = useMemo(() => new Float32Array(IMPLODE_PARTICLE_COUNT), []);
  const implodeGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(implodePos, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(implodeAlpha, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(implodeSize, 1));
    return geo;
  }, [implodePos, implodeAlpha, implodeSize]);
  const implodeMat = useMemo(() => createCirclePointMaterial(SOUL_MARK_COLORS.deepViolet), []);

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

  const shadowWisps = useRef<ShadowWisp[]>(
    Array.from({ length: SHADOW_WISP_COUNT }, () => ({
      active: false,
      born: 0,
      life: 0.3,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      spin: 0,
      size: 0.1,
      dark: false,
    })),
  );
  const shadowPos = useMemo(() => new Float32Array(SHADOW_WISP_COUNT * 3), []);
  const shadowAlpha = useMemo(() => new Float32Array(SHADOW_WISP_COUNT), []);
  const shadowSize = useMemo(() => new Float32Array(SHADOW_WISP_COUNT), []);
  const shadowGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(shadowPos, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(shadowAlpha, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(shadowSize, 1));
    return geo;
  }, [shadowPos, shadowAlpha, shadowSize]);
  const shadowMat = useMemo(() => createSmokePointMaterial(SOUL_MARK_COLORS.darkCore), []);

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

  const residueMotos = useRef<ResidueMote[]>(
    Array.from({ length: RESIDUE_MOTE_COUNT + 1 }, () => ({
      active: false,
      born: 0,
      life: 0.2,
      x: 0,
      y: 0,
      z: 0,
      vy: 0.4,
      size: 0.03,
      smoke: false,
    })),
  );
  const residuePos = useMemo(() => new Float32Array((RESIDUE_MOTE_COUNT + 1) * 3), []);
  const residueAlpha = useMemo(() => new Float32Array(RESIDUE_MOTE_COUNT + 1), []);
  const residueSize = useMemo(() => new Float32Array(RESIDUE_MOTE_COUNT + 1), []);
  const residueGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(residuePos, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(residueAlpha, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(residueSize, 1));
    return geo;
  }, [residuePos, residueAlpha, residueSize]);
  const residueSmokePos = useMemo(() => new Float32Array(3), []);
  const residueSmokeAlpha = useMemo(() => new Float32Array(1), []);
  const residueSmokeSize = useMemo(() => new Float32Array(1), []);
  const residueSmokeGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(residueSmokePos, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(residueSmokeAlpha, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(residueSmokeSize, 1));
    return geo;
  }, [residueSmokePos, residueSmokeAlpha, residueSmokeSize]);
  const residueBrightMat = useMemo(() => createCirclePointMaterial(SOUL_MARK_COLORS.primary), []);
  const residueSmokeMat = useMemo(() => createSmokePointMaterial(SOUL_MARK_COLORS.shadowWisp), []);

  const groundY = 0.03;
  const torsoY = 0;

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

    // Implosion inward particles.
    for (let i = 0; i < IMPLODE_PARTICLE_COUNT; i++) {
      const p = implodeParticles.current[i]!;
      if (ms > IMPLODE_MS + 20) {
        implodeAlpha[i] = 0;
        continue;
      }
      const dist = Math.max(0, 1 - (implodeT * p.speed) / 2.5);
      const px = p.x * dist;
      const py = p.y * dist;
      const pz = p.z * dist;
      implodePos[i * 3] = px;
      implodePos[i * 3 + 1] = py;
      implodePos[i * 3 + 2] = pz;
      implodeSize[i] = (0.03 + (1 - dist) * 0.02) * 36;
      implodeAlpha[i] = (1 - implodeT) * 0.7;
    }
    implodeGeo.attributes.position!.needsUpdate = true;
    implodeGeo.attributes.aAlpha!.needsUpdate = true;
    implodeGeo.attributes.aSize!.needsUpdate = true;

    // Stack wisps accelerate inward during implosion.
    for (let i = 0; i < INWARD_WISP_COUNT; i++) {
      const ang = SOUL_RUNE_ANGLES[i]!;
      const startR = 0.62;
      const r = startR * (1 - easeOutCubic(implodeT));
      const h = THREE.MathUtils.lerp(0.45, 0.15, implodeT);
      inwardWispPos[i * 3] = Math.cos(ang) * r;
      inwardWispPos[i * 3 + 1] = h;
      inwardWispPos[i * 3 + 2] = Math.sin(ang) * r;
      inwardWispSize[i] = 0.04 * 36;
      inwardWispAlpha[i] = ms < IMPLODE_MS + 30 ? 0.55 * (1 - implodeT * 0.5) : 0;
    }
    inwardWispGeo.attributes.position!.needsUpdate = true;
    inwardWispGeo.attributes.aAlpha!.needsUpdate = true;
    inwardWispGeo.attributes.aSize!.needsUpdate = true;

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
      for (let i = 0; i < SHADOW_WISP_COUNT; i++) {
        const w = shadowWisps.current[i]!;
        w.active = true;
        w.born = now;
        w.life = 0.22 + Math.random() * 0.12;
        const ang = Math.random() * Math.PI * 2;
        w.x = Math.cos(ang) * 0.08;
        w.y = 0.1 + Math.random() * 0.2;
        w.z = Math.sin(ang) * 0.08;
        w.vx = Math.cos(ang) * (0.4 + Math.random() * 0.5);
        w.vy = 0.35 + Math.random() * 0.45;
        w.vz = Math.sin(ang) * (0.4 + Math.random() * 0.5);
        w.spin = (Math.random() - 0.5) * 3;
        w.size = 0.08 + Math.random() * 0.06;
        w.dark = i % 2 === 0;
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

    // Layer D — shadow wisps (normal blend).
    let si = 0;
    for (const w of shadowWisps.current) {
      if (!w.active) continue;
      const age = (now - w.born) / 1000;
      if (age >= w.life) {
        w.active = false;
        continue;
      }
      const u = age / w.life;
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      w.z += w.vz * dt;
      w.vy += dt * 0.35;
      w.vx *= 1 - dt * 0.4;
      w.vz *= 1 - dt * 0.4;
      if (si < SHADOW_WISP_COUNT) {
        shadowPos[si * 3] = w.x;
        shadowPos[si * 3 + 1] = w.y;
        shadowPos[si * 3 + 2] = w.z;
        shadowSize[si] = w.size * (1 + u * 0.5) * 36;
        shadowAlpha[si] = (1 - u) * 0.7;
        si++;
      }
    }
    for (let i = si; i < SHADOW_WISP_COUNT; i++) shadowAlpha[i] = 0;
    shadowGeo.attributes.position!.needsUpdate = true;
    shadowGeo.attributes.aAlpha!.needsUpdate = true;
    shadowGeo.attributes.aSize!.needsUpdate = true;

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

    // ── 5. Residue — tiny motes + smoke puff ──
    if (ms >= RESIDUE_START_MS && !residueSpawned.current) {
      residueSpawned.current = true;
      const t0 = performance.now();
      for (let i = 0; i < RESIDUE_MOTE_COUNT; i++) {
        const m = residueMotos.current[i]!;
        m.active = true;
        m.born = t0;
        m.life = 0.15 + Math.random() * 0.1;
        m.smoke = false;
        m.x = (Math.random() - 0.5) * 0.25;
        m.y = 0.2 + Math.random() * 0.35;
        m.z = (Math.random() - 0.5) * 0.25;
        m.vy = 0.25 + Math.random() * 0.3;
        m.size = 0.02 + Math.random() * 0.015;
      }
      const smoke = residueMotos.current[RESIDUE_MOTE_COUNT]!;
      smoke.active = true;
      smoke.born = t0;
      smoke.life = 0.2 + Math.random() * 0.05;
      smoke.smoke = true;
      smoke.x = (Math.random() - 0.5) * 0.15;
      smoke.y = 0.15;
      smoke.z = (Math.random() - 0.5) * 0.15;
      smoke.vy = 0.18;
      smoke.size = 0.07;
    }

    let ri = 0;
    for (const m of residueMotos.current) {
      if (!m.active || m.smoke) continue;
      const age = (now - m.born) / 1000;
      if (age >= m.life) {
        m.active = false;
        continue;
      }
      m.y += m.vy * dt;
      const u = age / m.life;
      const fade = 1 - u;
      if (ri < RESIDUE_MOTE_COUNT) {
        residuePos[ri * 3] = m.x;
        residuePos[ri * 3 + 1] = m.y;
        residuePos[ri * 3 + 2] = m.z;
        residueSize[ri] = m.size * 36;
        residueAlpha[ri] = fade * 0.35;
        ri++;
      }
    }
    for (let i = ri; i < RESIDUE_MOTE_COUNT; i++) residueAlpha[i] = 0;

    const smokeMote = residueMotos.current[RESIDUE_MOTE_COUNT];
    let smokeAlphaVal = 0;
    let smokeX = 0;
    let smokeY = 0;
    let smokeZ = 0;
    let smokeSz = 0;
    if (smokeMote?.active) {
      const age = (now - smokeMote.born) / 1000;
      if (age >= smokeMote.life) {
        smokeMote.active = false;
      } else {
        smokeMote.y += smokeMote.vy * dt;
        const u = age / smokeMote.life;
        smokeX = smokeMote.x;
        smokeY = smokeMote.y;
        smokeZ = smokeMote.z;
        smokeSz = smokeMote.size * 1.5 * 36;
        smokeAlphaVal = (1 - u) * 0.45;
      }
    }

    if (residueSpawned.current) {
      residueGeo.attributes.position!.needsUpdate = true;
      residueGeo.attributes.aAlpha!.needsUpdate = true;
      residueGeo.attributes.aSize!.needsUpdate = true;
      residueSmokePos[0] = smokeX;
      residueSmokePos[1] = smokeY;
      residueSmokePos[2] = smokeZ;
      residueSmokeSize[0] = smokeSz;
      residueSmokeAlpha[0] = smokeAlphaVal;
      residueSmokeGeo.attributes.position!.needsUpdate = true;
      residueSmokeGeo.attributes.aAlpha!.needsUpdate = true;
      residueSmokeGeo.attributes.aSize!.needsUpdate = true;
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

        <points geometry={implodeGeo} material={implodeMat} renderOrder={5} />
        <points geometry={inwardWispGeo} material={inwardWispMat} renderOrder={4} />
        <points geometry={shadowGeo} material={shadowMat} renderOrder={3} />
        <points geometry={residueGeo} material={residueBrightMat} renderOrder={2} />
        <points geometry={residueSmokeGeo} material={residueSmokeMat} renderOrder={1} />
      </group>
    </group>
  );
}
