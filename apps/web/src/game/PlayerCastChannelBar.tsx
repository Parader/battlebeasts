import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { Room } from "colyseus.js";
import * as THREE from "three";
import {
  ABILITIES,
  fireballAppearWallMs,
  fireballChargeWindowWallMs,
  totalCastDurationMs,
} from "@battlebeasts/shared";
import { chargeHudRuntime } from "./chargeHudRuntime";
import { isRevengeVanished } from "./revengeVanishRuntime";

type Props = {
  room: Room | null;
  sessionId: string | null;
  /** Height above feet — sits under the body, above the aim ring. */
  y?: number;
};

/**
 * Fireball cast progress under the caster (camera-facing).
 * Local: chargeHudRuntime (optimistic). Others: schema castLockUntil.
 */
export function PlayerCastChannelBar({ room, sessionId, y = 0.02 }: Props) {
  const root = useRef<THREE.Group>(null);
  const fill = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const g = root.current;
    const m = fill.current;
    if (!g || !m || !sessionId || !room) {
      if (g) g.visible = false;
      return;
    }

    const p = room.state?.players?.get(sessionId) as
      | {
          castPhase?: string;
          castAbilityId?: string;
          castLockUntil?: number;
          hp?: number;
          disconnected?: boolean;
          statuses?: { forEach: (cb: (row: { statusId?: string }) => void) => void };
        }
      | undefined;

    if (!p || p.disconnected || (typeof p.hp === "number" && p.hp <= 0)) {
      g.visible = false;
      return;
    }

    let revengePhased = false;
    p.statuses?.forEach((row) => {
      if (row?.statusId === "revengePhased") revengePhased = true;
    });
    if (isRevengeVanished(sessionId) || revengePhased) {
      g.visible = false;
      return;
    }

    const now = performance.now();
    const hud = chargeHudRuntime.getState();
    let fill01 = -1;

    // Local optimistic bar (same session that owns the HUD bus).
    if (
      hud.active &&
      hud.abilityId === "fireball" &&
      room.sessionId === sessionId
    ) {
      fill01 = Math.min(1, Math.max(0, (now - hud.startedAt) / Math.max(1, hud.maxMs)));
    } else if (
      p.castAbilityId === "fireball" &&
      p.castPhase === "impact"
    ) {
      const def = ABILITIES.fireball;
      const total = totalCastDurationMs(def);
      const lockUntil = p.castLockUntil ?? 0;
      const startedAt = lockUntil > 0 ? lockUntil - total : 0;
      const chargeMs = fireballChargeWindowWallMs();
      // Channel starts when the ball appears (after windup).
      const chargeStart = startedAt + fireballAppearWallMs();
      if (chargeStart > 0 && chargeMs > 0) {
        const wallNow = Date.now();
        const elapsedWall = Math.max(0, wallNow - chargeStart);
        fill01 = Math.min(1, elapsedWall / chargeMs);
      }
    }

    if (fill01 < 0) {
      g.visible = false;
      return;
    }

    g.visible = true;
    m.scale.x = Math.max(0.001, fill01);
    m.position.x = -0.5 * (1 - fill01);
  });

  return (
    <Billboard position={[0, y, 0]} follow>
      <group ref={root} visible={false}>
        <mesh>
          <planeGeometry args={[0.95, 0.07]} />
          <meshBasicMaterial color="#1c0a0a" depthTest={false} toneMapped={false} />
        </mesh>
        <mesh ref={fill} position={[0, 0, 0.01]}>
          <planeGeometry args={[0.9, 0.045]} />
          <meshBasicMaterial color="#f97316" depthTest={false} toneMapped={false} />
        </mesh>
      </group>
    </Billboard>
  );
}
