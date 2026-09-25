import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createLabGroundMarkMaterial,
  tickLabGroundMark,
} from "../engine/labShapeMaterials";
import {
  ATLAS_UV,
  BatchId,
  Collide,
  LodRank,
  killEmitter,
  setEmitterPose,
  setEmitterRate,
  spawnEmitter,
} from "../engine";
import { GEO_PLANE_1 } from "../sharedGeo";
import { playVoidDiscSpinSfx } from "../../gameSfx";

const DISC_Y = 0.95;
const DISC_SCALE = 1.32;
const RIM_R = 0.48;

const VOID_COLORS = { hot: "#e9d5ff", mid: "#a21caf", edge: "#3b0764" };
const VOID_CORE = { hot: "#1a0524", mid: "#07010c", edge: "#020106" };

type DiscPhase = "outbound" | "turning" | "returning" | "flight";

function readPhase(mode?: string): DiscPhase {
  if (mode === "outbound" || mode === "turning" || mode === "returning") return mode;
  return "flight";
}

/**
 * Void Disc — spinning void well with a spiral filament layer and a rim wake.
 */
export function VoidDiscProjectileEffect({ room, id }: { room: Room; id: string }) {
  const group = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const wellId = useRef(-1);
  const rimId = useRef(-1);
  const trailId = useRef(-1);
  const wakeId = useRef(-1);
  const angle = useRef(0);
  const heading = useRef({ x: 0, z: 1 });

  const wellMat = useMemo(
    () => createLabGroundMarkMaterial("void", VOID_COLORS, { opacity: 0.92, additive: false }),
    [],
  );
  const spiralMat = useMemo(
    () =>
      createLabGroundMarkMaterial("void", VOID_COLORS, {
        opacity: 0.55,
        additive: false,
        pattern: "dissolve-noise",
      }),
    [],
  );
  const coreMat = useMemo(
    () => createLabGroundMarkMaterial("void", VOID_CORE, { opacity: 1, additive: false }),
    [],
  );

  const renderPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0, mode: "outbound" });
  const seeded = useRef(false);
  const turnPulse = useRef(0);
  const spunOut = useRef(false);
  const spunBack = useRef(false);

  useEffect(() => {
    wellId.current = spawnEmitter({
      x: 0,
      y: DISC_Y,
      z: 0,
      rate: 4,
      dirY: 0.12,
      spread: 0.18,
      gravity: -0.08,
      drag: 1.1,
      noise: 0.45,
      collide: Collide.None,
      groundY: 0,
      batch: BatchId.AlphaSmoke,
      atlasUv: ATLAS_UV.void,
      size: 0.16,
      sizeEnd: 0.38,
      life: 0.55,
      opacity: 0.16,
      rotRate: 0.4,
      color0: "#1a0524",
      color1: "#0c0214",
      color2: "#05010a",
      lod: LodRank.Trail,
    });
    trailId.current = spawnEmitter({
      x: 0,
      y: DISC_Y,
      z: 0,
      rate: 26,
      dirX: 0,
      dirY: 0.04,
      dirZ: -0.9,
      spread: 0.16,
      gravity: -0.02,
      drag: 0.22,
      noise: 0.35,
      collide: Collide.None,
      groundY: 0,
      batch: BatchId.AdditiveSpark,
      atlasUv: ATLAS_UV.void,
      size: 0.16,
      sizeEnd: 0.04,
      life: 0.55,
      lifeJitter: 0.3,
      opacity: 0.85,
      rotRate: 1.1,
      color0: "#f5d0fe",
      color1: "#c026d3",
      color2: "#581c87",
      lod: LodRank.Core,
    });
    wakeId.current = spawnEmitter({
      x: 0,
      y: DISC_Y,
      z: 0,
      rate: 14,
      dirX: 0,
      dirY: 0.02,
      dirZ: -0.45,
      spread: 0.22,
      gravity: -0.04,
      drag: 0.55,
      noise: 0.25,
      collide: Collide.None,
      groundY: 0,
      batch: BatchId.AlphaSmoke,
      atlasUv: ATLAS_UV.void,
      size: 0.28,
      sizeEnd: 0.7,
      life: 0.85,
      lifeJitter: 0.3,
      opacity: 0.22,
      rotRate: 0.4,
      color0: "#3b0764",
      color1: "#1e0533",
      color2: "#05010a",
      lod: LodRank.Trail,
    });
    rimId.current = spawnEmitter({
      x: 0,
      y: DISC_Y,
      z: 0,
      rate: 18,
      dirX: 1,
      dirY: 0.08,
      dirZ: 0,
      spread: 0.08,
      gravity: -0.04,
      drag: 0.35,
      noise: 0.7,
      collide: Collide.None,
      groundY: 0,
      batch: BatchId.AdditiveSpark,
      atlasUv: ATLAS_UV.void,
      size: 0.14,
      sizeEnd: 0.03,
      life: 0.42,
      opacity: 0.9,
      rotRate: 1.4,
      color0: "#f5d0fe",
      color1: "#c026d3",
      color2: "#6b21a8",
      lod: LodRank.Core,
    });
    return () => {
      if (wellId.current >= 0) killEmitter(wellId.current);
      if (rimId.current >= 0) killEmitter(rimId.current);
      if (trailId.current >= 0) killEmitter(trailId.current);
      if (wakeId.current >= 0) killEmitter(wakeId.current);
      wellId.current = -1;
      rimId.current = -1;
      trailId.current = -1;
      wakeId.current = -1;
      wellMat.dispose();
      spiralMat.dispose();
      coreMat.dispose();
    };
  }, [wellMat, spiralMat, coreMat]);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | { x: number; z: number; vx?: number; vz?: number; mode?: string }
      | undefined;
    const g = group.current;
    const safeDt = Math.min(0.05, Math.max(0, dt));
    tickLabGroundMark(wellMat, safeDt);
    tickLabGroundMark(spiralMat, safeDt * 1.6);
    tickLabGroundMark(coreMat, safeDt * 0.45);

    if (!p || !g) {
      if (g) g.visible = false;
      if (wellId.current >= 0) setEmitterRate(wellId.current, 0);
      if (rimId.current >= 0) setEmitterRate(rimId.current, 0);
      if (trailId.current >= 0) setEmitterRate(trailId.current, 0);
      if (wakeId.current >= 0) setEmitterRate(wakeId.current, 0);
      seeded.current = false;
      spunOut.current = false;
      spunBack.current = false;
      return;
    }

    g.visible = true;
    const phase = readPhase(p.mode);
    const returning = phase === "returning";
    const turning = phase === "turning";
    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;

    if (!seeded.current) {
      renderPos.current.set(p.x, DISC_Y, p.z);
      lastServer.current = { x: p.x, z: p.z, vx, vz, mode: p.mode ?? "outbound" };
      seeded.current = true;
      if (!spunOut.current) {
        spunOut.current = true;
        playVoidDiscSpinSfx(0);
      }
    } else {
      renderPos.current.x += vx * safeDt;
      renderPos.current.z += vz * safeDt;
      const serverMoved =
        p.x !== lastServer.current.x ||
        p.z !== lastServer.current.z ||
        vx !== lastServer.current.vx ||
        vz !== lastServer.current.vz ||
        (p.mode ?? "outbound") !== lastServer.current.mode;
      if (serverMoved) {
        if (lastServer.current.mode === "outbound" && p.mode !== "outbound") {
          turnPulse.current = 1;
          if (!spunBack.current) {
            spunBack.current = true;
            playVoidDiscSpinSfx(1);
          }
        }
        lastServer.current = { x: p.x, z: p.z, vx, vz, mode: p.mode ?? "outbound" };
        const err = Math.hypot(renderPos.current.x - p.x, renderPos.current.z - p.z);
        if (err > 0.02) {
          const blend = err > 1.5 ? 1 : 0.35;
          renderPos.current.x += (p.x - renderPos.current.x) * blend;
          renderPos.current.z += (p.z - renderPos.current.z) * blend;
        }
      }
    }

    g.position.copy(renderPos.current);
    g.rotation.set(0, 0, 0);

    const spinRate = returning ? 16 : 12;
    angle.current += safeDt * spinRate;
    turnPulse.current = Math.max(0, turnPulse.current - safeDt * 3.2);
    const pulse =
      (turning ? 0.9 + Math.sin(performance.now() * 0.02) * 0.05 : 1) *
      (1 + turnPulse.current * 0.12);
    if (spin.current) {
      spin.current.rotation.y = angle.current;
      spin.current.scale.setScalar(pulse);
    }

    const x = renderPos.current.x;
    const y = renderPos.current.y;
    const z = renderPos.current.z;
    if (wellId.current >= 0) {
      setEmitterPose(wellId.current, x, y, z, 0, 0.12, 0);
      setEmitterRate(wellId.current, returning ? 5 : 3);
    }
    if (rimId.current >= 0) {
      const tx = Math.cos(angle.current);
      const tz = Math.sin(angle.current);
      setEmitterPose(
        rimId.current,
        x + tx * RIM_R,
        y,
        z + tz * RIM_R,
        -tz * 1.6,
        0.1,
        tx * 1.6,
      );
      setEmitterRate(rimId.current, returning ? 14 : 10);
    }
    const speed = Math.hypot(vx, vz);
    if (speed > 0.4) {
      heading.current.x = -vx / speed;
      heading.current.z = -vz / speed;
    }
    const bx = heading.current.x;
    const bz = heading.current.z;
    const moving = speed > 0.4 ? 1 : 0.25;
    if (trailId.current >= 0) {
      setEmitterPose(trailId.current, x, y, z, bx * 1.35, 0.04, bz * 1.35);
      setEmitterRate(trailId.current, (returning ? 32 : 24) * moving);
    }
    if (wakeId.current >= 0) {
      setEmitterPose(wakeId.current, x, y, z, bx * 0.7, 0.02, bz * 0.7);
      setEmitterRate(wakeId.current, (returning ? 16 : 12) * moving);
    }
  });

  return (
    <group ref={group}>
      <group ref={spin}>
        <mesh
          geometry={GEO_PLANE_1}
          material={wellMat}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={DISC_SCALE}
          renderOrder={4}
          frustumCulled={false}
        />
        <mesh
          geometry={GEO_PLANE_1}
          material={spiralMat}
          rotation={[-Math.PI / 2, 0, 0.6]}
          position={[0, 0.02, 0]}
          scale={DISC_SCALE * 0.72}
          renderOrder={5}
          frustumCulled={false}
        />
        <mesh
          geometry={GEO_PLANE_1}
          material={coreMat}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.035, 0]}
          scale={DISC_SCALE * 0.64}
          renderOrder={6}
          frustumCulled={false}
        />
      </group>
    </group>
  );
}
