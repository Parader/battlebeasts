import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { HAND_SHIELD_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { GroundDecal } from "../components/GroundDecal";
import { createCirclePointMaterial } from "../materials/circlePoint";
import { groundPresets } from "../presets/ground";
import { getSmokeTexture } from "../smokeTexture";

const PUFF_COUNT = 7;
const SPRAY_COUNT = 72;
const SHADOW = "#1e3a5f";
const VIOLET = "#3b82f6";
const HOT = "#60a5fa";

/** Instant retaliate burp — no cast windup lead-in. */
const BURP_START_MS = 0;
const SWEEP_MS = 320;

type SprayParticle = {
  alive: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
};

type ShadowPuff = {
  /** −1..1 across the cone. */
  lane: number;
  /** 0..1 delay into the burp. */
  delay: number;
  /** Extra radial scale. */
  scaleMul: number;
  y: number;
  spin: number;
};

function makePuffs(): ShadowPuff[] {
  const out: ShadowPuff[] = [];
  for (let i = 0; i < PUFF_COUNT; i++) {
    const t = i / Math.max(1, PUFF_COUNT - 1);
    out.push({
      lane: (t - 0.5) * 2,
      delay: t * 0.12 + (i % 2) * 0.03,
      scaleMul: 0.85 + (i % 3) * 0.18,
      y: 0.35 + (i % 3) * 0.22,
      spin: (i % 2 === 0 ? 1 : -1) * (0.35 + t * 0.4),
    });
  }
  return out;
}

/**
 * Hand Shield retaliate — blue silence-like cone burp on successful block.
 */
export function HandShieldRetaliateEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const rimOpacity = useRef(1);
  const waveProgress = useRef(0.02);
  const waveOpacity = useRef(0.9);
  const sprayPoints = useRef<THREE.Points>(null);
  const sprayEmitAcc = useRef(0);
  const sprayPool = useRef<SprayParticle[]>([]);
  const sprayCursor = useRef(0);
  const puffMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const puffMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  const range = shot.radius ?? HAND_SHIELD_CAST.retaliateRange;
  const halfAngle = HAND_SHIELD_CAST.retaliateConeHalfAngle;
  const sweepMs = SWEEP_MS;
  const lifeMs = Math.max(BURP_START_MS + sweepMs + 280, shot.life);

  const puffs = useMemo(() => makePuffs(), []);
  const smokeTex = useMemo(() => getSmokeTexture(), []);

  const conePreset = useMemo(
    () => ({
      ...groundPresets.iceFrost,
      element: "poison" as const,
      shape: "cone" as const,
      halfAngle,
      colorCore: HOT,
      colorMid: VIOLET,
      colorEdge: SHADOW,
      opacity: 0.72,
      additive: true,
      radius: range,
      lifeMs,
      ringWidth: 0.1,
      softness: 0.1,
      innerRatio: 0.08,
      breakup: 0.7,
      spin: 0.08,
      appearEnd: 0.02,
      fadeStart: 0.78,
    }),
    [range, halfAngle, lifeMs],
  );

  const sprayPositions = useMemo(() => new Float32Array(SPRAY_COUNT * 3), []);
  const spraySizes = useMemo(() => new Float32Array(SPRAY_COUNT), []);
  const sprayAlphas = useMemo(() => new Float32Array(SPRAY_COUNT), []);
  const sprayGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(sprayPositions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(spraySizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(sprayAlphas, 1));
    return geo;
  }, [sprayPositions, spraySizes, sprayAlphas]);
  const sprayMat = useMemo(() => createCirclePointMaterial(VIOLET), []);

  useEffect(() => {
    sprayPool.current = Array.from({ length: SPRAY_COUNT }, () => ({
      alive: false,
      age: 0,
      life: 0.35,
      x: 0,
      y: -999,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 0.18,
    }));
    return () => {
      sprayGeo.dispose();
      sprayMat.dispose();
    };
  }, [sprayGeo, sprayMat]);

  useFrame((_, dt) => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    const fade = softEnvelope(u, 0.04, 0.72);
    // Ease-out burp: fast push from the body, then soft settle over the cone.
    const burpAge = age - BURP_START_MS;
    const su = Math.max(0, Math.min(1, burpAge / sweepMs));
    const ease = 1 - (1 - su) * (1 - su);
    const burping = burpAge >= 0 && su < 1;
    // Hitbox rim + shadow fill share the same grow curve.
    waveProgress.current = burpAge < 0 ? 0.04 : Math.max(0.08, ease);
    waveOpacity.current = fade * (burpAge < 0 ? 0.15 : 0.95);
    rimOpacity.current = softEnvelope(u, 0.08, 0.62) * (burpAge < 0 ? 0.2 : 1);

    let x = shot.x;
    let z = shot.z;
    let yaw = shot.yaw ?? 0;
    if (shot.followOwnerId && follow?.room) {
      const local =
        follow.localSessionId === shot.followOwnerId ? follow.predictedRef?.current : null;
      if (local) {
        x = local.x;
        z = local.z;
        yaw = local.yaw;
      } else {
        const p = follow.room.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (p) {
          x = p.x ?? x;
          z = p.z ?? z;
          yaw = p.yaw ?? yaw;
        }
      }
    }
    if (root.current) {
      root.current.position.set(x, 0, z);
      root.current.rotation.y = yaw;
    }

    // Soft smoke puffs ride the wave front across the cone.
    for (let i = 0; i < PUFF_COUNT; i++) {
      const puff = puffs[i]!;
      const mesh = puffMeshes.current[i];
      const mat = puffMats.current[i];
      if (!mesh || !mat) continue;
      const local = Math.max(0, Math.min(1, (su - puff.delay) / Math.max(0.001, 1 - puff.delay)));
      if (burpAge < 0 || local <= 0) {
        mesh.visible = false;
        continue;
      }
      const front = ease * range;
      const ang = puff.lane * halfAngle * (0.55 + 0.45 * local);
      const dist = front * (0.35 + 0.55 * local) * (0.75 + Math.abs(puff.lane) * 0.12);
      const sx = Math.sin(ang) * dist;
      const sz = Math.cos(ang) * dist;
      const grow = 0.55 + local * 1.35;
      const s = range * 0.42 * puff.scaleMul * grow;
      const op = fade * (1 - local * local) * (0.55 + (1 - Math.abs(puff.lane)) * 0.25);
      mesh.visible = op > 0.02;
      mesh.position.set(sx, 0.06 + puff.y * 0.08 + local * 0.04, sz);
      mesh.scale.setScalar(s);
      // Flat to ground — spin in yaw so the blot churns as it spreads.
      mesh.rotation.set(-Math.PI / 2, 0, mesh.rotation.z + dt * puff.spin);
      mat.opacity = op;
    }

    // Dense spray from chest — the burp kick into the cone.
    const safeDt = Math.min(0.05, dt);
    if (burping && su < 0.85) {
      sprayEmitAcc.current += safeDt;
      while (sprayEmitAcc.current >= 0.008) {
        sprayEmitAcc.current -= 0.008;
        const p = sprayPool.current[sprayCursor.current % SPRAY_COUNT]!;
        sprayCursor.current++;
        const lane = (Math.random() * 2 - 1) * halfAngle;
        const spd = 6.5 + Math.random() * 5.5;
        p.alive = true;
        p.age = 0;
        p.life = 0.28 + Math.random() * 0.32;
        p.x = Math.sin(lane) * 0.25;
        p.y = 0.85 + Math.random() * 0.35;
        p.z = 0.2 + Math.random() * 0.15;
        p.vx = Math.sin(lane) * spd;
        p.vy = 0.8 + Math.random() * 1.6;
        p.vz = Math.cos(lane) * spd;
        p.size = 0.16 + Math.random() * 0.22;
      }
    } else {
      sprayEmitAcc.current = 0;
    }

    let living = 0;
    for (let i = 0; i < SPRAY_COUNT; i++) {
      const p = sprayPool.current[i];
      if (!p || !p.alive) {
        sprayPositions[i * 3 + 1] = -999;
        spraySizes[i] = 0;
        sprayAlphas[i] = 0;
        continue;
      }
      p.age += safeDt;
      if (p.age >= p.life) {
        p.alive = false;
        sprayPositions[i * 3 + 1] = -999;
        spraySizes[i] = 0;
        sprayAlphas[i] = 0;
        continue;
      }
      const t = p.age / p.life;
      p.x += p.vx * safeDt;
      p.y += p.vy * safeDt;
      p.z += p.vz * safeDt;
      p.vx *= 1 - 1.8 * safeDt;
      p.vz *= 1 - 1.8 * safeDt;
      p.vy -= 2.4 * safeDt;
      // Softly clamp into the cone footprint so spray doesn't overshoot the hitbox.
      const r = Math.hypot(p.x, p.z);
      if (r > range * 1.02) {
        const s = (range * 1.02) / r;
        p.x *= s;
        p.z *= s;
        p.vx *= 0.4;
        p.vz *= 0.4;
      }
      sprayPositions[i * 3] = p.x;
      sprayPositions[i * 3 + 1] = Math.max(0.05, p.y);
      sprayPositions[i * 3 + 2] = p.z;
      spraySizes[i] = p.size * (1.15 - t * 0.55) * 28;
      sprayAlphas[i] = (1 - t) * (1 - t) * fade * 0.95;
      living++;
    }
    sprayGeo.attributes.position!.needsUpdate = true;
    sprayGeo.attributes.aSize!.needsUpdate = true;
    sprayGeo.attributes.aAlpha!.needsUpdate = true;
    if (sprayPoints.current) sprayPoints.current.visible = living > 0;
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]} rotation={[0, shot.yaw ?? 0, 0]}>
      <AoeRimMarker
        radius={range}
        shape="cone"
        halfAngle={halfAngle}
        color="#60a5fa"
        hotColor="#bfdbfe"
        fill={0.06}
        noise={0.25}
        glowWidth={0.05}
        opacity={0.55}
        opacityMulRef={rimOpacity}
        progressRef={waveProgress}
      />

      <GroundDecal
        preset={conePreset}
        shape="cone"
        yaw={0}
        radius={range}
        born={shot.born}
        life={lifeMs}
        progressRef={waveProgress}
        opacityMulRef={waveOpacity}
        growExpand
        y={0.032}
      />

      {puffs.map((puff, i) => (
        <mesh
          key={`puff-${i}`}
          ref={(el) => {
            puffMeshes.current[i] = el;
          }}
          position={[0, puff.y, 0]}
          visible={false}
          renderOrder={3}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={(el) => {
              puffMats.current[i] = el;
            }}
            map={smokeTex}
            color={i % 2 === 0 ? VIOLET : SHADOW}
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      <points
        ref={sprayPoints}
        geometry={sprayGeo}
        material={sprayMat}
        frustumCulled={false}
        visible={false}
      />
    </group>
  );
}
