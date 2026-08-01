import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { SHROOM_CAST } from "@battlebeasts/shared";
import { GroundDecal } from "./components/GroundDecal";
import { groundPresets } from "./presets/ground";
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

const allyTriggerPreset = {
  ...groundPresets.iceFrost,
  element: "poison" as const,
  shape: "circle" as const,
  colorCore: "#bbf7d0",
  colorMid: "#4ade80",
  colorEdge: "#166534",
  opacity: 0.78,
  additive: true,
  ringWidth: 0.1,
  softness: 0.06,
  innerRatio: 0.2,
  spin: 0.25,
  appearEnd: 0.06,
  fadeStart: 0.94,
};

const enemyTriggerPreset = {
  ...groundPresets.iceFrost,
  // Keep poison style (same as ally) — fire style was an unnecessary divergence.
  element: "poison" as const,
  shape: "circle" as const,
  colorCore: "#fecaca",
  colorMid: "#f87171",
  colorEdge: "#991b1b",
  opacity: 0.82,
  additive: true,
  ringWidth: 0.1,
  softness: 0.06,
  innerRatio: 0.2,
  spin: 0.3,
  appearEnd: 0.06,
  fadeStart: 0.94,
};

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
  const born = useRef(performance.now());
  const sinkBorn = useRef(0);
  const opacityMul = useRef(1);
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

  useFrame((_, dt) => {
    const v = room.state?.shrooms?.get(id) as ShroomSchema | undefined;
    const g = root.current;
    if (!v || !g) {
      if (g) g.visible = false;
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
    opacityMul.current = sinking
      ? Math.max(0, 1 - (performance.now() - sinkBorn.current) / SHROOM_CAST.sinkMs)
      : 1;
  });

  const triggerR = SHROOM_CAST.triggerRadius * 1.12;
  const preset = friendly ? allyTriggerPreset : enemyTriggerPreset;

  if (!mesh) return null;
  return (
    <group ref={root}>
      <GroundDecal
        key={friendly ? "ally" : "enemy"}
        preset={preset}
        shape="circle"
        x={0}
        z={0}
        y={0.03}
        born={born.current}
        life={SHROOM_CAST.maxLifeMs}
        radius={triggerR}
        opacityMulRef={opacityMul}
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
