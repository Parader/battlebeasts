import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Room } from "colyseus.js";
import {
  killLightningCluster,
  patchLightningCluster,
  setLightningSegment,
  spawnLightningSegment,
} from "./engine/lightningArcs";
/** Caster leash sits at the hips/waist — not hand/head height. */
const CASTER_ATTACH_Y = 0.95;
/** Target attach stays mid-torso for readability. */
const TARGET_ATTACH_Y = 1.1;

type ChainNet = {
  casterId?: string;
  targetId?: string;
  maxDistance?: number;
  startedAt?: number;
  endsAt?: number;
};

type Pose = { x: number; z: number; y?: number };

function readUnitPose(room: Room, id: string, attachY: number): Pose | null {
  const p = room.state?.players?.get(id) as Pose | undefined;
  if (p && typeof p.x === "number") return { x: p.x, z: p.z, y: attachY };
  const t = room.state?.targets?.get(id) as Pose | undefined;
  if (t && typeof t.x === "number") return { x: t.x, z: t.z, y: attachY };
  return null;
}

const LINK_COLORS = {
  colorCore: "#f5f3ff",
  colorInner: "#d8b4fe",
  colorOuter: "#a855f7",
  colorHalo: "#6b21a8",
  colorTip: "#ff2438",
};

function ChainMesh({ room, id }: { room: Room; id: string }) {
  const bolt = useRef(-1);

  useEffect(() => {
    return () => {
      if (bolt.current >= 0) killLightningCluster(bolt.current);
    };
  }, []);

  useFrame(() => {
    const chain = room.state?.astralChains?.get(id) as ChainNet | undefined;
    const caster = chain?.casterId ? readUnitPose(room, chain.casterId, CASTER_ATTACH_Y) : null;
    const target = chain?.targetId ? readUnitPose(room, chain.targetId, TARGET_ATTACH_Y) : null;
    if (!chain || !caster || !target) {
      if (bolt.current >= 0) {
        killLightningCluster(bolt.current);
        bolt.current = -1;
      }
      return;
    }

    const ax = caster.x;
    const ay = caster.y ?? CASTER_ATTACH_Y;
    const az = caster.z;
    const bx = target.x;
    const by = target.y ?? TARGET_ATTACH_Y;
    const bz = target.z;
    const dist = Math.hypot(bx - ax, bz - az);
    const maxD = Math.max(0.01, chain.maxDistance ?? dist);
    const tension = Math.min(1, dist / maxD);
    // Quiet halo until the leash is nearly taut, then the full glow.
    const glowMul = tension < 0.88 ? 0.16 : 0.16 + 0.84 * Math.min(1, (tension - 0.88) / 0.12);

    if (bolt.current < 0) {
      bolt.current = spawnLightningSegment(ax, ay, az, bx, by, bz, {
        still: true,
        strands: 1,
        glowMul,
        ...LINK_COLORS,
      });
    } else {
      setLightningSegment(bolt.current, ax, ay, az, bx, by, bz);
      patchLightningCluster(bolt.current, { glowMul });
    }
  });

  return null;
}

/** Schema-synced astral tethers. */
export function AstralChains({ room }: { room: Room | null }) {
  const [ids, setIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room?.state?.astralChains) return;
    const next: string[] = [];
    room.state.astralChains.forEach((_d: unknown, id: string) => next.push(id));
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
        <ChainMesh key={id} room={room} id={id} />
      ))}
    </>
  );
}
