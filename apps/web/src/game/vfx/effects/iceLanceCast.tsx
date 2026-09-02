import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ICE_LANCE_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { findHandBone } from "../attach";
import { getCharacterRoot } from "../../characterRoots";
import { acquireEnergyBallMaterial } from "../materials/energyBall";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { hasStatusId } from "../../StatusOrnaments";
import { GEO_LANCE_SHAFT, GEO_LANCE_TIP } from "../sharedGeo";
import { useSpellLight } from "../spellLights";

const ICE = "#7dd3fc";
const ICE_HOT = "#e0f2fe";
const ICE_DEEP = "#0c4a6e";

/** Forward tip after mesh layout — local −Y (grip at origin). */
const TIP_LOCAL = new THREE.Vector3(0, -1, 0);

const TIP_LEN = 0.2;
const SHAFT_LEN = 0.1;

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

function projSeq(id: string): number {
  const m = /^p_(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

function LanceMesh({
  coreMat,
  glowMat,
}: {
  coreMat: THREE.Material;
  glowMat: THREE.Material;
}) {
  const tipY = TIP_LEN * 0.5 + SHAFT_LEN * 0.5;
  return (
    <>
      <mesh rotation={[Math.PI, 0, 0]} position={[0, -tipY, 0]} material={coreMat} geometry={GEO_LANCE_TIP} />
      <mesh
        rotation={[Math.PI, 0, 0]}
        position={[0, -tipY, 0]}
        scale={1.2}
        material={glowMat}
        geometry={GEO_LANCE_TIP}
      />
      <mesh position={[0, tipY, 0]} material={coreMat} geometry={GEO_LANCE_TIP} />
      <mesh position={[0, tipY, 0]} scale={1.2} material={glowMat} geometry={GEO_LANCE_TIP} />
      <mesh material={coreMat} geometry={GEO_LANCE_SHAFT} />
      <mesh scale={[1.25, 1, 1.25]} material={glowMat} geometry={GEO_LANCE_SHAFT} />
    </>
  );
}

/**
 * Double-tipped ice lance: appears mid-grip in the throwing hand at frame 24,
 * then flies tip-first like a javelin until stuck / planted.
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
  const coreMat = useMemo(() => acquireEnergyBallMaterial(ICE_HOT, 0.95), []);
  const glowMat = useMemo(() => acquireEnergyBallMaterial(ICE, 0.45), []);
  const lightAt = useRef<THREE.Object3D>(null);
  const light = useSpellLight();
  const phase = useRef<"wait" | "hand" | "flight" | "done">("wait");
  const projId = useRef<string | null>(null);
  /** Stuck/grounded lances already planted when this cast VFX spawned. */
  const ignorePlantIds = useRef<Set<string> | null>(null);
  /** Highest owner ice-lance projectile seq seen at first snapshot. */
  const maxSeqAtStart = useRef<number | null>(null);
  const worldPos = useRef(new THREE.Vector3());
  const worldQuat = useRef(new THREE.Quaternion());
  const flightDir = useRef(new THREE.Vector3(0, 0, 1));
  const aim = useRef(new THREE.Vector3());
  const tmp = useRef(new THREE.Vector3());

  // Late impact catch-up (chargeMs ≈ 1) — skip hand delay and latch immediately.
  const lateThrow = (shot.chargeMs ?? SPAWN_SEC * 1000) < SPAWN_SEC * 1000 * 0.5;
  const handSpawnSec = lateThrow ? 0 : SPAWN_SEC;

  useFrame((_, dt) => {
    if (phase.current === "done") return;
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

    // Latch this cast's projectile only (seq watermark + ignore prior plants).
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
          // New throw: seq > watermark. Late mount: same seq, chargeMs was tiny.
          const ok = seq > watermark || (lateThrow && seq >= watermark && seq >= 0);
          if (!ok) return;
          if (!bestFlight || seq >= bestFlight.seq) bestFlight = { id, p, seq };
          return;
        }
        // Prior plants ignored — unless this is a late mount onto that plant.
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
        const y = mode === "stuck" ? 1.05 : mode === "grounded" ? 0.28 : ICE_LANCE_CAST.handY;
        g.position.set(p.x, y, p.z);
        flightDir.current.set(p.vx ?? 0, 0, p.vz ?? 0);
        if (flightDir.current.lengthSq() < 1e-6) {
          flightDir.current.set(Math.sin(shot.yaw), 0, Math.cos(shot.yaw));
        }
        aimTip(g, flightDir.current, aim.current);
        s.visible = true;
        s.scale.setScalar(1);
        coreMat.opacity = 1;
        glowMat.opacity = 0.55;
        const remainMs = 6000;
        shot.life = Math.max(shot.life, performance.now() - shot.born + remainMs);
      }
    }

    if (phase.current === "flight" && projId.current && follow.room?.state?.projectiles) {
      const p = follow.room.state.projectiles.get(projId.current) as LanceProj | undefined;
      if (!p) {
        s.visible = false;
        phase.current = "done";
        return;
      }
      const safeDt = Math.min(0.05, dt);
      const mode = p.mode ?? "flight";
      if (mode === "flight") {
        g.position.x += (p.vx ?? 0) * safeDt;
        g.position.z += (p.vz ?? 0) * safeDt;
        const err = Math.hypot(g.position.x - p.x, g.position.z - p.z);
        if (err > 0.05) {
          g.position.x = THREE.MathUtils.lerp(g.position.x, p.x, 0.35);
          g.position.z = THREE.MathUtils.lerp(g.position.z, p.z, 0.35);
        }
        g.position.y = ICE_LANCE_CAST.handY;
        const spd = Math.hypot(p.vx ?? 0, p.vz ?? 0);
        if (spd > 0.1) {
          flightDir.current.set(p.vx ?? 0, 0, p.vz ?? 0);
          aimTip(g, flightDir.current, aim.current);
        }
      } else if (mode === "stuck") {
        g.position.set(p.x, 1.05, p.z);
        aim.current.set(flightDir.current.x, 0, flightDir.current.z);
        if (aim.current.lengthSq() < 1e-6) aim.current.set(0, 0, 1);
        aimTip(g, aim.current, tmp.current);
        // Hide stuck lance on cloaked targets for everyone except the cloaked player.
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
        g.position.set(p.x, 0.28, p.z);
        aim.current.set(flightDir.current.x, -0.55, flightDir.current.z);
        if (aim.current.lengthSq() < 1e-6) aim.current.set(0, -0.55, 1);
        aimTip(g, aim.current, tmp.current);
      }
      s.visible = true;
      return;
    }

    if (ageSec < handSpawnSec) {
      s.visible = false;
      return;
    }
    if (phase.current === "wait") phase.current = "hand";
    s.visible = true;
    const grow = Math.min(1, (ageSec - handSpawnSec) / 0.1);
    s.scale.setScalar(0.55 + grow * 0.45);
    coreMat.opacity = grow;
    glowMat.opacity = grow * 0.5;
    light.emitAt(lightAt.current, ICE, grow * 1.35, 2.6);

    const charRoot = getCharacterRoot(shot.followOwnerId);
    const hand = (charRoot && findHandBone(charRoot, "right")) || null;

    if (hand) {
      hand.getWorldPosition(worldPos.current);
      hand.getWorldQuaternion(worldQuat.current);
      // Grip at hand center — lance mesh is centered on the shaft.
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
        const pl = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
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
  });

  return (
    <group ref={root} position={[shot.x, shot.y, shot.z]}>
      <group ref={lance} visible={false}>
        <LanceMesh coreMat={coreMat} glowMat={glowMat} />
        <object3D ref={lightAt} />
        <AdditiveParticleBurst
          color={ICE_DEEP}
          origin={[0, 0, 0]}
          count={5}
          life={0.35}
          speed={0.35}
          size={0.04}
          sizeEnd={0.008}
          lift={0.2}
          fadeIn={0.2}
          stagger={0.25}
          trigger={shot.key}
        />
      </group>
    </group>
  );
}
