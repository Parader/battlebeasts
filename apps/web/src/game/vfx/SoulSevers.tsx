import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SOUL_SEVER_CAST } from "@battlebeasts/shared";

type SeverNet = {
  casterId?: string;
  targetId?: string;
  originX?: number;
  originZ?: number;
  startedAt?: number;
  endsAt?: number;
};

const VOID = new THREE.Color("#450a0a");
const MAIN = new THREE.Color("#B91C1C");
const BRIGHT = new THREE.Color("#EF4444");
const DRIP = new THREE.Color("#7f1d1d");

const DRIP_COUNT = 5;

function targetPose(
  room: Room,
  targetId: string,
): { x: number; z: number; hp: number } | null {
  const p = room.state?.players?.get(targetId) as
    | { x?: number; z?: number; hp?: number }
    | undefined;
  if (p && typeof p.x === "number") {
    return { x: p.x, z: p.z, hp: p.hp ?? 1 };
  }
  const t = room.state?.targets?.get(targetId) as
    | { x?: number; z?: number; hp?: number }
    | undefined;
  if (t && typeof t.x === "number") {
    return { x: t.x, z: t.z, hp: t.hp ?? 1 };
  }
  return null;
}

/**
 * Stationary soul imprint (vertical afterimage, not a bubble) + faint stretch thread.
 */
function SoulSeverInstance({ room, id }: { room: Room; id: string }) {
  const echo = useRef<THREE.Group>(null);
  const pillar = useRef<THREE.Mesh>(null);
  const cross = useRef<THREE.Mesh>(null);
  const ground = useRef<THREE.Mesh>(null);
  const thread = useRef<THREE.Mesh>(null);
  const drips = useRef<(THREE.Mesh | null)[]>([]);

  const mats = useMemo(() => {
    const mk = (color: THREE.Color, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
    return {
      pillar: mk(MAIN, 0.32),
      cross: mk(VOID, 0.4),
      ground: mk(BRIGHT, 0.22),
      thread: mk(BRIGHT, 0.16),
      drips: Array.from({ length: DRIP_COUNT }, () => mk(DRIP, 0.45)),
    };
  }, []);

  useFrame(() => {
    const sever = room.state?.soulSevers?.get(id) as SeverNet | undefined;
    const eg = echo.current;
    if (!sever || !eg) {
      if (eg) eg.visible = false;
      if (thread.current) thread.current.visible = false;
      return;
    }
    const ox = sever.originX ?? 0;
    const oz = sever.originZ ?? 0;
    const target = sever.targetId ? targetPose(room, sever.targetId) : null;
    if (!target || target.hp <= 0) {
      eg.visible = false;
      if (thread.current) thread.current.visible = false;
      return;
    }

    eg.visible = true;
    eg.position.set(ox, 0, oz);

    const dist = Math.hypot(target.x - ox, target.z - oz);
    const power = Math.max(0, Math.min(1, dist / SOUL_SEVER_CAST.severMaxDistance));
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now * (0.005 + power * 0.01));

    if (pillar.current) {
      pillar.current.scale.set(0.12 + power * 0.04, 1.55 + power * 0.2 * pulse, 0.04);
      mats.pillar.opacity = 0.22 + power * 0.28 + pulse * 0.06;
    }
    if (cross.current) {
      cross.current.scale.set(0.04, 1.45 + power * 0.15, 0.14 + power * 0.04);
      mats.cross.opacity = 0.28 + power * 0.2;
    }
    if (ground.current) {
      const s = 0.35 + power * 0.25 + pulse * 0.05;
      ground.current.scale.set(s, s, 1);
      mats.ground.opacity = 0.12 + power * 0.22 * pulse;
    }

    for (let i = 0; i < DRIP_COUNT; i++) {
      const mesh = drips.current[i];
      if (!mesh) continue;
      const cycle = ((now * 0.0012 + i * 0.37) % 1 + 1) % 1;
      const x = ((i % 3) - 1) * 0.08;
      const z = (Math.floor(i / 3) - 0.5) * 0.06;
      mesh.position.set(x, 1.35 - cycle * 1.15, z);
      const fade = cycle < 0.15 ? cycle / 0.15 : cycle > 0.7 ? 1 - (cycle - 0.7) / 0.3 : 1;
      mesh.scale.set(0.035, 0.06 + cycle * 0.08, 0.035);
      mats.drips[i]!.opacity = Math.max(0, fade) * (0.35 + power * 0.25);
      mesh.visible = true;
    }

    if (thread.current) {
      const midX = (ox + target.x) * 0.5;
      const midZ = (oz + target.z) * 0.5;
      const yaw = Math.atan2(target.x - ox, target.z - oz);
      // Intermittent — flicker more when taut.
      const flicker = 0.55 + 0.45 * Math.sin(now * (0.02 + power * 0.03) + id.length);
      thread.current.visible = dist > 0.2 && flicker > 0.35;
      thread.current.position.set(midX, 1.05, midZ);
      thread.current.rotation.set(0, yaw, 0);
      thread.current.scale.set(0.012 + power * 0.012, 0.012 + power * 0.01, Math.max(0.1, dist));
      mats.thread.opacity = (0.06 + power * 0.22) * flicker;
    }
  });

  return (
    <>
      <group ref={echo} visible={false}>
        <mesh ref={ground} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={24}>
          <ringGeometry args={[0.55, 1, 28]} />
          <primitive object={mats.ground} attach="material" />
        </mesh>
        {/* Vertical soul afterimage — crossed thin slabs, not a sphere bubble. */}
        <mesh ref={pillar} position={[0, 0.95, 0]} renderOrder={26}>
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={mats.pillar} attach="material" />
        </mesh>
        <mesh ref={cross} position={[0, 0.95, 0]} renderOrder={26}>
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={mats.cross} attach="material" />
        </mesh>
        {mats.drips.map((mat, i) => (
          <mesh
            key={`drip-${i}`}
            ref={(el) => {
              drips.current[i] = el;
            }}
            renderOrder={27}
            visible={false}
          >
            <sphereGeometry args={[1, 6, 6]} />
            <primitive object={mat} attach="material" />
          </mesh>
        ))}
      </group>
      <mesh ref={thread} renderOrder={24} visible={false}>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={mats.thread} attach="material" />
      </mesh>
    </>
  );
}

export function SoulSevers({ room }: { room: Room | null }) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    if (!room?.state?.soulSevers) {
      setIds([]);
      return;
    }
    const sync = () => {
      const next: string[] = [];
      room.state.soulSevers.forEach((_d: unknown, id: string) => next.push(id));
      setIds((prev) => {
        if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev;
        return next;
      });
    };
    sync();
    const iv = window.setInterval(sync, 200);
    return () => window.clearInterval(iv);
  }, [room]);

  if (!room) return null;
  return (
    <>
      {ids.map((id) => (
        <SoulSeverInstance key={id} room={room} id={id} />
      ))}
    </>
  );
}
