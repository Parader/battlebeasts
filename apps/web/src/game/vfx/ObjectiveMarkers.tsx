import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { Room } from "colyseus.js";
import * as THREE from "three";
import type { PredictedPose } from "../useBaseCityRoom";
import { useObjectiveIds } from "../useColyseusMapKeys";
import { getCharacterRoot } from "../characterRoots";
import { FlagCarryTrail, type FlagTrailPose } from "./effects/flagCarryTrail";
import {
  applyFlagTint,
  assembleBgFlag,
  BG_FLAG_CLOTH_URL,
  BG_FLAG_POLE_URL,
  BG_FLAG_STAND_HEIGHT,
  BG_FLAG_CARRY_HEIGHT,
  clonePlantedProp,
  disposeClonedFlag,
  FLAG_TEAM_A_HEX,
  FLAG_TEAM_B_HEX,
  flagTrailHex,
  flagUrlForTeam,
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

const TEAM_A = new THREE.Color(FLAG_TEAM_A_HEX);
const TEAM_B = new THREE.Color(FLAG_TEAM_B_HEX);
const NEUTRAL = new THREE.Color("#9ca3af");
const CONTESTED = new THREE.Color("#eab308");

/**
 * Mixamo scene space (Y-up, +Z face). Mid-back, clearly behind the torso —
 * Spine2 bone axes are Z-up from the Hips bind and parked the banner on the head.
 */
const CARRY_LOCAL = new THREE.Vector3(0.02, 0.82, -0.18);
/** Lean the pole back a little so it reads as carried. */
const CARRY_TILT = 0.12;

const _world = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _fwd = new THREE.Vector3();
const _back = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _basis = new THREE.Matrix4();
const _tilt = new THREE.Quaternion();

function tintFor(row: ObjectiveRow): THREE.Color {
  if (row.contest === "contested") return CONTESTED;
  const owner = row.tag === "flag_stand" ? row.team : row.owner;
  if (owner === "a") return TEAM_A;
  if (owner === "b") return TEAM_B;
  return NEUTRAL;
}

function teamOf(row: ObjectiveRow | undefined, id: string): "a" | "b" {
  if (row?.team === "a" || row?.team === "b") return row.team;
  return /(?:^|_)b$/i.test(id) || id.includes("flag_b") ? "b" : "a";
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

function placeCarriedFlag(
  flag: THREE.Object3D,
  homeX: number,
  homeZ: number,
  carrierId: string,
  pose: { x: number; z: number; yaw: number },
  emit: MutableRefObject<FlagTrailPose | null>,
): void {
  const charRoot = getCharacterRoot(carrierId);
  let yaw = pose.yaw;

  if (charRoot) {
    charRoot.updateWorldMatrix(true, false);
    _world.copy(CARRY_LOCAL).applyMatrix4(charRoot.matrixWorld);
    charRoot.getWorldQuaternion(_quat);
    _euler.setFromQuaternion(_quat, "YXZ");
    yaw = _euler.y;
  } else {
    _world.set(
      pose.x - Math.sin(pose.yaw) * 0.18,
      0.82,
      pose.z - Math.cos(pose.yaw) * 0.18,
    );
  }

  // Authored flag: pole +Y, cloth +X. Align +X with the character's back so
  // the banner streams behind instead of sitting across the shoulders.
  _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  _back.copy(_fwd).negate();
  _right.set(_fwd.z, 0, -_fwd.x);
  _basis.makeBasis(_back, _up, _right);
  _quat.setFromRotationMatrix(_basis);
  _tilt.setFromAxisAngle(_right, -CARRY_TILT);
  _quat.premultiply(_tilt);
  flag.quaternion.copy(_quat);

  flag.position.set(_world.x - homeX, _world.y, _world.z - homeZ);
  flag.visible = true;

  emit.current = {
    x: _world.x - _fwd.x * 0.08,
    y: _world.y + 0.42,
    z: _world.z - _fwd.z * 0.08,
    yaw,
  };
}

function FlagStandMarker({
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
  const row0 = room.state?.objectives?.get(id) as ObjectiveRow | undefined;
  const team = teamOf(row0, id);
  const gltf = useGLTF(flagUrlForTeam(team));
  const trail = flagTrailHex(team);
  const pad = useRef<THREE.Group>(null);
  const worldFlag = useRef<THREE.Group>(null);
  const carryFlag = useRef<THREE.Group>(null);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  const emitPose = useRef<FlagTrailPose | null>(null);

  const standRoot = useMemo(
    () => clonePlantedProp(gltf.scene, BG_FLAG_STAND_HEIGHT),
    [gltf.scene],
  );
  const carryRoot = useMemo(
    () => clonePlantedProp(gltf.scene, BG_FLAG_CARRY_HEIGHT),
    [gltf.scene],
  );

  useEffect(() => {
    return () => {
      disposeClonedFlag(standRoot);
      disposeClonedFlag(carryRoot);
    };
  }, [standRoot, carryRoot]);

  useFrame(() => {
    const row = room.state?.objectives?.get(id) as ObjectiveRow | undefined;
    const g = pad.current;
    const planted = worldFlag.current;
    const carriedMesh = carryFlag.current;
    if (!row || !g) return;

    const homeX = row.x ?? 0;
    const homeZ = row.z ?? 0;
    g.position.set(homeX, 0, homeZ);

    const color = tintFor(row);
    ring.current?.color.copy(color);
    fill.current?.color.copy(color);

    const carried = row.flagState === "carried";
    const dropped = row.flagState === "dropped";

    if (carried && row.carrierId && carriedMesh && planted) {
      const pose = carrierPose(room, row.carrierId, localSessionId, predictedRef);
      if (!pose) {
        planted.visible = false;
        carriedMesh.visible = false;
        emitPose.current = null;
        return;
      }
      planted.visible = false;
      placeCarriedFlag(
        carriedMesh,
        homeX,
        homeZ,
        row.carrierId,
        pose,
        emitPose,
      );
      return;
    }

    emitPose.current = null;
    if (carriedMesh) carriedMesh.visible = false;
    if (!planted) return;

    planted.scale.setScalar(1);
    planted.rotation.set(0, 0, 0);
    if (dropped) {
      planted.position.set((row.dropX ?? homeX) - homeX, 0, (row.dropZ ?? homeZ) - homeZ);
      planted.visible = true;
      return;
    }
    planted.position.set(0, 0, 0);
    planted.visible = row.flagState !== "carried";
  });

  const radius = Math.max(1.4, row0?.radius ?? 3);

  return (
    <>
      <group ref={pad}>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
          <ringGeometry args={[radius * 0.82, radius, 48]} />
          <meshBasicMaterial ref={ring} color={team === "a" ? TEAM_A : TEAM_B} transparent opacity={0.7} depthWrite={false} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
          <circleGeometry args={[radius * 0.82, 40]} />
          <meshBasicMaterial ref={fill} color={team === "a" ? TEAM_A : TEAM_B} transparent opacity={0.1} depthWrite={false} />
        </mesh>
        <group ref={worldFlag}>
          <primitive object={standRoot} />
        </group>
        <group ref={carryFlag} visible={false}>
          <primitive object={carryRoot} />
        </group>
      </group>
      <FlagCarryTrail color={trail.color} hot={trail.hot} getPose={() => emitPose.current} />
    </>
  );
}

function HillMarker({
  room,
  id,
}: {
  room: Room;
  id: string;
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

  useEffect(() => {
    return () => disposeClonedFlag(assembled.root);
  }, [assembled]);

  useFrame((state) => {
    const row = room.state?.objectives?.get(id) as ObjectiveRow | undefined;
    const g = pad.current;
    const f = flag.current;
    if (!row || !g) return;

    g.position.set(row.x ?? 0, 0, row.z ?? 0);

    const color = tintFor(row);
    ring.current?.color.copy(color);
    fill.current?.color.copy(color);
    if (fill.current) fill.current.opacity = row.contest === "contested" ? 0.22 : 0.1;
    applyFlagTint(clothMats, color);

    if (!f) return;
    const bob = row.contest === "contested" ? Math.sin(state.clock.elapsedTime * 6) * 0.04 : 0;
    f.position.set(0, bob, 0);
    f.visible = true;
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
  const row = room.state?.objectives?.get(id) as ObjectiveRow | undefined;
  if (row?.tag === "flag_stand") {
    return (
      <FlagStandMarker
        room={room}
        id={id}
        localSessionId={localSessionId}
        predictedRef={predictedRef}
      />
    );
  }
  if (row?.tag === "capture_point") {
    return <HillMarker room={room} id={id} />;
  }
  return null;
}

/** Ground rings + CTF flags (flag1/flag2) / KoTH gallery banners. */
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
