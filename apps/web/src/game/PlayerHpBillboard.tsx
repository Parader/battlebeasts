import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { COMBAT_ENGAGE_LINGER_MS, PLAYER_BASE_MAX_HP, totalShieldAbsorb } from "@battlebeasts/shared";
import {
  StatusHpBadgeStack,
  readBleedingStacks,
  readBurningStacks,
  readPoisonStacks,
  readRejuvenationStacks,
  syncBleedingBadge,
  syncBurningBadge,
  syncPoisonBadge,
  syncRejuvenationBadge,
} from "./StatusHpBadgeStack";
import { isRevengeVanished } from "./revengeVanishRuntime";

type Props = {
  room: Room | null;
  sessionId: string | null;
  /** Height above the character root. */
  y?: number;
};

/**
 * Camera-facing HP (+ optional shield) bar above a player.
 * Visible while in combat (damaged / casting / DoT / linger); hidden out of combat.
 */
export function PlayerHpBillboard({ room, sessionId, y = 2.2 }: Props) {
  const root = useRef<THREE.Group>(null);
  const fill = useRef<THREE.Mesh>(null);
  const shield = useRef<THREE.Mesh>(null);
  const poisonBadge = useRef<HTMLDivElement>(null);
  const poisonStacksEl = useRef<HTMLSpanElement>(null);
  const burningBadge = useRef<HTMLDivElement>(null);
  const bleedingBadge = useRef<HTMLDivElement>(null);
  const bleedingStacksEl = useRef<HTMLSpanElement>(null);
  const rejuvenationBadge = useRef<HTMLDivElement>(null);
  const rejuvenationStacksEl = useRef<HTMLSpanElement>(null);
  const lingerUntil = useRef(0);
  const prevHp = useRef<number | null>(null);
  const lastPoisonStacks = useRef(0);
  const lastBleedingStacks = useRef(0);
  const lastRejuvenationStacks = useRef(0);

  useFrame(() => {
    const g = root.current;
    const m = fill.current;
    const s = shield.current;
    const badge = poisonBadge.current;
    const burnBadge = burningBadge.current;
    const bleedBadge = bleedingBadge.current;
    const rejBadge = rejuvenationBadge.current;
    if (!g || !m || !sessionId || !room) {
      if (g) g.visible = false;
      if (badge) badge.style.display = "none";
      if (burnBadge) burnBadge.style.display = "none";
      if (bleedBadge) bleedBadge.style.display = "none";
      if (rejBadge) rejBadge.style.display = "none";
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
      if (badge) badge.style.display = "none";
      if (burnBadge) burnBadge.style.display = "none";
      if (bleedBadge) bleedBadge.style.display = "none";
      if (rejBadge) rejBadge.style.display = "none";
      prevHp.current = p?.hp ?? null;
      lastPoisonStacks.current = 0;
      lastBleedingStacks.current = 0;
      lastRejuvenationStacks.current = 0;
      return;
    }

    let revengePhased = false;
    p.statuses?.forEach((row) => {
      if (row?.statusId === "revengePhased") revengePhased = true;
    });
    if (isRevengeVanished(sessionId) || revengePhased) {
      g.visible = false;
      if (badge) badge.style.display = "none";
      if (burnBadge) burnBadge.style.display = "none";
      if (bleedBadge) bleedBadge.style.display = "none";
      if (rejBadge) rejBadge.style.display = "none";
      return;
    }

    const maxHp = Math.max(1, p.maxHp ?? PLAYER_BASE_MAX_HP);
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
    const poisonStacks = readPoisonStacks(rows);
    const burningStacks = readBurningStacks(rows);
    const bleedingStacks = readBleedingStacks(rows);
    const rejuvenationStacks = readRejuvenationStacks(rows);
    const poisoned = poisonStacks > 0;
    const burning = burningStacks > 0;
    const bleeding = bleedingStacks > 0;
    const rejuvenating = rejuvenationStacks > 0;

    if (prevHp.current != null && p.hp < prevHp.current - 0.05) {
      lingerUntil.current = now + COMBAT_ENGAGE_LINGER_MS;
    }
    prevHp.current = p.hp;

    if (damaged || shieldRatio > 0 || casting || poisoned || burning || bleeding || rejuvenating) {
      lingerUntil.current = now + COMBAT_ENGAGE_LINGER_MS;
    }

    const show =
      damaged ||
      shieldRatio > 0 ||
      casting ||
      poisoned ||
      burning ||
      bleeding ||
      rejuvenating ||
      now < lingerUntil.current;

    g.visible = show;
    if (!show) {
      if (badge) badge.style.display = "none";
      if (burnBadge) burnBadge.style.display = "none";
      if (bleedBadge) bleedBadge.style.display = "none";
      if (rejBadge) rejBadge.style.display = "none";
      lastPoisonStacks.current = 0;
      lastBleedingStacks.current = 0;
      lastRejuvenationStacks.current = 0;
      return;
    }

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

    syncPoisonBadge(badge, poisonStacksEl.current, poisonStacks, lastPoisonStacks);
    syncBurningBadge(burnBadge, burningStacks);
    syncBleedingBadge(bleedBadge, bleedingStacksEl.current, bleedingStacks, lastBleedingStacks);
    syncRejuvenationBadge(
      rejBadge,
      rejuvenationStacksEl.current,
      rejuvenationStacks,
      lastRejuvenationStacks,
    );
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
        <StatusHpBadgeStack
          poisonBadgeRef={poisonBadge}
          poisonStacksRef={poisonStacksEl}
          burningBadgeRef={burningBadge}
          bleedingBadgeRef={bleedingBadge}
          bleedingStacksRef={bleedingStacksEl}
          rejuvenationBadgeRef={rejuvenationBadge}
          rejuvenationStacksRef={rejuvenationStacksEl}
        />
      </group>
    </Billboard>
  );
}
