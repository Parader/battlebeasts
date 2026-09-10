import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef, type MutableRefObject } from "react";
import type { Room } from "colyseus.js";
import * as THREE from "three";
import type { PredictedPose } from "../useBaseCityRoom";
import { useObjectiveIds } from "../useColyseusMapKeys";
import {
  applyFlagTint,
  assembleBgFlag,
  BG_FLAG_CARRY_HEIGHT,
  BG_FLAG_CLOTH_URL,
  BG_FLAG_POLE_URL,
  BG_FLAG_STAND_HEIGHT,
} from "./flagAsset";

type ObjectiveRow = {
  tag?: string;
  team?: string;
  owner?: string;
  contest?: string;
  progress?: number;
  x?: number;
  z?: number;
  radius?: number;
  flagState?: string;
  carrierId?: string;
  dropX?: number;
  dropZ?: number;
};

type PlayerLite = {
  x?: number;
  z?: number;
  yaw?: number;
};

const TEAM_A = new THREE.Color("#c9a44a");
const TEAM_B = new THREE.Color("#4a7ec9");
const NEUTRAL = new THREE.Color("#9ca3af");
const CONTESTED = new THREE.Color("#eab308");

const CARRY_SCALE = BG_FLAG_CARRY_HEIGHT / BG_FLAG_STAND_HEIGHT;
const CARRY_SIDE = 0.42;

function tintFor(row: ObjectiveRow): THREE.Color {
  if (row.contest === "contested") return CONTESTED;
  const owner = row.tag === "flag_stand" ? row.team : row.owner;
  if (owner === "a") return TEAM_A;
  if (owner === "b") return TEAM_B;
  return NEUTRAL;
}

function carrierPose(
  room: Room,
  carrierId: string,
  localSessionId?: string | null,
  predictedRef?: MutableRefObject<PredictedPose>,
): { x: number; z: number; yaw: number } | null {
  if (carrierId && carrierId === localSessionId && predictedRef) {
    const p = predictedRef.current;
    return { x: p.x, z: p.z, yaw: p.yaw };
  }
  const player = room.state?.players?.get(carrierId) as PlayerLite | undefined;
  if (!player) return null;
  return { x: player.x ?? 0, z: player.z ?? 0, yaw: player.yaw ?? 0 };
}

function ObjectivePad({
  room,
  id,
  localSessionId,
  predictedRef,
}: {
  room: Room;
  id: string;
  localSessionId?: string | null;
  predictedRef?: MutableRefObject<PredictedPose>;
}) {
  const clothGltf = useGLTF(BG_FLAG_CLOTH_URL);
  const poleGltf = useGLTF(BG_FLAG_POLE_URL);
  const pad = useRef<THREE.Group>(null);
  const flag = useRef<THREE.Group>(null);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const fill = useRef<THREE.MeshBasicMaterial>(null);

  const assembled = useMemo(
    () => assembleBgFlag(clothGltf.scene, poleGltf.scene, BG_FLAG_STAND_HEIGHT),
    [clothGltf.scene, poleGltf.scene],
  );
  const clothMats = assembled.clothMats;

  useFrame((state) => {
    const row = room.state?.objectives?.get(id) as ObjectiveRow | undefined;
    const g = pad.current;
    const f = flag.current;
    if (!row || !g) return;

    const homeX = row.x ?? 0;
    const homeZ = row.z ?? 0;
    g.position.set(homeX, 0, homeZ);

    const color = tintFor(row);
    ring.current?.color.copy(color);
    fill.current?.color.copy(color);
    if (fill.current) fill.current.opacity = row.contest === "contested" ? 0.22 : 0.1;
    applyFlagTint(clothMats, color);

    if (!f) return;
    const carried = row.flagState === "carried";
    const dropped = row.flagState === "dropped";
    const isStand = row.tag === "flag_stand";
    const isHill = row.tag === "capture_point";

    if (isStand && carried && row.carrierId) {
      const pose = carrierPose(room, row.carrierId, localSessionId, predictedRef);
      if (!pose) {
        f.visible = false;
        return;
      }
      const sideX = Math.cos(pose.yaw) * CARRY_SIDE;
      const sideZ = -Math.sin(pose.yaw) * CARRY_SIDE;
      f.position.set(pose.x - homeX + sideX, 0, pose.z - homeZ + sideZ);
      f.rotation.y = pose.yaw;
      f.scale.setScalar(CARRY_SCALE);
      f.visible = true;
      return;
    }

    f.scale.setScalar(1);
    f.rotation.y = 0;
    if (isStand && dropped) {
      f.position.set((row.dropX ?? homeX) - homeX, 0, (row.dropZ ?? homeZ) - homeZ);
      f.visible = true;
      return;
    }
    if (isStand) {
      f.position.set(0, 0, 0);
      f.visible = row.flagState !== "carried";
      return;
    }
    if (isHill) {
      const bob = row.contest === "contested" ? Math.sin(state.clock.elapsedTime * 6) * 0.04 : 0;
      f.position.set(0, bob, 0);
      f.visible = true;
      return;
    }
    f.visible = false;
  });

  const row = room.state?.objectives?.get(id) as ObjectiveRow | undefined;
  const radius = Math.max(1.4, row?.radius ?? 3);

  return (
    <group ref={pad}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <ringGeometry args={[radius * 0.82, radius, 48]} />
        <meshBasicMaterial ref={ring} color={NEUTRAL} transparent opacity={0.7} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
        <circleGeometry args={[radius * 0.82, 40]} />
        <meshBasicMaterial ref={fill} color={NEUTRAL} transparent opacity={0.1} depthWrite={false} />
      </mesh>
      <group ref={flag}>
        <primitive object={assembled.root} />
      </group>
    </group>
  );
}

/** Ground rings + gallery flag (cloth + pole) for battleground objectives. */
export function ObjectiveMarkers({
  room,
  localSessionId,
  predictedRef,
}: {
  room: Room | null;
  localSessionId?: string | null;
  predictedRef?: MutableRefObject<PredictedPose>;
}) {
  const ids = useObjectiveIds(room);
  if (!room || ids.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <group>
        {ids.map((id) => (
          <ObjectivePad
            key={id}
            room={room}
            id={id}
            localSessionId={localSessionId}
            predictedRef={predictedRef}
          />
        ))}
      </group>
    </Suspense>
  );
}
