import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { CAMERA, DEFAULT_PLAY_MAP_ID, isPveRunMode, mapDocFor, mapElementsOfType, mapIdForMode, STARTER_COLORS } from "@battlebeasts/shared";
import { FixedFollowCamera } from "./FixedFollowCamera";
import { RemotePlayers } from "./RemotePlayers";
import { CharacterAvatar } from "./CharacterAvatar";
import {
  CombatFxMeshes,
  DamagePopups,
  Projectiles,
  Decoys,
  Volcanoes,
  RockWalls,
  WorldTrees,
  ProtectionBubbles,
  PveReviveZones,
  OrbitingWisps,
  AstralChains,
  SoulSevers,
  RiftPortals,
  Shrooms,
  SpiritHusks,
  WorldTargets,
  PickupOrbs,
} from "./CombatVfx";
import { SpellVfxBridge, VfxWorld } from "./vfx";
import { setGroundAim } from "./groundAimRuntime";
import { FollowSun } from "./FollowSun";
import type { PredictedPose } from "./useBaseCityRoom";
import { CollisionDebugOverlay } from "./CollisionDebugOverlay";
import { MapScene } from "./MapScene";
import { ObjectiveMarkers } from "./vfx/ObjectiveMarkers";

type Props = {
  room: Room | null;
  localSessionId: string | null;
  predictedRef: MutableRefObject<PredictedPose>;
  modeLabel: string;
  /** Follow this living fighter instead of local prediction (death spectate). */
  spectateTargetId?: string | null;
};

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

function DungeonExitMarkers({
  room,
  mapId,
}: {
  room: Room | null;
  mapId: string;
}) {
  const unlocked = Boolean(
    (room?.state as { dungeonExitUnlocked?: boolean } | undefined)?.dungeonExitUnlocked,
  );
  const exits = useMemo(() => {
    const doc = mapDocFor(mapId);
    return doc ? mapElementsOfType(doc, "dungeon_exit") : [];
  }, [mapId]);
  if (!unlocked) return null;
  return (
    <>
      {exits.map((el) => {
        const r = el.shape?.kind === "circle" ? el.shape.radius : 2.4;
        return (
          <mesh
            key={el.id}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[el.x, 0.06, el.z]}
            renderOrder={2}
          >
            <ringGeometry args={[Math.max(0.4, r * 0.7), r, 48]} />
            <meshBasicMaterial
              color="#fbbf24"
              transparent
              opacity={0.7}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </>
  );
}

/** Content room scene — map resolved from the room's mode. */
export function ContentScene({
  room,
  localSessionId,
  predictedRef,
  modeLabel,
  spectateTargetId = null,
}: Props) {
  const isDungeon = isPveRunMode(modeLabel);
  // `modeLabel` is the room's mode id, so it resolves straight to a map. Falls
  // back to Arena 1 when a mode has no live tagged map.
  const mapId = mapIdForMode(modeLabel) ?? DEFAULT_PLAY_MAP_ID;
  const localPos = useRef(new THREE.Vector3(0, 0, 0));
  const cameraYaw = useRef(0);
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
    if (spectateTargetId && room) {
      const target = room.state?.players?.get(spectateTargetId) as
        | { x?: number; z?: number; yaw?: number; hp?: number }
        | undefined;
      if (target && typeof target.x === "number" && typeof target.z === "number") {
        localPos.current.set(target.x, 0, target.z);
        if (typeof target.yaw === "number") cameraYaw.current = target.yaw;
      }
    } else {
      const p = predictedRef.current;
      localPos.current.set(p.x, 0, p.z);
      cameraYaw.current = p.yaw;
    }
    // Keep ground aim + facing fresh even when the cursor is still (cast clicks need it).
    // Death spectate: camera-only — don't rewrite corpse yaw from cursor.
    if (!aimReady.current || spectateTargetId) return;
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

  return (
    <>
      <ambientLight intensity={isDungeon ? 0.4 : 0.9} />
      <hemisphereLight args={["#fff1d6", "#8b6a3c", isDungeon ? 0 : 0.55]} />
      <FollowSun follow={localPos} intensity={isDungeon ? 0.95 : 1.55} />
      {/* Maps bring their own ground — no extra plane (avoids z-fight/clipping). */}
      <MapScene mapId={mapId} />
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
      {modeLabel === "instance" ? <DungeonExitMarkers room={room} mapId={mapId} /> : null}
      <Decoys
        room={room}
        localSessionId={localSessionId}
        relation={isDungeon ? "ally" : "enemy"}
      />
      <Volcanoes room={room} />
      <RockWalls room={room} />
      <WorldTrees room={room} />
      <ProtectionBubbles room={room} />
      <PveReviveZones room={room} />
      <OrbitingWisps room={room} localSessionId={localSessionId} predictedRef={predictedRef} />
      <AstralChains room={room} />
      <SoulSevers room={room} />
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
      <PickupOrbs room={room} localSessionId={localSessionId} predictedRef={predictedRef} />
      <ObjectiveMarkers
        room={room}
        localSessionId={localSessionId}
        predictedRef={predictedRef}
      />
      <Projectiles room={room} />
      <CombatFxMeshes />
      <DamagePopups />
      <VfxWorld room={room} localSessionId={localSessionId} predictedRef={predictedRef} />
      <SpellVfxBridge room={room} />
      <CollisionDebugOverlay />
      <FixedFollowCamera
        target={localPos}
        yawRef={cameraYaw}
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
