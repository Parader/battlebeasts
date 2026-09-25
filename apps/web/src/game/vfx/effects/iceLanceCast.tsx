import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ABILITIES, ICE_LANCE_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { findHandBone } from "../attach";
import { getCharacterRoot, getCombatOwnerPose } from "../../characterRoots";
import { acquireEnergyBallMaterial } from "../materials/energyBall";
import { GroundDecal } from "../components/GroundDecal";
import { hasStatusId } from "../../statusBadgeUtils";
import { GEO_LANCE_SHAFT, GEO_LANCE_TIP, GEO_OCTA } from "../sharedGeo";
import { useSpellLight } from "../spellLights";
import { groundPresets } from "../presets/ground";
import { burstElementRole, spawnElementRole, type ElementHandle } from "../engine";

const ICE = "#7dd3fc";
const ICE_HOT = "#e0f2fe";
const ICE_CORE = "#bae6fd";

/** Forward tip after mesh layout — local −Y (grip at origin). */
const TIP_LOCAL = new THREE.Vector3(0, -1, 0);

const TIP_LEN = 0.26;
const SHAFT_LEN = 0.16;
/** Local distance from lance origin to forward tip apex (mesh layout + tip scale). */
const TIP_EXTENT = TIP_LEN + SHAFT_LEN * 0.5;
/** Pin frost: quick fade-in, then hold until detonation. */
const GROUND_FROST_IN_SEC = 0.1;
/** Shift frost disc behind the tip (toward the shaft) so it reads as lance emission. */
const FROST_BACK_OFFSET = 0.3;
/** Small elemental ice disc under a ground pin (shared GroundDecal program). */
const PIN_FROST_PRESET = {
  ...groundPresets.iceFrost,
  radius: 0.72,
  lifeMs: 700,
  opacity: 0.8,
  spin: 0,
  breakup: 0.42,
  softness: 0.055,
  innerRatio: 0.12,
} as const;
/** Ground contact height for the planted tip. */
const PLANT_TIP_Y = 0.02;
/** How steeply the tip digs (more negative = more vertical). */
const PLANT_AIM_Y = -1.15;
/** Brief settle only when planting from a mid-air stuck height. */
const PLANT_DIVE_SEC = 0.14;
/** Same height as flight throw — fallback if stuck before arc tracked. */
const STUCK_Y = ICE_LANCE_CAST.handY;
/** Planar travel for the drop arc — slightly under ability range so tip plants with the fuse. */
const FLIGHT_RANGE = Math.max(1, (ABILITIES.iceLance?.range ?? 14) - 0.35);

const SPAWN_SEC =
  ICE_LANCE_CAST.spawnFrame / ICE_LANCE_CAST.fps / ICE_LANCE_CAST.playbackRate;

type LanceProj = {
  ownerSessionId?: string;
  abilityId?: string;
  x: number;
  z: number;
  vx?: number;
  vz?: number;
  mode?: string;
  stuckTargetId?: string;
};

/** Aim the forward tip along `dir` (world). */
function aimTip(g: THREE.Object3D, dir: THREE.Vector3, out: THREE.Vector3) {
  out.copy(dir);
  if (out.lengthSq() < 1e-8) return;
  out.normalize();
  g.quaternion.setFromUnitVectors(TIP_LOCAL, out);
}

/** Planted pose: tip apex at (tipX, PLANT_TIP_Y, tipZ), dig along flight. */
function setPlantPose(
  outPos: THREE.Vector3,
  outAim: THREE.Vector3,
  tipX: number,
  tipZ: number,
  fwdX: number,
  fwdZ: number,
) {
  outAim.set(fwdX, PLANT_AIM_Y, fwdZ);
  if (outAim.lengthSq() < 1e-6) outAim.set(0, PLANT_AIM_Y, 1);
  outAim.normalize();
  outPos.set(
    tipX - outAim.x * TIP_EXTENT,
    PLANT_TIP_Y - outAim.y * TIP_EXTENT,
    tipZ - outAim.z * TIP_EXTENT,
  );
}

/**
 * Flight pose from throw→plant: tip tracks projectile xz and drops to the ground,
 * so max-range flight ends in the planted pose (no extra end drop).
 */
function setFlightArcPose(
  outPos: THREE.Vector3,
  outAim: THREE.Vector3,
  tipX: number,
  tipZ: number,
  fwdX: number,
  fwdZ: number,
  progress01: number,
) {
  const t = Math.min(1, Math.max(0, progress01));
  // Mild ease-in — dips as soon as it moves, arrives at plant tip height at t=1.
  const drop = t * t * (0.35 + 0.65 * t);
  const tipY = THREE.MathUtils.lerp(ICE_LANCE_CAST.handY, PLANT_TIP_Y, drop);
  const pitchY = THREE.MathUtils.lerp(-0.06, PLANT_AIM_Y, drop);
  outAim.set(fwdX, pitchY, fwdZ);
  if (outAim.lengthSq() < 1e-6) outAim.set(0, pitchY, 1);
  outAim.normalize();
  outPos.set(
    tipX - outAim.x * TIP_EXTENT,
    tipY - outAim.y * TIP_EXTENT,
    tipZ - outAim.z * TIP_EXTENT,
  );
}

function smoothstep01(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}

function projSeq(id: string): number {
  const m = /^p_(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

function LanceMesh({
  coreMat,
  frostMat,
  crystalMat,
}: {
  coreMat: THREE.Material;
  frostMat: THREE.Material;
  crystalMat: THREE.Material;
}) {
  const tipY = TIP_LEN * 0.5 + SHAFT_LEN * 0.5;
  return (
    <>
      {/* Forward tip */}
      <mesh rotation={[Math.PI, 0, 0]} position={[0, -tipY, 0]} material={coreMat} geometry={GEO_LANCE_TIP} scale={[1.05, 1.3, 1.05]} />
      <mesh
        rotation={[Math.PI, 0, 0]}
        position={[0, -tipY, 0]}
        scale={[1.35, 1.45, 1.35]}
        material={frostMat}
        geometry={GEO_LANCE_TIP}
      />
      {/* Rear tip */}
      <mesh position={[0, tipY, 0]} material={coreMat} geometry={GEO_LANCE_TIP} scale={[1.05, 1.3, 1.05]} />
      <mesh position={[0, tipY, 0]} scale={[1.35, 1.45, 1.35]} material={frostMat} geometry={GEO_LANCE_TIP} />
      {/* Shaft — solid ice + frost sheath */}
      <mesh material={coreMat} geometry={GEO_LANCE_SHAFT} scale={[1.15, 1.6, 1.15]} />
      <mesh scale={[1.55, 1.6, 1.55]} material={frostMat} geometry={GEO_LANCE_SHAFT} />
      {/* Crystal facets along the grip */}
      <mesh position={[0, 0.02, 0]} scale={0.045} material={crystalMat} geometry={GEO_OCTA} />
      <mesh position={[0, -0.04, 0]} scale={0.035} material={crystalMat} geometry={GEO_OCTA} />
      <mesh position={[0, 0.07, 0]} scale={0.03} material={crystalMat} geometry={GEO_OCTA} />
    </>
  );
}

/**
 * Double-tipped ice lance: forms in the throwing hand at frame 24,
 * then flies tip-first with a frost wake until stuck / planted.
 */
export function IceLanceCastEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const lance = useRef<THREE.Group>(null);
  const plantFrost = useRef<THREE.Group>(null);
  /** Frost wake emitter — spawned on first flight frame, killed when flight ends. */
  const wake = useRef<ElementHandle | null>(null);

  const coreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: ICE_CORE,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        toneMapped: true,
      }),
    [],
  );
  const frostMat = useMemo(() => acquireEnergyBallMaterial(ICE, 0.4), []);
  const crystalMat = useMemo(() => acquireEnergyBallMaterial(ICE_HOT, 0.7), []);

  const lightAt = useRef<THREE.Object3D>(null);
  const light = useSpellLight();
  const phase = useRef<"wait" | "hand" | "flight" | "done">("wait");
  const projId = useRef<string | null>(null);
  const ignorePlantIds = useRef<Set<string> | null>(null);
  const maxSeqAtStart = useRef<number | null>(null);
  const worldPos = useRef(new THREE.Vector3());
  const worldQuat = useRef(new THREE.Quaternion());
  const flightDir = useRef(new THREE.Vector3(0, 0, 1));
  const flightOrigin = useRef(new THREE.Vector3());
  const tipPos = useRef(new THREE.Vector3());
  const tipSeeded = useRef(false);
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const stuckHitY = useRef<number | null>(null);
  const aim = useRef(new THREE.Vector3());
  const tmp = useRef(new THREE.Vector3());
  /** First frame we saw grounded — drives dive + frost. */
  const groundedBorn = useRef<number | null>(null);
  const plantFrom = useRef(new THREE.Vector3());
  const plantTo = useRef(new THREE.Vector3());
  const plantAimFrom = useRef(new THREE.Vector3());
  const plantAimTo = useRef(new THREE.Vector3());
  const plantLanded = useRef(false);
  const pinFrostOpacity = useRef(0);
  /** Caster blow is a single pop, not a loop — latch it. */
  const handBlown = useRef(false);

  const lateThrow = (shot.chargeMs ?? SPAWN_SEC * 1000) < SPAWN_SEC * 1000 * 0.5;
  const handSpawnSec = lateThrow ? 0 : SPAWN_SEC;

  useEffect(
    () => () => {
      coreMat.dispose();
      frostMat.dispose();
      crystalMat.dispose();
      wake.current?.kill();
      wake.current = null;
    },
    [coreMat, frostMat, crystalMat],
  );

  /** Stop the wake without tearing down the rest of the cast. */
  const endWake = () => {
    wake.current?.kill();
    wake.current = null;
  };

  useFrame((_, dt) => {
    if (phase.current === "done") {
      light.off();
      pinFrostOpacity.current = 0;
      if (plantFrost.current) plantFrost.current.visible = false;
      return;
    }
    const ageSec = (performance.now() - shot.born) / 1000;
    const g = root.current;
    const s = lance.current;
    if (!g || !s) return;

    if (
      ignorePlantIds.current == null &&
      follow.room?.state?.projectiles &&
      shot.followOwnerId
    ) {
      const prior = new Set<string>();
      let maxSeq = -1;
      follow.room.state.projectiles.forEach((p: LanceProj, id: string) => {
        if (p.abilityId !== "iceLance") return;
        if (p.ownerSessionId !== shot.followOwnerId) return;
        maxSeq = Math.max(maxSeq, projSeq(id));
        const m = p.mode ?? "flight";
        if (m === "stuck" || m === "grounded") prior.add(id);
      });
      ignorePlantIds.current = prior;
      maxSeqAtStart.current = maxSeq;
    }

    if (
      phase.current !== "flight" &&
      ageSec >= handSpawnSec &&
      follow.room?.state?.projectiles &&
      shot.followOwnerId &&
      maxSeqAtStart.current != null
    ) {
      const watermark = maxSeqAtStart.current;
      let bestFlight: { id: string; p: LanceProj; seq: number } | null = null;
      let bestPlant: { id: string; p: LanceProj; seq: number } | null = null;
      follow.room.state.projectiles.forEach((p: LanceProj, id: string) => {
        if (p.abilityId !== "iceLance") return;
        if (p.ownerSessionId !== shot.followOwnerId) return;
        const seq = projSeq(id);
        const m = p.mode ?? "flight";
        if (m === "flight") {
          const ok = seq > watermark || (lateThrow && seq >= watermark && seq >= 0);
          if (!ok) return;
          if (!bestFlight || seq >= bestFlight.seq) bestFlight = { id, p, seq };
          return;
        }
        if (
          ignorePlantIds.current?.has(id) &&
          !(lateThrow && seq >= watermark)
        ) {
          return;
        }
        if (seq < watermark) return;
        if (!bestPlant || seq >= bestPlant.seq) bestPlant = { id, p, seq };
      });

      const pick = bestFlight ?? bestPlant;
      if (pick) {
        const { id, p } = pick;
        const mode = p.mode ?? "flight";
        projId.current = id;
        phase.current = "flight";
        flightDir.current.set(p.vx ?? 0, 0, p.vz ?? 0);
        if (flightDir.current.lengthSq() < 1e-6) {
          flightDir.current.set(Math.sin(shot.yaw), 0, Math.cos(shot.yaw));
        }
        if (mode === "grounded") {
          // Late attach already grounded — dive from flight height.
          plantFrom.current.set(p.x, ICE_LANCE_CAST.handY, p.z);
          plantAimFrom.current.copy(flightDir.current);
          plantAimFrom.current.y = 0;
          if (plantAimFrom.current.lengthSq() < 1e-6) plantAimFrom.current.set(0, 0, 1);
          plantAimFrom.current.normalize();
          setPlantPose(
            plantTo.current,
            plantAimTo.current,
            p.x,
            p.z,
            flightDir.current.x,
            flightDir.current.z,
          );
          g.position.copy(plantFrom.current);
          aimTip(g, plantAimFrom.current, aim.current);
          groundedBorn.current = performance.now();
          plantLanded.current = false;
        } else {
          const y = mode === "stuck" ? STUCK_Y : ICE_LANCE_CAST.handY;
          g.position.set(p.x, y, p.z);
          // Throw origin for the drop arc (cast pose + spawn offset).
          flightOrigin.current.set(
            shot.x + Math.sin(shot.yaw) * ICE_LANCE_CAST.spawnOffset,
            ICE_LANCE_CAST.handY,
            shot.z + Math.cos(shot.yaw) * ICE_LANCE_CAST.spawnOffset,
          );
          stuckHitY.current = mode === "stuck" ? y : null;
          if (mode === "flight") {
            tipSeeded.current = false;
            const traveled = Math.hypot(p.x - flightOrigin.current.x, p.z - flightOrigin.current.z);
            setFlightArcPose(
              g.position,
              aim.current,
              p.x,
              p.z,
              flightDir.current.x,
              flightDir.current.z,
              traveled / Math.max(0.01, FLIGHT_RANGE),
            );
            tipPos.current.set(p.x, 0, p.z);
            lastServer.current = { x: p.x, z: p.z, vx: p.vx ?? 0, vz: p.vz ?? 0 };
            tipSeeded.current = true;
            aimTip(g, aim.current, tmp.current);
          } else {
            tipSeeded.current = false;
            aimTip(g, flightDir.current, aim.current);
          }
        }
        endWake();
        s.visible = true;
        s.scale.setScalar(1);
        s.rotation.set(0, 0, 0);
        coreMat.opacity = 0.95;
        frostMat.opacity = 0.5;
        crystalMat.opacity = 0.75;
        const remainMs = 6000;
        shot.life = Math.max(shot.life, performance.now() - shot.born + remainMs);
      }
    }

    if (phase.current === "flight" && projId.current && follow.room?.state?.projectiles) {
      const p = follow.room.state.projectiles.get(projId.current) as LanceProj | undefined;
      if (!p) {
        s.visible = false;
        phase.current = "done";
        light.off();
        pinFrostOpacity.current = 0;
        if (plantFrost.current) plantFrost.current.visible = false;
        return;
      }
      const safeDt = Math.min(0.05, dt);
      const mode = p.mode ?? "flight";
      if (mode === "flight") {
        stuckHitY.current = null;
        const vx = p.vx ?? 0;
        const vz = p.vz ?? 0;
        const spd = Math.hypot(vx, vz);
        if (spd > 0.1) {
          flightDir.current.set(vx, 0, vz);
        }

        // Smooth tip — integrate velocity, then ease toward server (avoids tick snap stutter).
        if (!tipSeeded.current) {
          tipPos.current.set(p.x, 0, p.z);
          lastServer.current = { x: p.x, z: p.z, vx, vz };
          tipSeeded.current = true;
        } else {
          tipPos.current.x += vx * safeDt;
          tipPos.current.z += vz * safeDt;
          const serverMoved =
            p.x !== lastServer.current.x ||
            p.z !== lastServer.current.z ||
            vx !== lastServer.current.vx ||
            vz !== lastServer.current.vz;
          if (serverMoved) {
            lastServer.current = { x: p.x, z: p.z, vx, vz };
            const err = Math.hypot(tipPos.current.x - p.x, tipPos.current.z - p.z);
            if (err > 1.25) {
              tipPos.current.x = p.x;
              tipPos.current.z = p.z;
            } else {
              const blend = 1 - Math.exp(-14 * safeDt);
              tipPos.current.x = THREE.MathUtils.lerp(tipPos.current.x, p.x, blend);
              tipPos.current.z = THREE.MathUtils.lerp(tipPos.current.z, p.z, blend);
            }
          }
        }
        const tipX = tipPos.current.x;
        const tipZ = tipPos.current.z;
        const traveled = Math.min(
          FLIGHT_RANGE,
          Math.hypot(tipX - flightOrigin.current.x, tipZ - flightOrigin.current.z),
        );
        setFlightArcPose(
          g.position,
          aim.current,
          tipX,
          tipZ,
          flightDir.current.x,
          flightDir.current.z,
          traveled / Math.max(0.01, FLIGHT_RANGE),
        );
        aimTip(g, aim.current, tmp.current);
        // Wake behind the rear tip (not on the forward tip / shaft).
        const wakeAlong = TIP_EXTENT + 0.1;
        const wakeX = g.position.x - aim.current.x * wakeAlong;
        const wakeY = g.position.y - aim.current.y * wakeAlong;
        const wakeZ = g.position.z - aim.current.z * wakeAlong;
        if (!wake.current) {
          wake.current = spawnElementRole("frost", "trail", wakeX, wakeY, wakeZ);
        }
        // Shed off the tail so the wake hangs in the flight path behind the lance.
        wake.current.setPose(wakeX, wakeY, wakeZ);
        light.emit(
          tipX,
          g.position.y + aim.current.y * TIP_EXTENT + 0.08,
          tipZ,
          ICE,
          1.05,
          2.6,
        );
      } else if (mode === "stuck") {
        tipSeeded.current = false;
        endWake();
        groundedBorn.current = null;
        plantLanded.current = false;
        pinFrostOpacity.current = 0;
        light.off();
        if (plantFrost.current) plantFrost.current.visible = false;
        if (stuckHitY.current == null) {
          stuckHitY.current = g.position.y > 0.2 ? g.position.y : STUCK_Y;
        }
        g.position.set(p.x, stuckHitY.current, p.z);
        aim.current.set(flightDir.current.x, 0, flightDir.current.z);
        if (aim.current.lengthSq() < 1e-6) aim.current.set(0, 0, 1);
        aimTip(g, aim.current, tmp.current);
        const stuckId = p.stuckTargetId;
        if (stuckId && stuckId !== follow.localSessionId) {
          const target = follow.room?.state?.players?.get(stuckId) as
            | { statuses?: Parameters<typeof hasStatusId>[0] }
            | undefined;
          if (
            hasStatusId(target?.statuses, "cloaked") ||
            hasStatusId(target?.statuses, "revengePhased")
          ) {
            s.visible = false;
            return;
          }
        }
      } else {
        // Grounded — already at plant pose from the flight arc; settle / frost only.
        tipSeeded.current = false;
        endWake();
        light.off();
        const tipX = p.x;
        const tipZ = p.z;
        setPlantPose(
          plantTo.current,
          plantAimTo.current,
          tipX,
          tipZ,
          flightDir.current.x,
          flightDir.current.z,
        );

        if (groundedBorn.current == null) {
          groundedBorn.current = performance.now();
          plantLanded.current = false;
          plantFrom.current.copy(g.position);
          plantAimFrom.current.copy(aim.current);
          if (plantAimFrom.current.lengthSq() < 1e-6) {
            plantAimFrom.current.copy(plantAimTo.current);
          }
          plantAimFrom.current.normalize();
          // Max-range flight already ends planted — skip the settle drop.
          const alreadyPlanted =
            Math.abs(plantFrom.current.y - plantTo.current.y) < 0.12 &&
            plantFrom.current.distanceTo(plantTo.current) < 0.35;
          if (alreadyPlanted) {
            g.position.copy(plantTo.current);
            aim.current.copy(plantAimTo.current);
            aimTip(g, aim.current, tmp.current);
            plantLanded.current = true;
          }
        }

        const plantAge = (performance.now() - groundedBorn.current) / 1000;
        if (!plantLanded.current || plantAge < PLANT_DIVE_SEC) {
          const diveT = plantLanded.current
            ? 1
            : smoothstep01(plantAge / PLANT_DIVE_SEC);
          g.position.lerpVectors(plantFrom.current, plantTo.current, diveT);
          aim.current.lerpVectors(plantAimFrom.current, plantAimTo.current, diveT);
          if (aim.current.lengthSq() > 1e-8) aim.current.normalize();
          aimTip(g, aim.current, tmp.current);
          if (diveT >= 0.92 && !plantLanded.current) {
            plantLanded.current = true;
          }
        } else {
          g.position.copy(plantTo.current);
          aim.current.copy(plantAimTo.current);
          aimTip(g, aim.current, tmp.current);
        }

        const landIn = plantLanded.current
          ? smoothstep01(plantAge / GROUND_FROST_IN_SEC)
          : smoothstep01((plantAge - PLANT_DIVE_SEC * 0.75) / (PLANT_DIVE_SEC * 0.25));
        const frostT = landIn;
        pinFrostOpacity.current = frostT;
        // Center frost behind the tip (under the shaft) — reads as lance emission.
        const fl = Math.hypot(flightDir.current.x, flightDir.current.z) || 1;
        const frostX = tipX - (flightDir.current.x / fl) * FROST_BACK_OFFSET;
        const frostZ = tipZ - (flightDir.current.z / fl) * FROST_BACK_OFFSET;
        if (plantFrost.current) {
          plantFrost.current.visible = frostT > 0.01;
          plantFrost.current.position.set(frostX, 0, frostZ);
        }
      }
      s.visible = true;
      return;
    }

    // Not flying — hide ground frost.
    if (plantFrost.current) plantFrost.current.visible = false;
    pinFrostOpacity.current = 0;
    groundedBorn.current = null;
    plantLanded.current = false;

    if (ageSec < handSpawnSec) {
      s.visible = false;
      return;
    }
    if (phase.current === "wait") phase.current = "hand";
    s.visible = true;
    const grow = Math.min(1, (ageSec - handSpawnSec) / 0.12);
    s.scale.setScalar(0.45 + grow * 0.55);
    coreMat.opacity = grow * 0.95;
    frostMat.opacity = grow * 0.48;
    crystalMat.opacity = grow * 0.8;
    // Subtle crystal shimmer while gripped.
    s.rotation.y = Math.sin(ageSec * 14) * 0.08 * grow;
    light.emitAt(lightAt.current, ICE, grow * 1.55, 2.9);

    const charRoot = getCharacterRoot(shot.followOwnerId);
    const hand = (charRoot && findHandBone(charRoot, "right")) || null;

    if (hand) {
      hand.getWorldPosition(worldPos.current);
      hand.getWorldQuaternion(worldQuat.current);
      g.position.copy(worldPos.current);
      g.quaternion.copy(worldQuat.current);
      g.rotateX(-Math.PI / 2);
      g.rotateZ(Math.PI / 2);
      tmp.current.set(0.02, 0.04, 0.01);
      tmp.current.applyQuaternion(worldQuat.current);
      g.position.add(tmp.current);
    } else if (shot.followOwnerId) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      let x = shot.x;
      let z = shot.z;
      let yaw = shot.yaw;
      if (local) {
        yaw = local.yaw;
        x = local.x + Math.sin(yaw) * ICE_LANCE_CAST.spawnOffset;
        z = local.z + Math.cos(yaw) * ICE_LANCE_CAST.spawnOffset;
      } else {
        const pl = getCombatOwnerPose(follow.room, shot.followOwnerId);
        if (pl) {
          yaw = pl.yaw ?? yaw;
          x = (pl.x ?? x) + Math.sin(yaw) * ICE_LANCE_CAST.spawnOffset;
          z = (pl.z ?? z) + Math.cos(yaw) * ICE_LANCE_CAST.spawnOffset;
        }
      }
      g.position.set(x, ICE_LANCE_CAST.handY, z);
      aim.current.set(Math.sin(yaw), 0, Math.cos(yaw));
      aimTip(g, aim.current, tmp.current);
    }

    // Caster blow: one frost pop as the lance forms, once the hand is resolved.
    if (!handBlown.current) {
      handBlown.current = true;
      burstElementRole("frost", "cast", g.position.x, g.position.y, g.position.z);
    }
  });

  return (
    <>
      <group ref={root} position={[shot.x, shot.y, shot.z]}>
        <group ref={lance} visible={false}>
          <LanceMesh coreMat={coreMat} frostMat={frostMat} crystalMat={crystalMat} />
          <object3D ref={lightAt} />
        </group>
      </group>

      {/* Element ice disc — shifted behind the tip so frost reads off the lance. */}
      <group ref={plantFrost} visible={false}>
        <GroundDecal
          preset={PIN_FROST_PRESET}
          x={0}
          y={0.03}
          z={0}
          radius={PIN_FROST_PRESET.radius}
          opacityMulRef={pinFrostOpacity}
        />
      </group>
    </>
  );
}
