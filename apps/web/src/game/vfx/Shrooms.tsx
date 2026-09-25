import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { SHROOM_CAST } from "@battlebeasts/shared";
import {
  createLabGroundMarkMaterial,
  tickLabGroundMark,
} from "./engine/labShapeMaterials";
import { spawnElementRole, type ElementHandle } from "./engine";
import { GEO_PLANE_1 } from "./sharedGeo";
import {
  SHROOM_GREEN_GLB_URL,
  SHROOM_RED_GLB_URL,
  SHROOM_TARGET_SIZE,
  instantiateShroom,
  warmShroomAssets,
} from "./shroomAsset";

type ShroomSchema = {
  x: number;
  z: number;
  yaw?: number;
  ownerSessionId?: string;
  triggerRadius?: number;
  blastRadius?: number;
  stage?: number;
  variant?: number;
  phase?: string;
  expiresAt?: number;
};

type PlayerTeam = { team?: string };

const STAGE_SCALE = [0.55, 0.82, 1.08] as const;

const HEAL_COLORS = { hot: "#a7f3d0", mid: "#6ee7b7", edge: "#14532d" };

const PAD_Y = 0.03;
const FEET_Y = 0.08;
/** Quiet pad mist by stage — 3 living plants × 2 layers is the budget. */
const WAKE_RATE = [0, 0.22, 0.4, 0.58] as const;

function spawnPadWake(kind: "heal" | "blood", x: number, y: number, z: number): ElementHandle {
  return spawnElementRole(kind, "ground", x, y, z, {
    dirY: kind === "heal" ? 0.28 : 0.06,
    spread: 0.2,
    gravity: kind === "heal" ? -0.05 : 0.55,
    drag: 1.5,
    size: kind === "heal" ? 0.18 : 0.14,
    sizeEnd: kind === "heal" ? 0.42 : 0.32,
    life: 0.7,
    rate: 8,
    opacity: kind === "heal" ? 0.2 : 0.16,
  });
}

/** Green for owner/allies; red for enemies (matches who the pad helps vs hurts). */
function shroomPadIsFriendly(
  room: Room,
  localSessionId: string | null,
  ownerSessionId: string | undefined,
  pvpTeams: boolean,
  localTeamHint?: string,
): boolean {
  if (!localSessionId || !ownerSessionId) return !pvpTeams;
  if (localSessionId === ownerSessionId) return true;
  const local = room.state?.players?.get(localSessionId) as PlayerTeam | undefined;
  const owner = room.state?.players?.get(ownerSessionId) as PlayerTeam | undefined;
  const localTeam = (localTeamHint || local?.team || "").trim();
  const ownerTeam = (owner?.team || "").trim();
  if (pvpTeams) {
    // Arena: hostile unless proven same team (matches RemotePlayers aim colors).
    return Boolean(localTeam && ownerTeam && localTeam === ownerTeam);
  }
  // Hub — pads heal everyone.
  return true;
}

function ShroomMesh({
  room,
  id,
  localSessionId,
  pvpTeams,
  localTeam,
}: {
  room: Room;
  id: string;
  localSessionId: string | null;
  pvpTeams: boolean;
  localTeam?: string;
}) {
  const greenGltf = useGLTF(SHROOM_GREEN_GLB_URL);
  const redGltf = useGLTF(SHROOM_RED_GLB_URL);
  const root = useRef<THREE.Group>(null);
  const meshRoot = useRef<THREE.Group>(null);
  const healMark = useRef<THREE.Mesh>(null);
  const wake = useRef<ElementHandle | null>(null);
  const padKind = useRef<"heal" | "blood" | null>(null);
  const world = useRef(new THREE.Vector3());
  const born = useRef(performance.now());
  const sinkBorn = useRef(0);
  const stageScale = useRef(STAGE_SCALE[0]);
  const variantRef = useRef(0);
  const [friendly, setFriendly] = useState(() => {
    const v = room.state?.shrooms?.get(id) as ShroomSchema | undefined;
    return shroomPadIsFriendly(
      room,
      localSessionId,
      v?.ownerSessionId,
      pvpTeams,
      localTeam,
    );
  });

  const healMat = useMemo(
    () => createLabGroundMarkMaterial("spiral", HEAL_COLORS, { opacity: 0.62, additive: false }),
    [],
  );

  const mesh = useMemo(() => {
    warmShroomAssets(greenGltf.scene, redGltf.scene);
    const v = room.state?.shrooms?.get(id) as ShroomSchema | undefined;
    variantRef.current = v?.variant ?? 0;
    return instantiateShroom(
      greenGltf.scene,
      redGltf.scene,
      variantRef.current,
      SHROOM_TARGET_SIZE,
      friendly ? "green" : "red",
    );
  }, [greenGltf.scene, redGltf.scene, room, id, friendly]);

  useEffect(
    () => () => {
      wake.current?.kill();
      wake.current = null;
      healMat.dispose();
    },
    [healMat],
  );

  useFrame((_, dt) => {
    const v = room.state?.shrooms?.get(id) as ShroomSchema | undefined;
    const g = root.current;
    if (!v || !g) {
      if (g) g.visible = false;
      wake.current?.setRateScale(0);
      return;
    }
    g.visible = true;
    g.position.x = v.x;
    g.position.z = v.z;
    g.rotation.y = v.yaw ?? 0;

    const nextFriendly = shroomPadIsFriendly(
      room,
      localSessionId,
      v.ownerSessionId,
      pvpTeams,
      localTeam,
    );
    if (nextFriendly !== friendly) setFriendly(nextFriendly);

    const sinking = v.phase === "sinking";
    if (sinking && sinkBorn.current <= 0) sinkBorn.current = performance.now();
    if (!sinking) sinkBorn.current = 0;

    const stage = Math.max(1, Math.min(3, Math.floor(v.stage ?? 1))) as 1 | 2 | 3;
    const target = STAGE_SCALE[stage - 1]!;
    stageScale.current += (target - stageScale.current) * Math.min(1, dt * 5);
    if (meshRoot.current) {
      const emerge = Math.min(1, (performance.now() - born.current) / 220);
      const yPop = (1 - emerge) * (1 - emerge);
      let bury = 0;
      if (sinking && sinkBorn.current > 0) {
        bury = Math.min(1, (performance.now() - sinkBorn.current) / SHROOM_CAST.sinkMs);
      }
      const buryEase = bury * bury;
      meshRoot.current.scale.setScalar(
        stageScale.current * (0.75 + 0.25 * emerge) * (1 - 0.35 * buryEase),
      );
      meshRoot.current.position.y = -0.12 * yPop - 0.85 * buryEase;
      meshRoot.current.visible = true;
    }

    const fade = sinking
      ? Math.max(0, 1 - (performance.now() - sinkBorn.current) / SHROOM_CAST.sinkMs)
      : 1;
    tickLabGroundMark(healMat, dt);
    healMat.uniforms.uOpacity!.value = 0.55 * fade;
    if (healMark.current) healMark.current.visible = nextFriendly;

    const triggerR = (v.triggerRadius ?? SHROOM_CAST.triggerRadius) * 1.12;
    const padScale = triggerR * 2;
    healMark.current?.scale.set(padScale, padScale, padScale);

    g.getWorldPosition(world.current);
    const want = nextFriendly ? "heal" : "blood";
    const wx = world.current.x;
    const wy = world.current.y + FEET_Y;
    const wz = world.current.z;
    if (padKind.current !== want) {
      wake.current?.kill();
      wake.current = spawnPadWake(want, wx, wy, wz);
      padKind.current = want;
    }
    wake.current?.setPose(wx, wy, wz);
    wake.current?.setRateScale(sinking ? 0 : WAKE_RATE[stage]!);
  });

  if (!mesh) return null;
  return (
    <group ref={root}>
      <mesh
        ref={healMark}
        geometry={GEO_PLANE_1}
        material={healMat}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, PAD_Y, 0]}
        renderOrder={5}
        frustumCulled={false}
        visible={friendly}
      />
      <group ref={meshRoot}>
        <primitive key={friendly ? "ally" : "enemy"} object={mesh} />
      </group>
    </group>
  );
}

/** Schema-synced planted shrooms. */
export function Shrooms({
  room,
  localSessionId,
  pvpTeams = false,
  localTeam,
}: {
  room: Room | null;
  localSessionId: string | null;
  /** When true, missing/mismatched teams read as hostile (arena). */
  pvpTeams?: boolean;
  /** Arena local team ("a" | "b") — same source as RemotePlayers aim colors. */
  localTeam?: string;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room?.state?.shrooms) return;
    const next: string[] = [];
    room.state.shrooms.forEach((_d: unknown, id: string) => next.push(id));
    next.sort();
    const key = next.join("|");
    if (key !== prevKey.current) {
      prevKey.current = key;
      setIds(next);
    }
  });

  if (!room) return null;
  return (
    <>
      {ids.map((id) => (
        <ShroomMesh
          key={id}
          room={room}
          id={id}
          localSessionId={localSessionId}
          pvpTeams={pvpTeams}
          localTeam={localTeam}
        />
      ))}
    </>
  );
}
