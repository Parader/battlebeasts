import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { GRAVITY_WELL_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope, smooth01 } from "../easing";

const VOID = new THREE.Color("#120B1D");
const DARK = new THREE.Color("#2A173D");
const MAIN = new THREE.Color("#6335A5");
const EDGE = new THREE.Color("#A78BFA");
const FLASH = new THREE.Color("#E9E3FF");

const DELAY = GRAVITY_WELL_CAST.delayedImpactMs;
const MOTE_COUNT = 7;
const STREAK_COUNT = 10;

type Mote = {
  angle: number;
  startR: number;
  y: number;
  spin: number;
};

type Streak = {
  angle: number;
  len: number;
  y: number;
};

/**
 * Gravity Well — seed → inward charge → snap collapse.
 * Timeline locked to server `delayedImpactMs`. Motion is inward, not explosive.
 */
export function GravityWellEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const warp = useRef<THREE.Mesh>(null);
  const shock = useRef<THREE.Mesh>(null);
  const flash = useRef<THREE.Mesh>(null);
  const motes = useRef<(THREE.Mesh | null)[]>([]);
  const streaks = useRef<(THREE.Mesh | null)[]>([]);

  const radius = Math.max(0.8, shot.radius ?? GRAVITY_WELL_CAST.radius);

  const mats = useMemo(() => {
    const mk = (color: THREE.Color, opacity = 0) =>
      new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
    return {
      core: mk(VOID),
      ring: mk(EDGE),
      warp: mk(DARK),
      shock: mk(FLASH),
      flash: mk(FLASH),
      mote: mk(MAIN),
      streak: mk(EDGE),
    };
  }, []);

  const moteDefs = useMemo<Mote[]>(() => {
    const out: Mote[] = [];
    for (let i = 0; i < MOTE_COUNT; i++) {
      const t = i / MOTE_COUNT;
      out.push({
        angle: t * Math.PI * 2 + (i % 3) * 0.21,
        startR: 0.35 + (i % 4) * 0.12,
        y: 0.08 + (i % 3) * 0.04,
        spin: 1.4 + (i % 4) * 0.35,
      });
    }
    return out;
  }, []);

  const streakDefs = useMemo<Streak[]>(() => {
    const out: Streak[] = [];
    for (let i = 0; i < STREAK_COUNT; i++) {
      const t = i / STREAK_COUNT;
      out.push({
        angle: t * Math.PI * 2 + (i % 2) * 0.11,
        len: 0.55 + (i % 4) * 0.12,
        y: 0.1 + (i % 3) * 0.05,
      });
    }
    return out;
  }, []);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = Math.max(DELAY + 320, shot.life ?? GRAVITY_WELL_CAST.vfxLifeMs);
    if (ms >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const place = smooth01(ms / 90);
    const chargeT = ms < 60 ? 0 : smooth01((ms - 60) / Math.max(1, DELAY - 80));
    const warnStart = DELAY - 70;
    const warn = ms < warnStart ? 0 : smooth01((ms - warnStart) / 70);
    const detMs = ms - DELAY;
    const detonating = detMs >= 0;
    const coreFlash =
      detonating && detMs < 55 ? softEnvelope(detMs / 55, 0.1, 0.38) : 0;
    const shockT =
      detonating && detMs >= 8 && detMs < 160
        ? smooth01((detMs - 8) / 150)
        : detonating && detMs >= 160
          ? 1
          : 0;
    const shockFade =
      detonating && detMs >= 8
        ? softEnvelope(Math.min(1, (detMs - 8) / 150), 0.08, 0.4)
        : 0;
    const streakT =
      detonating && detMs >= 5 ? Math.min(1, (detMs - 5) / 140) : 0;
    const fadeOut = detonating ? 1 - Math.min(1, Math.max(0, (detMs - 80) / 280)) : 1;

    // Ring contracts during charge (suck), then thin shock at detonation.
    const ringScale = detonating
      ? THREE.MathUtils.lerp(0.42, 1.05, shockT)
      : THREE.MathUtils.lerp(0.72, 0.28, chargeT * 0.85 + warn * 0.15);

    if (core.current) {
      const pinch = detonating
        ? THREE.MathUtils.lerp(1, 0.15, Math.min(1, detMs / 35))
        : 1 - chargeT * 0.12 - warn * 0.2;
      const coreScale =
        (0.09 + chargeT * 0.035 + warn * 0.05 + coreFlash * 0.42) * place * pinch;
      core.current.scale.setScalar(coreScale * radius * 0.55);
      mats.core.color.copy(VOID).lerp(FLASH, coreFlash * 0.85);
      mats.core.opacity =
        (0.7 + chargeT * 0.15 + warn * 0.2 + coreFlash * 0.5) * place * fadeOut;
    }

    if (ring.current) {
      ring.current.scale.setScalar(ringScale * radius * 0.95);
      ring.current.rotation.z = ms * 0.0022 * (1 + chargeT * 2.2);
      mats.ring.color.copy(MAIN).lerp(EDGE, chargeT * 0.55 + warn * 0.35);
      mats.ring.opacity =
        (0.18 + chargeT * 0.28 + warn * 0.22 + coreFlash * 0.35) *
        place *
        (detonating ? shockFade * 0.85 + (1 - Math.min(1, detMs / 90)) * 0.4 : 1) *
        fadeOut;
    }

    if (warp.current) {
      const warpScale = detonating
        ? THREE.MathUtils.lerp(0.55, 0.2, Math.min(1, detMs / 50))
        : THREE.MathUtils.lerp(0.9, 0.4, chargeT);
      warp.current.scale.setScalar(warpScale * radius * 0.7);
      warp.current.rotation.z = -ms * 0.0014 * (1 + chargeT);
      mats.warp.opacity =
        (0.12 + chargeT * 0.18 + warn * 0.12) * place * fadeOut;
    }

    if (flash.current) {
      const show = coreFlash > 0.02;
      flash.current.visible = show;
      if (show) {
        flash.current.scale.setScalar((0.2 + coreFlash * 0.55) * radius * 0.5);
        mats.flash.opacity = coreFlash * 0.85 * fadeOut;
      }
    }

    if (shock.current) {
      const show = detonating && detMs < 180;
      shock.current.visible = show;
      if (show) {
        shock.current.scale.setScalar(
          THREE.MathUtils.lerp(0.25, 1.15, shockT) * radius * 0.85,
        );
        mats.shock.opacity = shockFade * 0.55 * fadeOut;
      }
    }

    for (let i = 0; i < moteDefs.length; i++) {
      const mesh = motes.current[i];
      if (!mesh) continue;
      const def = moteDefs[i]!;
      const show = !detonating || detMs < 45;
      mesh.visible = show && place > 0.05;
      if (!show) continue;
      const suck = chargeT * 0.75 + warn * 0.25;
      const r = def.startR * radius * (1 - suck * 0.82);
      const ang = def.angle + ms * 0.001 * def.spin * (1 + chargeT * 2.5);
      mesh.position.set(Math.cos(ang) * r, def.y, Math.sin(ang) * r);
      const s = 0.04 + chargeT * 0.025 + warn * 0.02;
      mesh.scale.setScalar(s * radius * 0.35);
      mats.mote.opacity =
        (0.35 + chargeT * 0.35 + warn * 0.25) *
        place *
        (detonating ? 1 - detMs / 45 : 1);
    }

    for (let i = 0; i < streakDefs.length; i++) {
      const mesh = streaks.current[i];
      if (!mesh) continue;
      const def = streakDefs[i]!;
      const show = detonating && streakT > 0 && detMs < 200;
      mesh.visible = show;
      if (!show) continue;
      const startR = radius * 0.95;
      const endR = radius * 0.08;
      const r = THREE.MathUtils.lerp(startR, endR, streakT);
      const ang = def.angle;
      const cx = Math.cos(ang) * r;
      const cz = Math.sin(ang) * r;
      mesh.position.set(cx * 0.5, def.y, cz * 0.5);
      mesh.rotation.y = -ang + Math.PI / 2;
      const stretch = THREE.MathUtils.lerp(def.len, 0.12, streakT);
      mesh.scale.set(0.035 * radius * 0.4, 0.035, stretch * radius * 0.45);
      mats.streak.opacity =
        softEnvelope(Math.min(1, detMs / 40), 0.1, 0.35) *
        (1 - Math.min(1, Math.max(0, (detMs - 90) / 110))) *
        0.75;
    }
  });

  return (
    <group ref={root} position={[shot.x, shot.y ?? 0.03, shot.z]}>
      <mesh ref={warp} rotation={[-Math.PI / 2, 0, 0]} renderOrder={18}>
        <ringGeometry args={[0.55, 1, 48]} />
        <primitive object={mats.warp} attach="material" />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={19}>
        <ringGeometry args={[0.78, 1, 56]} />
        <primitive object={mats.ring} attach="material" />
      </mesh>
      <mesh ref={core} position={[0, 0.12, 0]} renderOrder={22}>
        <sphereGeometry args={[1, 16, 12]} />
        <primitive object={mats.core} attach="material" />
      </mesh>
      <mesh ref={flash} position={[0, 0.12, 0]} renderOrder={23}>
        <sphereGeometry args={[1, 12, 10]} />
        <primitive object={mats.flash} attach="material" />
      </mesh>
      <mesh ref={shock} rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
        <ringGeometry args={[0.88, 1, 64]} />
        <primitive object={mats.shock} attach="material" />
      </mesh>
      {moteDefs.map((_, i) => (
        <mesh
          key={`mote-${i}`}
          ref={(el) => {
            motes.current[i] = el;
          }}
          renderOrder={21}
        >
          <sphereGeometry args={[1, 8, 6]} />
          <primitive object={mats.mote} attach="material" />
        </mesh>
      ))}
      {streakDefs.map((_, i) => (
        <mesh
          key={`streak-${i}`}
          ref={(el) => {
            streaks.current[i] = el;
          }}
          renderOrder={21}
        >
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={mats.streak} attach="material" />
        </mesh>
      ))}
    </group>
  );
}
