import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Room } from "colyseus.js";
import * as THREE from "three";
import {
  ARENA_GROUND_SIZE,
  ARENA_SCENE_SCALE,
  ARENA_SCENE_URL,
  ARENA_SPAWNS,
  CAMERA,
  CEMETERY_GROUND_SIZE,
  CEMETERY_SCENE_SCALE,
  CEMETERY_SCENE_URL,
  STARTER_COLORS,
} from "@battlebeasts/shared";
import { FixedFollowCamera } from "./FixedFollowCamera";
import { RemotePlayers } from "./RemotePlayers";
import { CharacterAvatar } from "./CharacterAvatar";
import {
  CombatFxMeshes,
  DamagePopups,
  Projectiles,
  Decoys,
  Volcanoes,
  ProtectionBubbles,
  RiftPortals,
  Shrooms,
  SpiritHusks,
  WorldTargets,
} from "./CombatVfx";
import { SpellVfxBridge, VfxWorld } from "./vfx";
import { setGroundAim } from "./groundAimRuntime";
import { FollowSun } from "./FollowSun";
import type { PredictedPose } from "./useBaseCityRoom";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { assetUrl } from "./assetUrl";

const ARENA_GLB = assetUrl(ARENA_SCENE_URL.replace(/^\//, ""));
const CEMETERY_GLB = assetUrl(CEMETERY_SCENE_URL.replace(/^\//, ""));
useGLTF.preload(ARENA_GLB);
useGLTF.preload(CEMETERY_GLB);

type Props = {
  room: Room | null;
  localSessionId: string | null;
  predictedRef: MutableRefObject<PredictedPose>;
  modeLabel: string;
};

function plantSceneAtOrigin(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const meshes: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o);
  });
  if (meshes.length === 0) return;
  const origin = new THREE.Vector3(0, 200, 0);
  const hits = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObjects(
    meshes,
    false,
  );
  const hit = hits[0];
  if (hit && Number.isFinite(hit.point.y)) {
    root.position.y -= hit.point.y;
  }
}

function plantArenaAtMid(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const meshes: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o);
  });
  if (meshes.length === 0) return;
  const mid =
    ARENA_SPAWNS.length > 0
      ? {
          x: ARENA_SPAWNS.reduce((s, p) => s + p.x, 0) / ARENA_SPAWNS.length,
          z: ARENA_SPAWNS.reduce((s, p) => s + p.z, 0) / ARENA_SPAWNS.length,
        }
      : { x: 0, z: 0 };
  const origin = new THREE.Vector3(mid.x, 200, mid.z);
  const hits = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObjects(
    meshes,
    false,
  );
  const hit = hits[0];
  if (hit && Number.isFinite(hit.point.y)) {
    root.position.y -= hit.point.y;
  }
}

function DesertArenaScene() {
  const gltf = useGLTF(ARENA_GLB);
  const scene = useMemo(() => {
    const root = cloneSkinned(gltf.scene);
    root.scale.setScalar(ARENA_SCENE_SCALE);
    root.updateMatrixWorld(true);
    plantArenaAtMid(root);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    return root;
  }, [gltf.scene]);

  return <primitive object={scene} />;
}

function CemeteryScene() {
  const gltf = useGLTF(CEMETERY_GLB);
  const scene = useMemo(() => {
    const root = cloneSkinned(gltf.scene);
    root.scale.setScalar(CEMETERY_SCENE_SCALE);
    root.updateMatrixWorld(true);
    plantSceneAtOrigin(root);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    return root;
  }, [gltf.scene]);

  return <primitive object={scene} />;
}

function LocalMesh({
  predictedRef,
  room,
  localSessionId,
  color,
}: {
  predictedRef: MutableRefObject<PredictedPose>;
  room: Room | null;
  localSessionId: string | null;
  color: string;
}) {
  return (
    <CharacterAvatar
      predictedRef={predictedRef}
      room={room}
      localSessionId={localSessionId}
      color={color}
    />
  );
}

/** Content room scene — desert for PvP arenas, cemetery for Wave Assault. */
export function ContentScene({ room, localSessionId, predictedRef, modeLabel }: Props) {
  const isDungeon = modeLabel === "dungeon";
  const localPos = useRef(new THREE.Vector3(0, 0, 0));
  const aimNdc = useRef(new THREE.Vector2(0, 0));
  const aimReady = useRef(false);
  const { camera, gl } = useThree();
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const localPlayer = localSessionId
    ? (room?.state?.players?.get(localSessionId) as
        | { color?: string; team?: string; role?: string }
        | undefined)
    : undefined;
  const localColor = localPlayer?.color || STARTER_COLORS[0]!;
  const localTeam = localPlayer?.team || "";
  const spectatorRef = useRef(localPlayer?.role === "spectator");
  const [isSpectator, setIsSpectator] = useState(spectatorRef.current);

  useFrame(() => {
    const role = (
      localSessionId
        ? (room?.state?.players?.get(localSessionId) as { role?: string } | undefined)
        : undefined
    )?.role;
    const next = role === "spectator";
    if (next !== spectatorRef.current) {
      spectatorRef.current = next;
      setIsSpectator(next);
    }
  });

  useFrame(() => {
    const p = predictedRef.current;
    localPos.current.set(p.x, 0, p.z);
    // Keep ground aim + facing fresh even when the cursor is still (cast clicks need it).
    if (!aimReady.current) return;
    raycaster.setFromCamera(aimNdc.current, camera);
    if (raycaster.ray.intersectPlane(groundPlane, hit)) {
      const origin = predictedRef.current;
      const yaw = Math.atan2(hit.x - origin.x, hit.z - origin.z);
      setGroundAim(hit.x, hit.z);
      (window as unknown as { __bbSetYaw?: (y: number) => void }).__bbSetYaw?.(yaw);
    }
  });

  useEffect(() => {
    const el = gl.domElement;
    const onPointer = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const ndc = aimNdc.current;
      ndc.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      ndc.y = -(((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
      aimReady.current = true;
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(groundPlane, hit)) {
        const origin = predictedRef.current;
        const yaw = Math.atan2(hit.x - origin.x, hit.z - origin.z);
        setGroundAim(hit.x, hit.z);
        (window as unknown as { __bbSetYaw?: (y: number) => void }).__bbSetYaw?.(yaw);
      }
    };
    el.addEventListener("pointermove", onPointer);
    el.addEventListener("pointerdown", onPointer);
    return () => {
      el.removeEventListener("pointermove", onPointer);
      el.removeEventListener("pointerdown", onPointer);
    };
  }, [camera, gl, groundPlane, hit, predictedRef, raycaster]);

  const groundSize = isDungeon ? CEMETERY_GROUND_SIZE : ARENA_GROUND_SIZE;
  const groundColor = isDungeon ? "#1a1f18" : "#c4a574";

  return (
    <>
      <ambientLight intensity={isDungeon ? 0.4 : 0.55} />
      <FollowSun follow={localPos} intensity={isDungeon ? 0.95 : 1.2} />
      {isDungeon ? <CemeteryScene /> : <DesertArenaScene />}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[groundSize, groundSize]} />
        <meshStandardMaterial color={groundColor} />
      </mesh>
      {!isSpectator ? (
        <LocalMesh
          predictedRef={predictedRef}
          room={room}
          localSessionId={localSessionId}
          color={localColor}
        />
      ) : null}
      <RemotePlayers
        room={room}
        localSessionId={localSessionId}
        relation={isDungeon ? "ally" : "enemy"}
        localTeam={localTeam}
      />
      {isDungeon ? <WorldTargets room={room} /> : null}
      <Decoys room={room} />
      <Volcanoes room={room} />
      <ProtectionBubbles room={room} />
      <RiftPortals room={room} />
      <Shrooms
        room={room}
        localSessionId={localSessionId}
        pvpTeams={!isDungeon}
        localTeam={localTeam}
      />
      <SpiritHusks
        room={room}
        localSessionId={localSessionId}
        predictedRef={predictedRef}
      />
      <Projectiles room={room} />
      <CombatFxMeshes />
      <DamagePopups />
      <VfxWorld room={room} localSessionId={localSessionId} predictedRef={predictedRef} />
      <SpellVfxBridge room={room} />
      <FixedFollowCamera
        target={localPos}
        pitchDeg={CAMERA.pitchDeg}
        distance={CAMERA.distance}
        minDistance={CAMERA.minDistance}
        fov={CAMERA.fov}
        followLambda={CAMERA.followLambda}
        cursorLambda={CAMERA.cursorLambda}
        cursorInfluence={CAMERA.cursorInfluence}
      />
    </>
  );
}
