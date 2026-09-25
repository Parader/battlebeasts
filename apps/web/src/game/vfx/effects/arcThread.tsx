import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ARC_THREAD_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { findHandBone } from "../attach";
import { getCharacterRoot } from "../../characterRoots";
import { smooth01 } from "../easing";
import {
  killLightningCluster,
  moveLightningCluster,
  patchLightningCluster,
  setLightningSegment,
  spawnLightningCluster,
  spawnLightningSegment,
  type LightningClusterOpts,
} from "../engine/lightningArcs";
import { acquireEnergyBallMaterial } from "../materials/energyBall";
import { GEO_SPHERE_HI, GEO_SPHERE_MD } from "../sharedGeo";
import {
  playArcThreadHitSfx,
  playArcThreadLoopSfx,
  stopArcThreadLoopSfx,
} from "../../gameSfx";

/** Lab lightning element palette — cyan core, no white tip. */
const ARC_HOT = "#67e8f9";
const ARC_MID = "#38bdf8";
const ARC_DEEP = "#0ea5e9";
const ARC_HALO = "#0b3fc8";
const HAND_Y = ARC_THREAD_CAST.handY;
const TARGET_Y = 1.15;
const SPAWN = ARC_THREAD_CAST.spawnOffset;
/** Nudge filament off the palm center toward the fingers. */
const HAND_PUSH = 0.06;

const FILAMENT_STRANDS_MAX = 3;

/** Shared look for filament / caster / impact — matches lab lightning element. */
const ELEMENT_ARC = {
  tipGlow: 0,
  colorCore: ARC_HOT,
  colorInner: ARC_MID,
  colorOuter: ARC_DEEP,
  colorHalo: ARC_HALO,
} as const;

const FILAMENT: LightningClusterOpts = {
  strands: 1,
  spreadMul: 0.28,
  jitterMul: 0.35,
  sag: 0.06,
  ...ELEMENT_ARC,
};

const CASTER: LightningClusterOpts = {
  length: 0.26,
  strands: 3,
  spreadMul: 0.3,
  jitterMul: 0.4,
  sag: 0.02,
  ...ELEMENT_ARC,
};

const IMPACT_RAYS = 6;
const IMPACT_REACH_MIN = 0.35;
const IMPACT_REACH_MAX = 0.95;
/** Endpoint height relative to tip — mixes up / level / down. */
const IMPACT_END_Y_MIN = -0.55;
const IMPACT_END_Y_MAX = 0.65;
/** Break dissipate is the discharge shape, dialed down. */
const BREAK_REACH_SCALE = 0.45;
const BREAK_END_Y_SCALE = 0.55;

const IMPACT: LightningClusterOpts = {
  strands: 2,
  spreadMul: 0.45,
  jitterMul: 0.65,
  sag: 0.1,
  ...ELEMENT_ARC,
};

type ImpactRay = {
  angle: number;
  reach: number;
  endY: number;
};

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

function softPulse(t: number): number {
  if (t < 0.2) return smooth01(t / 0.2);
  return 1 - smooth01((t - 0.2) / 0.8);
}

function hash11(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function buildImpactRays(seed: number): ImpactRay[] {
  const rays: ImpactRay[] = [];
  for (let i = 0; i < IMPACT_RAYS; i++) {
    const u = hash11(seed * 17.13 + i * 9.7);
    const v = hash11(seed * 31.7 + i * 5.3 + 2.1);
    const w = hash11(seed * 11.9 + i * 13.1 + 4.4);
    rays.push({
      angle: (i / IMPACT_RAYS) * Math.PI * 2 + u * 0.55,
      reach: IMPACT_REACH_MIN + v * (IMPACT_REACH_MAX - IMPACT_REACH_MIN),
      endY: IMPACT_END_Y_MIN + w * (IMPACT_END_Y_MAX - IMPACT_END_Y_MIN),
    });
  }
  return rays;
}

/**
 * Arc Thread — lab lightning shapes:
 * caster blow (hand cluster) + lean segment emitter (hand→target) + tip impact.
 *
 * Connected (variant 0): tether filament + hand crackle (no tip electricity stack).
 * Discharge (variant 1): filament gone — full tip impact / Shocked stack beat.
 * Break (variant 2): filament frays then dies + small tip dissipate.
 */
export function ArcThreadEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const tipCore = useRef<THREE.Mesh>(null);
  const tipGlow = useRef<THREE.Mesh>(null);
  const handWorld = useRef(new THREE.Vector3());
  const casterId = useRef(-1);
  const segmentId = useRef(-1);
  const tipRayIds = useRef<number[]>([]);
  const tipRaysSpawned = useRef(false);
  const tipRays = useRef<ImpactRay[]>([]);
  /** Tip radial forks only on discharge / break — not first contact. */
  const tipRayMode = useRef<"none" | "impact" | "break">("none");

  const isDischarge = shot.variant === 1;
  const isBreak = shot.variant === 2;
  /** No linked target — filament terminates at aim endpoint (x2/z2 or max range). */
  const isAir = !shot.followTargetId && !isDischarge && !isBreak;

  const tipCoreMat = useMemo(() => acquireEnergyBallMaterial(ARC_HOT, 0), []);
  const tipGlowMat = useMemo(() => acquireEnergyBallMaterial(ARC_MID, 0), []);

  const killTipRays = () => {
    for (const id of tipRayIds.current) killLightningCluster(id);
    tipRayIds.current = [];
    tipRaysSpawned.current = false;
    tipRayMode.current = "none";
  };

  useEffect(() => {
    return () => {
      if (casterId.current >= 0) killLightningCluster(casterId.current);
      if (segmentId.current >= 0) killLightningCluster(segmentId.current);
      for (const id of tipRayIds.current) killLightningCluster(id);
      casterId.current = -1;
      segmentId.current = -1;
      tipRayIds.current = [];
      tipCoreMat.dispose();
      tipGlowMat.dispose();
    };
  }, [tipCoreMat, tipGlowMat]);

  // Tether: electricity_loop. Discharge: electric_hit. Break: silence the loop only.
  useEffect(() => {
    const ownerId = shot.followOwnerId;
    if (isDischarge) {
      if (ownerId) stopArcThreadLoopSfx(ownerId);
      playArcThreadHitSfx();
      return;
    }
    if (isBreak) {
      if (ownerId) stopArcThreadLoopSfx(ownerId);
      return;
    }
    if (!ownerId) return;
    playArcThreadLoopSfx(ownerId);
    return () => stopArcThreadLoopSfx(ownerId);
  }, [isDischarge, isBreak, shot.followOwnerId]);

  useFrame(() => {
    const age = performance.now() - shot.born;
    const life = Math.max(16, shot.life);
    const t = Math.min(1, age / life);

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

    let tipOpacity = 0;
    let tipScale = 0.06;
    let showFilament = true;
    let showCaster = true;
    let filamentAlive = 1;

    if (isDischarge) {
      showFilament = false;
      showCaster = false;
      tipOpacity = softPulse(Math.min(1, t / 0.18)) * (1 - smooth01(Math.max(0, (t - 0.12) / 0.4)));
      tipScale = 0.075 + tipOpacity * 0.12;
    } else if (isBreak || (isAir && t > 0.72)) {
      const frayT = isBreak ? t : (t - 0.72) / 0.28;
      filamentAlive = Math.max(0, 1 - frayT * 1.4);
      showFilament = filamentAlive > 0.04;
      showCaster = filamentAlive > 0.2;
      tipOpacity = 0.25 * filamentAlive;
      tipScale = 0.03 + 0.025 * filamentAlive;
    } else {
      // Linked hold — soft tip ball only; electricity stack waits for discharge FX.
      const linkT = Math.min(1, age / 90);
      tipOpacity = linkT < 1 ? softPulse(linkT) * 0.55 : 0.08 + smooth01(Math.max(0, (age - 90) / Math.max(16, life - 90))) * 0.14;
      tipScale = linkT < 1 ? 0.035 + (1 - linkT) * 0.028 : 0.024 + 0.014;
    }

    // --- Caster blow (hand) ---
    if (showCaster) {
      const by = hy - 0.04;
      if (casterId.current < 0 || !moveLightningCluster(casterId.current, hx, by, hz)) {
        casterId.current = spawnLightningCluster(hx, by, hz, CASTER);
      }
    } else if (casterId.current >= 0) {
      killLightningCluster(casterId.current);
      casterId.current = -1;
    }

    // --- Emitter segment (hand → tip); strands ramp 1 → max over the charge ---
    if (showFilament) {
      const rampT = isBreak || (isAir && t > 0.72)
        ? filamentAlive
        : smooth01(Math.min(1, age / Math.max(140, life * 0.5)));
      const strands = Math.max(
        1,
        Math.round(1 + (FILAMENT_STRANDS_MAX - 1) * rampT),
      );
      if (segmentId.current < 0 || !setLightningSegment(segmentId.current, hx, hy, hz, tx, ty, tz)) {
        segmentId.current = spawnLightningSegment(hx, hy, hz, tx, ty, tz, {
          ...FILAMENT,
          strands,
        });
      } else {
        patchLightningCluster(segmentId.current, { strands });
      }
    } else if (segmentId.current >= 0) {
      killLightningCluster(segmentId.current);
      segmentId.current = -1;
    }

    // --- Tip impact rays: only on discharge (Shocked beat) or break dissipate ---
    const mode: "impact" | "break" | "none" = isDischarge
      ? "impact"
      : isBreak
        ? "break"
        : "none";
    const wantTipRays = mode !== "none";
    const reachScale = mode === "break" ? BREAK_REACH_SCALE : 1;
    const endYScale = mode === "break" ? BREAK_END_Y_SCALE : 1;

    if (wantTipRays) {
      const hug = ty;
      const spin = age * 0.0035;
      if (tipRayMode.current !== mode) {
        killTipRays();
        tipRays.current = buildImpactRays(shot.key + (mode === "impact" ? 41 : 17));
      }
      if (!tipRaysSpawned.current || tipRayIds.current.length === 0) {
        if (tipRays.current.length !== IMPACT_RAYS) {
          tipRays.current = buildImpactRays(shot.key + (mode === "impact" ? 41 : 17));
        }
        for (let i = 0; i < IMPACT_RAYS; i++) {
          const ray = tipRays.current[i]!;
          const reach = ray.reach * reachScale;
          const bx = tx + Math.cos(ray.angle) * reach;
          const bz = tz + Math.sin(ray.angle) * reach;
          const by = hug + ray.endY * endYScale;
          const id = spawnLightningSegment(tx, hug, tz, bx, by, bz, IMPACT);
          if (id >= 0) tipRayIds.current.push(id);
        }
        tipRaysSpawned.current = tipRayIds.current.length > 0;
        tipRayMode.current = tipRaysSpawned.current ? mode : "none";
      } else {
        for (let i = 0; i < tipRayIds.current.length; i++) {
          const id = tipRayIds.current[i]!;
          const ray = tipRays.current[i];
          if (!ray) continue;
          const a = ray.angle + spin;
          const reach = ray.reach * reachScale;
          const bx = tx + Math.cos(a) * reach;
          const bz = tz + Math.sin(a) * reach;
          const by = hug + ray.endY * endYScale;
          if (!setLightningSegment(id, tx, hug, tz, bx, by, bz)) {
            tipRayIds.current[i] = spawnLightningSegment(tx, hug, tz, bx, by, bz, IMPACT);
          } else {
            patchLightningCluster(id, IMPACT);
          }
        }
        tipRayMode.current = mode;
      }
      if (isBreak && filamentAlive < 0.15) {
        killTipRays();
      }
      if (isDischarge && t > 0.55) {
        killTipRays();
      }
    } else if (tipRayIds.current.length > 0) {
      killTipRays();
    }

    if (tipCore.current && tipGlow.current) {
      const vis = tipOpacity > 0.02;
      tipCore.current.visible = vis;
      tipGlow.current.visible = vis;
      tipCore.current.position.set(tx, ty, tz);
      tipGlow.current.position.set(tx, ty, tz);
      tipCore.current.scale.setScalar(Math.max(0.01, tipScale * 0.55));
      tipGlow.current.scale.setScalar(Math.max(0.014, tipScale * 1.2));
      tipCoreMat.opacity = tipOpacity;
      tipGlowMat.opacity = tipOpacity * 0.45;
    }
  });

  return (
    <group>
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
