import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope, smooth01 } from "../easing";

const GREEN = new THREE.Color("#58B879");
const GOLD = new THREE.Color("#A9D978");
const WHITE = new THREE.Color("#F8FFF0");
const OOR_RED = new THREE.Color("#ef4444");

/**
 * Soul Relay — self-cast healing pulse (variant 0).
 * Soft motes spiral inward + brief vertical pulse.
 */
export function SoulRelaySelfHealEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);

  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: GREEN,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  const moteMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: GOLD,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  const MOTE_N = 6;
  const motes = useMemo(
    () =>
      Array.from({ length: MOTE_N }, (_, i) => ({
        angle: (i / MOTE_N) * Math.PI * 2,
        speed: 3.5 + (i % 3) * 0.8,
        y: 0.05 + (i % 2) * 0.04,
      })),
    [],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = 600;
    if (ms >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const age = ms / life;
    const appear = softEnvelope(age, 0.1, 0.5);

    // Ring expands and fades
    const ringScale = 0.3 + age * 0.6;
    ringMat.opacity = 0.35 * appear;

    // Motes spiral inward
    const moteRadius = Math.max(0, 0.6 * (1 - age * 1.2));
    moteMat.opacity = 0.5 * appear;

    const children = g.children;
    if (children[0]) {
      children[0].scale.set(ringScale, ringScale, 1);
      (children[0] as THREE.Mesh).material = ringMat;
    }
    for (let i = 0; i < MOTE_N; i++) {
      const m = children[i + 1];
      if (!m) continue;
      const spec = motes[i];
      const a = spec.angle + (ms / 1000) * spec.speed;
      m.position.set(
        Math.cos(a) * moteRadius,
        spec.y,
        Math.sin(a) * moteRadius,
      );
    }
  });

  return (
    <group ref={root} position={[shot.x, 0.05, shot.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={ringMat}>
        <ringGeometry args={[0.15, 0.35, 20]} />
      </mesh>
      {motes.map((_, i) => (
        <mesh key={i} material={moteMat}>
          <sphereGeometry args={[0.04, 6, 6]} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Soul Relay — ally projectile trail (variant 1).
 * Soft white-gold core with pale green trail from shot origin to originX/Z.
 */
export function SoulRelayProjectileEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);

  const hasTarget =
    typeof shot.originX === "number" &&
    typeof shot.originZ === "number" &&
    Number.isFinite(shot.originX) &&
    Number.isFinite(shot.originZ);
  const tx = hasTarget ? shot.originX! : shot.x;
  const tz = hasTarget ? shot.originZ! : shot.z;
  const dx = tx - shot.x;
  const dz = tz - shot.z;
  const dist = Math.hypot(dx, dz);
  const speed = 20;
  const travelMs = Math.max(80, (dist / speed) * 1000);

  const coreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: WHITE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  const glowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: GREEN,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = travelMs + 200;
    if (ms >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const t = Math.min(1, ms / travelMs);
    const x = shot.x + dx * t;
    const z = shot.z + dz * t;
    g.position.set(x, 1.0, z);

    const fade = t < 0.9 ? 1 : Math.max(0, (1 - t) / 0.1);
    coreMat.opacity = 0.7 * fade;
    glowMat.opacity = 0.3 * fade;
  });

  return (
    <group ref={root} position={[shot.x, 1.0, shot.z]}>
      <mesh material={coreMat}>
        <sphereGeometry args={[0.1, 8, 8]} />
      </mesh>
      <mesh material={glowMat}>
        <sphereGeometry args={[0.28, 8, 8]} />
      </mesh>
    </group>
  );
}

/**
 * Soul Relay — relay trigger secondary heal (variant 2).
 * Relay rune flashes, motes collapse inward, small healing pulse.
 */
export function SoulRelayTriggerEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);

  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: GOLD,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  const moteMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: WHITE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  const MOTE_N = 5;
  const motes = useMemo(
    () =>
      Array.from({ length: MOTE_N }, (_, i) => ({
        angle: (i / MOTE_N) * Math.PI * 2,
        y: 0.04,
      })),
    [],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = 450;
    if (ms >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const age = ms / life;

    // Flash ring
    const flash = smooth01(Math.min(1, ms / 80)) * (1 - smooth01(Math.max(0, (ms - 100) / 250)));
    const ringScale = 0.4 + flash * 0.5;
    ringMat.opacity = 0.5 * flash;

    // Motes collapse inward
    const moteR = Math.max(0, 0.45 * (1 - age * 1.5));
    moteMat.opacity = 0.6 * (1 - age);

    const children = g.children;
    if (children[0]) {
      children[0].scale.set(ringScale, ringScale, 1);
    }
    for (let i = 0; i < MOTE_N; i++) {
      const m = children[i + 1];
      if (!m) continue;
      const spec = motes[i];
      m.position.set(
        Math.cos(spec.angle) * moteR,
        spec.y,
        Math.sin(spec.angle) * moteR,
      );
    }
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={ringMat}>
        <ringGeometry args={[0.2, 0.4, 20]} />
      </mesh>
      {motes.map((_, i) => (
        <mesh key={i} material={moteMat}>
          <sphereGeometry args={[0.035, 6, 6]} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Soul Relay — out-of-range feedback (variant 3).
 * Brief pulse of the cast range ring at the caster's feet.
 */
export function SoulRelayOutOfRangeEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const range = Math.max(2, shot.radius ?? 8.5);

  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: OOR_RED,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = Math.max(400, shot.life ?? 700);
    if (ms >= life) {
      g.visible = false;
      ringMat.opacity = 0;
      return;
    }
    g.visible = true;
    const age = ms / life;
    // Longer tail so the refuse ring eases out instead of cutting off.
    const flash = softEnvelope(age, 0.18, 0.38);
    ringMat.opacity = 0.34 * flash;
    const s = range * (0.97 + flash * 0.03);
    g.scale.set(s, 1, s);
  });

  return (
    <group ref={root} position={[shot.x, 0.03, shot.z]} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={ringMat}>
        <ringGeometry args={[0.995, 1.004, 72]} />
      </mesh>
    </group>
  );
}
