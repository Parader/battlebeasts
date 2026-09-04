import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ARC_THREAD_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { findHandBone } from "../attach";
import { getCharacterRoot } from "../../characterRoots";
import { smooth01 } from "../easing";
import { createCirclePointMaterial } from "../materials/circlePoint";
import { acquireEnergyBallMaterial } from "../materials/energyBall";
import { GEO_SPHERE_HI, GEO_SPHERE_MD } from "../sharedGeo";

/** Electric blues — core / arc / tip. */
const FILAMENT = "#38bdf8";
const ARC_HOT = "#67e8f9";
const SPARK = "#bae6fd";
const CORE = "#e0f2fe";
const HAND_Y = ARC_THREAD_CAST.handY;
const TARGET_Y = 1.15;
const SPAWN = ARC_THREAD_CAST.spawnOffset;
/** Nudge filament off the palm center toward the fingers. */
const HAND_PUSH = 0.06;

const SEGMENTS = 18;
/** Tiny crackle motes along the tether. */
const LINK_SPARKS = 16;
/** Tight pole-style spark pop on discharge. */
const BURST_COUNT = 36;
/** Short contact forks at discharge. */
const FORK_COUNT = 5;
const FORK_SEGS = 4;
/** Point-sprite scale — keep pinprick, not soft blobs. */
const POINT_PX = 11;

type Pose = { x: number; z: number; yaw: number };

function readPose(
  follow: VfxFollowContext | undefined,
  id: string | undefined,
  fallback: Pose,
): Pose {
  if (!id || !follow?.room?.state) return fallback;
  if (id === follow.localSessionId && follow.predictedRef) {
    const p = follow.predictedRef.current;
    return { x: p.x, z: p.z, yaw: p.yaw };
  }
  const player = follow.room.state.players?.get(id) as
    | { x?: number; z?: number; yaw?: number }
    | undefined;
  if (player) {
    return { x: player.x ?? 0, z: player.z ?? 0, yaw: player.yaw ?? 0 };
  }
  const target = follow.room.state.targets?.get(id) as
    | { x?: number; z?: number }
    | undefined;
  if (target) {
    return { x: target.x ?? 0, z: target.z ?? 0, yaw: fallback.yaw };
  }
  return fallback;
}

type BurstP = {
  dirX: number;
  dirY: number;
  dirZ: number;
  speed: number;
  size: number;
  sizeEnd: number;
  delay: number;
  life: number;
  flicker: number;
};

type Fork = {
  dirX: number;
  dirY: number;
  dirZ: number;
  length: number;
  seed: number;
};

/**
 * Magical filament tether — jagged line + electrical motes.
 * Origin prefers the caster's right-hand bone; falls back to yaw + spawnOffset.
 *
 * Connected (variant 0): link snap → charge filament.
 * Discharge (variant 1): link gone — tight pole-style spark crackle on the target.
 * Break (variant 2): filament frays + small dissipating sparks.
 */
export function ArcThreadEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const linkPts = useRef<THREE.Points>(null);
  const burstPts = useRef<THREE.Points>(null);
  const tipCore = useRef<THREE.Mesh>(null);
  const tipGlow = useRef<THREE.Mesh>(null);
  const forksGroup = useRef<THREE.Group>(null);
  const handWorld = useRef(new THREE.Vector3());

  const isDischarge = shot.variant === 1;
  const isBreak = shot.variant === 2;
  /** No linked target — filament terminates at aim endpoint (x2/z2 or max range). */
  const isAir = !shot.followTargetId && !isDischarge && !isBreak;
  const seed = useMemo(() => (shot.key % 97) / 97, [shot.key]);

  const linePositions = useMemo(() => new Float32Array((SEGMENTS + 1) * 3), []);
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
    return g;
  }, [linePositions]);
  const lineMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: FILAMENT,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const lineObj = useMemo(() => new THREE.Line(lineGeo, lineMat), [lineGeo, lineMat]);

  const linkPos = useMemo(() => new Float32Array(LINK_SPARKS * 3), []);
  const linkSize = useMemo(() => new Float32Array(LINK_SPARKS), []);
  const linkAlpha = useMemo(() => new Float32Array(LINK_SPARKS), []);
  const linkGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(linkPos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(linkSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(linkAlpha, 1));
    return g;
  }, [linkPos, linkSize, linkAlpha]);
  const linkMat = useMemo(() => createCirclePointMaterial(ARC_HOT), []);

  const burstPos = useMemo(() => new Float32Array(BURST_COUNT * 3), []);
  const burstSize = useMemo(() => new Float32Array(BURST_COUNT), []);
  const burstAlpha = useMemo(() => new Float32Array(BURST_COUNT), []);
  const burstGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(burstPos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(burstSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(burstAlpha, 1));
    return g;
  }, [burstPos, burstSize, burstAlpha]);
  const burstMat = useMemo(() => createCirclePointMaterial(SPARK), []);

  const tipCoreMat = useMemo(() => acquireEnergyBallMaterial(CORE, 0), []);
  const tipGlowMat = useMemo(() => acquireEnergyBallMaterial(ARC_HOT, 0), []);

  const burstParts = useMemo((): BurstP[] => {
    const list: BurstP[] = [];
    for (let i = 0; i < BURST_COUNT; i++) {
      const u = (i + seed * 7) / BURST_COUNT;
      const yaw = u * Math.PI * 2 + seed * 5.1 + (i % 3) * 0.55;
      // Mostly horizontal spray — transformer crackle, not a fireball.
      const pitch = (Math.sin(i * 2.1 + seed * 11) * 0.35 + 0.05) * Math.PI * 0.35;
      const cy = Math.cos(pitch);
      const hot = i % 6 === 0;
      list.push({
        dirX: Math.sin(yaw) * cy,
        dirY: Math.sin(pitch) * 0.55 + 0.08,
        dirZ: Math.cos(yaw) * cy,
        speed: (hot ? 1.35 : 0.75) + (i % 5) * 0.1 + seed * 0.18,
        size: hot ? 0.18 : 0.09 + (i % 4) * 0.022,
        sizeEnd: hot ? 0.04 : 0.022,
        delay: (i % 10) * 0.008,
        life: 0.14 + (i % 5) * 0.035,
        flicker: 10 + (i % 5) * 3.5,
      });
    }
    return list;
  }, [seed]);

  const forks = useMemo((): Fork[] => {
    const list: Fork[] = [];
    for (let i = 0; i < FORK_COUNT; i++) {
      const yaw = (i / FORK_COUNT) * Math.PI * 2 + seed * 3;
      const pitch = 0.05 + (i % 3) * 0.12;
      const cy = Math.cos(pitch);
      list.push({
        dirX: Math.sin(yaw) * cy,
        dirY: Math.sin(pitch) * 0.45 + 0.12,
        dirZ: Math.cos(yaw) * cy,
        length: 0.22 + (i % 3) * 0.08,
        seed: seed * 10 + i * 1.7,
      });
    }
    return list;
  }, [seed]);

  const forkGeos = useMemo(
    () =>
      forks.map(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          "position",
          new THREE.BufferAttribute(new Float32Array((FORK_SEGS + 1) * 3), 3),
        );
        return g;
      }),
    [forks],
  );
  const forkMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: ARC_HOT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const forkMats = useMemo(
    () => forks.map(() => forkMat.clone()),
    [forks, forkMat],
  );
  const forkLines = useMemo(
    () => forkGeos.map((geo, i) => new THREE.Line(geo, forkMats[i]!)),
    [forkGeos, forkMats],
  );

  useEffect(() => {
    return () => {
      lineGeo.dispose();
      lineMat.dispose();
      linkGeo.dispose();
      linkMat.dispose();
      burstGeo.dispose();
      burstMat.dispose();
      tipCoreMat.dispose();
      tipGlowMat.dispose();
      for (const g of forkGeos) g.dispose();
      for (const m of forkMats) m.dispose();
      forkMat.dispose();
    };
  }, [
    lineGeo,
    lineMat,
    linkGeo,
    linkMat,
    burstGeo,
    burstMat,
    tipCoreMat,
    tipGlowMat,
    forkGeos,
    forkMats,
    forkMat,
  ]);

  useFrame(() => {
    const age = performance.now() - shot.born;
    const life = Math.max(16, shot.life);
    const t = Math.min(1, age / life);
    const ageSec = age * 0.001;

    const owner = readPose(follow, shot.followOwnerId, {
      x: shot.x,
      z: shot.z,
      yaw: shot.yaw,
    });
    const airRange = shot.radius ?? ARC_THREAD_CAST.range;
    const airFallback =
      typeof shot.originX === "number" && typeof shot.originZ === "number"
        ? { x: shot.originX, z: shot.originZ, yaw: owner.yaw }
        : {
            x: owner.x + Math.sin(owner.yaw) * airRange,
            z: owner.z + Math.cos(owner.yaw) * airRange,
            yaw: owner.yaw,
          };
    const target = isAir
      ? airFallback
      : readPose(follow, shot.followTargetId, {
          x: shot.originX ?? shot.x,
          z: shot.originZ ?? shot.z,
          yaw: owner.yaw,
        });

    const fx = Math.sin(owner.yaw);
    const fz = Math.cos(owner.yaw);
    let hx = owner.x + fx * SPAWN;
    let hy = HAND_Y;
    let hz = owner.z + fz * SPAWN;
    // Prefer the casting hand bone so the filament tracks the punch pose.
    const charRoot = getCharacterRoot(shot.followOwnerId);
    const hand = charRoot ? findHandBone(charRoot, "right") : null;
    if (hand) {
      hand.getWorldPosition(handWorld.current);
      hx = handWorld.current.x + fx * HAND_PUSH;
      hy = handWorld.current.y;
      hz = handWorld.current.z + fz * HAND_PUSH;
    }
    const tx = target.x;
    const ty = TARGET_Y;
    const tz = target.z;

    const dx = tx - hx;
    const dy = ty - hy;
    const dz = tz - hz;
    const len = Math.hypot(dx, dy, dz) || 0.01;
    const lx = -dz / len;
    const lz = dx / len;

    let draw = 1;
    let amp = 0.04;
    let lineOpacity = 0.75;
    let tipOpacity = 0;
    let tipScale = 0.06;
    let showFilament = true;

    if (isDischarge) {
      showFilament = false;
      draw = 0;
      lineOpacity = 0;
      tipOpacity = softPulse(Math.min(1, t / 0.18)) * (1 - smooth01(Math.max(0, (t - 0.12) / 0.4)));
      tipScale = 0.055 + tipOpacity * 0.09;
    } else if (isBreak || (isAir && t > 0.72)) {
      const frayT = isBreak ? t : (t - 0.72) / 0.28;
      draw = Math.max(0, 1 - frayT * 1.4);
      amp = 0.1 * (1 - frayT);
      lineOpacity = 0.55 * (1 - frayT);
      tipOpacity = 0.25 * (1 - frayT);
      tipScale = 0.03 + 0.025 * (1 - frayT);
    } else {
      const linkT = Math.min(1, age / 90);
      draw = smooth01(linkT);
      const charge = smooth01(Math.max(0, (age - 90) / Math.max(16, life - 90)));
      amp = 0.025 + charge * 0.055;
      lineOpacity = 0.55 + charge * 0.35;
      tipOpacity = linkT < 1 ? softPulse(linkT) * 0.7 : 0.1 + charge * 0.22;
      tipScale = linkT < 1 ? 0.04 + (1 - linkT) * 0.035 : 0.028 + charge * 0.02;
      if (!isAir && t > 0.8) {
        const surge = smooth01((t - 0.8) / 0.2);
        lineOpacity = Math.min(1, lineOpacity + surge * 0.35);
        amp *= 1 + surge * 0.8;
        tipOpacity = Math.min(1, tipOpacity + surge * 0.35);
      }
    }

    if (showFilament) {
      for (let i = 0; i <= SEGMENTS; i++) {
        const u = i / SEGMENTS;
        const along = Math.min(u, draw);
        const zig =
          i === 0 || i === SEGMENTS
            ? 0
            : Math.sin(i * 2.3 + seed * 6 + age * 0.028) *
              amp *
              (0.35 + Math.sin(age * 0.05 + i) * 0.65);
        const side = (i % 2 === 0 ? 1 : -1) * zig;
        linePositions[i * 3] = hx + dx * along + lx * side;
        linePositions[i * 3 + 1] = hy + dy * along + Math.sin(i * 1.7 + age * 0.04) * amp * 0.35;
        linePositions[i * 3 + 2] = hz + dz * along + lz * side;
      }
      lineGeo.attributes.position!.needsUpdate = true;
      lineMat.opacity = lineOpacity;
      lineMat.color.set(FILAMENT);
      lineObj.visible = draw > 0.02 && lineOpacity > 0.02;
    } else {
      lineObj.visible = false;
    }

    // Along-thread electrical motes (connected / break).
    if (linkPts.current) {
      if (isDischarge) {
        linkPts.current.visible = false;
      } else {
        const density = isBreak || (isAir && t > 0.72) ? 1 - t : 0.35 + t * 0.65;
        let living = 0;
        for (let i = 0; i < LINK_SPARKS; i++) {
          const u = ((i + 0.5) / LINK_SPARKS) * draw;
          const flicker = 0.55 + 0.45 * Math.sin(age * 0.08 + i * 2.1 + seed * 4);
          const alive = u <= draw && density > 0.05 && flicker > 0.25;
          if (!alive) {
            linkPos[i * 3 + 1] = -999;
            linkSize[i] = 0;
            linkAlpha[i] = 0;
            continue;
          }
          const jig = Math.sin(age * 0.11 + i * 2.4) * amp * 1.2;
          linkPos[i * 3] = hx + dx * u + lx * jig;
          linkPos[i * 3 + 1] = hy + dy * u + Math.cos(age * 0.09 + i) * 0.02;
          linkPos[i * 3 + 2] = hz + dz * u + lz * jig;
          const hot = i % 5 === 0;
          linkSize[i] =
            (hot ? 0.055 : 0.028 + (i % 3) * 0.008) * (0.75 + density * 0.25) * POINT_PX;
          linkAlpha[i] =
            density * flicker * (isBreak || (isAir && t > 0.72) ? 1 - t : 1) * (hot ? 1 : 0.7);
          living++;
        }
        linkGeo.attributes.position!.needsUpdate = true;
        linkGeo.attributes.aSize!.needsUpdate = true;
        linkGeo.attributes.aAlpha!.needsUpdate = true;
        linkPts.current.visible = living > 0;
      }
    }

    // Target electrical spark burst.
    if (burstPts.current) {
      if (isDischarge || isBreak) {
        const burstScale = isBreak ? 0.4 : 1;
        let living = 0;
        for (let i = 0; i < BURST_COUNT; i++) {
          const p = burstParts[i]!;
          const localAge = ageSec - p.delay;
          if (localAge < 0 || localAge >= p.life) {
            burstPos[i * 3 + 1] = -999;
            burstSize[i] = 0;
            burstAlpha[i] = 0;
            continue;
          }
          const pt = localAge / p.life;
          const appear = smooth01(Math.min(1, pt / 0.06));
          const fade = 1 - pt;
          // Snap travel — short hop, then die (pole crackle).
          const dist = p.speed * Math.min(1, pt * 1.35) * burstScale;
          const drop = pt * pt * 0.08 * burstScale;
          burstPos[i * 3] = tx + p.dirX * dist;
          burstPos[i * 3 + 1] = ty + p.dirY * dist - drop;
          burstPos[i * 3 + 2] = tz + p.dirZ * dist;
          const sz = THREE.MathUtils.lerp(p.size, p.sizeEnd, pt);
          const flick = 0.45 + 0.55 * Math.max(0, Math.sin(ageSec * p.flicker * 18 + i));
          burstSize[i] = sz * appear * (POINT_PX + 8) * (isBreak ? 0.65 : 1);
          burstAlpha[i] = appear * fade * flick * (isBreak ? 0.5 : 1);
          living++;
        }
        burstGeo.attributes.position!.needsUpdate = true;
        burstGeo.attributes.aSize!.needsUpdate = true;
        burstGeo.attributes.aAlpha!.needsUpdate = true;
        const uColor = burstMat.uniforms.uColor?.value as THREE.Color | undefined;
        uColor?.set(isDischarge && t < 0.15 ? CORE : SPARK);
        burstPts.current.visible = living > 0;
      } else {
        burstPts.current.visible = false;
      }
    }

    // Tiny contact forks on discharge only.
    if (forksGroup.current) {
      if (isDischarge) {
        const forkFade =
          softPulse(Math.min(1, t / 0.12)) * (1 - smooth01(Math.max(0, (t - 0.08) / 0.35)));
        forksGroup.current.visible = forkFade > 0.04;
        for (let f = 0; f < FORK_COUNT; f++) {
          const fork = forks[f]!;
          const geo = forkGeos[f]!;
          const mat = forkMats[f]!;
          const pos = geo.attributes.position!.array as Float32Array;
          const grow = smooth01(Math.min(1, t / 0.1)) * fork.length * (0.9 + forkFade * 0.25);
          for (let s = 0; s <= FORK_SEGS; s++) {
            const u = s / FORK_SEGS;
            const along = u * grow;
            const zig =
              s === 0 || s === FORK_SEGS
                ? 0
                : Math.sin(s * 3.1 + fork.seed + age * 0.06) * 0.028 * (1 - u * 0.35);
            const sideX = -fork.dirZ;
            const sideZ = fork.dirX;
            pos[s * 3] = tx + fork.dirX * along + sideX * zig;
            pos[s * 3 + 1] = ty + fork.dirY * along + Math.cos(s * 2.2 + fork.seed) * zig * 0.5;
            pos[s * 3 + 2] = tz + fork.dirZ * along + sideZ * zig;
          }
          geo.attributes.position!.needsUpdate = true;
          mat.opacity = forkFade * (0.4 + 0.6 * Math.sin(age * 0.09 + f * 2.3));
          mat.color.set(f % 2 === 0 ? ARC_HOT : CORE);
        }
      } else {
        forksGroup.current.visible = false;
      }
    }

    if (tipCore.current && tipGlow.current) {
      const vis = tipOpacity > 0.02;
      tipCore.current.visible = vis;
      tipGlow.current.visible = vis;
      tipCore.current.position.set(tx, ty, tz);
      tipGlow.current.position.set(tx, ty, tz);
      tipCore.current.scale.setScalar(Math.max(0.008, tipScale * 0.5));
      tipGlow.current.scale.setScalar(Math.max(0.01, tipScale * 1.05));
      tipCoreMat.opacity = tipOpacity;
      tipGlowMat.opacity = tipOpacity * 0.4;
    }
  });

  return (
    <group>
      <primitive object={lineObj} frustumCulled={false} />
      <points
        ref={linkPts}
        geometry={linkGeo}
        material={linkMat}
        frustumCulled={false}
      />
      <points
        ref={burstPts}
        geometry={burstGeo}
        material={burstMat}
        frustumCulled={false}
      />
      <group ref={forksGroup} visible={false}>
        {forkLines.map((obj, i) => (
          <primitive key={i} object={obj} frustumCulled={false} />
        ))}
      </group>
      <mesh
        ref={tipCore}
        geometry={GEO_SPHERE_HI}
        material={tipCoreMat}
        frustumCulled={false}
        visible={false}
      />
      <mesh
        ref={tipGlow}
        geometry={GEO_SPHERE_MD}
        material={tipGlowMat}
        frustumCulled={false}
        visible={false}
      />
    </group>
  );
}

function softPulse(t: number): number {
  if (t < 0.2) return smooth01(t / 0.2);
  return 1 - smooth01((t - 0.2) / 0.8);
}
