import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { totalShieldAbsorb } from "@battlebeasts/shared";

type Props = {
  room: Room | null;
  sessionId: string | null;
  /** Height above the character root. */
  y?: number;
};

const COMBAT_LINGER_MS = 3500;

/**
 * Camera-facing HP (+ optional shield) bar above a player.
 * Hidden when dead, disconnected, or out of combat (full HP, no shield/cast, after linger).
 */
export function PlayerHpBillboard({ room, sessionId, y = 2.2 }: Props) {
  const root = useRef<THREE.Group>(null);
  const fill = useRef<THREE.Mesh>(null);
  const shield = useRef<THREE.Mesh>(null);
  const lingerUntil = useRef(0);
  const prevHp = useRef<number | null>(null);

  useFrame(() => {
    const g = root.current;
    const m = fill.current;
    const s = shield.current;
    if (!g || !m || !sessionId || !room) {
      if (g) g.visible = false;
      return;
    }
    const p = room.state?.players?.get(sessionId) as
      | {
          hp?: number;
          maxHp?: number;
          castPhase?: string;
          disconnected?: boolean;
          statuses?: {
            forEach: (cb: (row: { statusId?: string; stacks?: number }) => void) => void;
          };
        }
      | undefined;
    if (!p || p.disconnected || typeof p.hp !== "number" || p.hp <= 0) {
      g.visible = false;
      prevHp.current = p?.hp ?? null;
      return;
    }

    const maxHp = Math.max(1, p.maxHp ?? 100);
    const ratio = Math.max(0, Math.min(1, p.hp / maxHp));
    const rows: { statusId?: string; stacks?: number }[] = [];
    p.statuses?.forEach((row) => {
      if (row?.statusId) rows.push(row);
    });
    const shieldAmt = totalShieldAbsorb(rows);
    const shieldRatio = Math.max(0, Math.min(1, shieldAmt / maxHp));
    const casting = Boolean(p.castPhase);
    const damaged = p.hp < maxHp - 0.05;
    const now = performance.now();

    if (prevHp.current != null && p.hp < prevHp.current - 0.05) {
      lingerUntil.current = now + COMBAT_LINGER_MS;
    }
    prevHp.current = p.hp;

    if (damaged || shieldRatio > 0 || casting) {
      lingerUntil.current = now + COMBAT_LINGER_MS;
    }

    const inCombat = damaged || shieldRatio > 0 || casting || now < lingerUntil.current;
    if (!inCombat) {
      g.visible = false;
      return;
    }

    g.visible = true;
    m.scale.x = Math.max(0.001, ratio);
    m.position.x = -0.5 * (1 - ratio);

    if (s) {
      if (shieldRatio <= 0) {
        s.visible = false;
      } else {
        s.visible = true;
        s.scale.x = Math.max(0.001, shieldRatio);
        const left = Math.min(ratio, Math.max(0, 1 - shieldRatio));
        s.position.x = -0.5 + left + shieldRatio * 0.5;
      }
    }
  });

  return (
    <Billboard position={[0, y, 0]} follow>
      <group ref={root} visible={false}>
        <mesh>
          <planeGeometry args={[1.05, 0.08]} />
          <meshBasicMaterial color="#111827" depthTest={false} toneMapped={false} />
        </mesh>
        <mesh ref={fill} position={[0, 0, 0.01]}>
          <planeGeometry args={[1, 0.055]} />
          <meshBasicMaterial color="#4ade80" depthTest={false} toneMapped={false} />
        </mesh>
        <mesh ref={shield} position={[0, 0, 0.02]} visible={false}>
          <planeGeometry args={[1, 0.055]} />
          <meshBasicMaterial color="#60a5fa" depthTest={false} toneMapped={false} />
        </mesh>
      </group>
    </Billboard>
  );
}
