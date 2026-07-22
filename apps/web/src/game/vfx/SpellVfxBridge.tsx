import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useRef } from "react";
import { ABILITIES, phaseDurationMs } from "@battlebeasts/shared";
import { CATALOG_PROJECTILES } from "./catalog";
import { spawnCastEffect } from "./runtime";

type PlayerCast = {
  x?: number;
  z?: number;
  yaw?: number;
  castPhase?: string;
  castAbilityId?: string;
  castPhaseEndsAt?: number;
};

/** Forward offset from feet toward aim — sits under the extended cast hand. */
const BOLT_MUZZLE_FORWARD = 0.95;
const BOLT_MUZZLE_Y = 1.05;
/** Lead time before impact so muzzle reads with the extended hand. */
const MUZZLE_LEAD_MS = 150;

type PendingMuzzle = {
  abilityId: string;
  fireAt: number;
};

/**
 * Fires muzzle VFX slightly before impact (during late cast).
 * Cast FX follow the caster via `followOwnerId`.
 */
export function SpellVfxBridge({ room }: { room: Room | null }) {
  const lastPhase = useRef(new Map<string, string>());
  const pending = useRef(new Map<string, PendingMuzzle>());
  const fired = useRef(new Set<string>());

  useFrame(() => {
    if (!room?.state?.players) return;
    const now = performance.now();

    room.state.players.forEach((raw: PlayerCast, sessionId: string) => {
      const phase = raw.castPhase ?? "";
      const abilityId = raw.castAbilityId ?? "";
      const prev = lastPhase.current.get(sessionId) ?? "";

      const catalog =
        !!abilityId && CATALOG_PROJECTILES.has(abilityId);

      // Schedule muzzle 50ms before impact when cast phase begins
      if (catalog && phase === "cast" && prev !== "cast") {
        const def = ABILITIES[abilityId];
        const castMs = def ? phaseDurationMs(def, "cast") : 200;
        const fireAt = now + Math.max(0, castMs - MUZZLE_LEAD_MS);
        pending.current.set(sessionId, { abilityId, fireAt });
        fired.current.delete(sessionId);
      }

      // Cancel / leave cast window — drop pending
      if (
        phase === "idle" ||
        phase === "cancel" ||
        phase === "interrupt" ||
        phase === "" ||
        phase === "anticipation" ||
        phase === "recovery"
      ) {
        pending.current.delete(sessionId);
        if (phase !== "recovery") fired.current.delete(sessionId);
      }

      // Fire when lead time is reached (still casting or just hitting impact)
      const pend = pending.current.get(sessionId);
      if (pend && !fired.current.has(sessionId) && now >= pend.fireAt) {
        if (phase === "cast" || phase === "impact") {
          fireMuzzle(sessionId, pend.abilityId, raw);
          fired.current.add(sessionId);
          pending.current.delete(sessionId);
        }
      }

      // Fallback: impact arrived before schedule (short cast / hitch)
      if (
        catalog &&
        phase === "impact" &&
        prev !== "impact" &&
        !fired.current.has(sessionId)
      ) {
        fireMuzzle(sessionId, abilityId, raw);
        fired.current.add(sessionId);
        pending.current.delete(sessionId);
      }

      lastPhase.current.set(sessionId, phase);
    });

    for (const id of [...lastPhase.current.keys()]) {
      if (!room.state.players.get(id)) {
        lastPhase.current.delete(id);
        pending.current.delete(id);
        fired.current.delete(id);
      }
    }
  });

  return null;
}

function fireMuzzle(sessionId: string, abilityId: string, raw: PlayerCast): void {
  const yaw = raw.yaw ?? 0;
  const x = (raw.x ?? 0) + Math.sin(yaw) * BOLT_MUZZLE_FORWARD;
  const z = (raw.z ?? 0) + Math.cos(yaw) * BOLT_MUZZLE_FORWARD;
  spawnCastEffect(
    abilityId,
    { x, z, yaw, y: BOLT_MUZZLE_Y },
    { followOwnerId: sessionId, followSpawnOffset: BOLT_MUZZLE_FORWARD },
  );
}
