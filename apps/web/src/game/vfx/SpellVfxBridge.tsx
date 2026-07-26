import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useRef } from "react";
import { ABILITIES, phaseDurationMs, totalCastDurationMs, POISON_DART_CAST } from "@battlebeasts/shared";
import { CATALOG_CAST_FX, usesBridgedAoeFx, usesMeleeSwoopFx } from "./catalog";
import { spawnCastEffect, spawnImpactEffect, cancelFollowOwnerVfx } from "./runtime";
import type { VfxHandle } from "./types";
import { FROST_HAND_FORWARD, FROST_HAND_Y } from "./effects/frostBallCast";
import { stopBoltCastSfx } from "../gameSfx";

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
 * Frost Ball grows one orb from anticipation; that same shot becomes the projectile.
 * Gust spawns suck→blow ground VFX at anticipation (timed to anim frames).
 * Cast FX follow the caster via `followOwnerId`.
 * Melee swoops (crescent) spawn from combat_fx instead.
 */
export function SpellVfxBridge({ room }: { room: Room | null }) {
  const lastPhase = useRef(new Map<string, string>());
  const pending = useRef(new Map<string, PendingMuzzle>());
  const fired = useRef(new Set<string>());
  const frostHand = useRef(new Map<string, VfxHandle>());
  const barrierCast = useRef(new Map<string, VfxHandle>());
  const gustWave = useRef(new Map<string, VfxHandle>());

  useFrame(() => {
    if (!room?.state?.players) return;
    const now = performance.now();

    room.state.players.forEach((raw: PlayerCast, sessionId: string) => {
      const phase = raw.castPhase ?? "";
      const abilityId = raw.castAbilityId ?? "";
      const prev = lastPhase.current.get(sessionId) ?? "";

      const catalog =
        !!abilityId && CATALOG_CAST_FX.has(abilityId) && !usesMeleeSwoopFx(abilityId);
      const isFrost = abilityId === "frostBall";
      const isBarrier = abilityId === "barrier";
      const isGust = usesBridgedAoeFx(abilityId);

      // Gust: ground wave starts with anticipation so frame 48/54 line up.
      if (isGust && phase === "anticipation" && prev !== "anticipation") {
        gustWave.current.get(sessionId)?.cancel();
        const def = ABILITIES[abilityId];
        const lifeMs = def ? totalCastDurationMs(def) + 280 : 2200;
        gustWave.current.set(
          sessionId,
          spawnImpactEffect(
            abilityId,
            { x: raw.x ?? 0, z: raw.z ?? 0, y: 0.04, yaw: raw.yaw ?? 0 },
            { followOwnerId: sessionId, followSpawnOffset: 0, lifeMs },
          ),
        );
      }

      // Frost: one orb from anticipation → flight. Same mesh becomes the projectile.
      // Anticipation is short (~100ms) and often skipped in schema patches —
      // also start on cast if we never saw anticipation.
      if (catalog && isFrost) {
        const enteringAnticipation = phase === "anticipation" && prev !== "anticipation";
        const missedAnticipation =
          phase === "cast" &&
          prev !== "anticipation" &&
          prev !== "cast" &&
          !frostHand.current.has(sessionId);
        if (enteringAnticipation || missedAnticipation) {
          frostHand.current.get(sessionId)?.cancel();
          const def = ABILITIES[abilityId];
          const chargeMs = def
            ? (enteringAnticipation
                ? phaseDurationMs(def, "anticipation") + phaseDurationMs(def, "cast")
                : phaseDurationMs(def, "cast")) + 120
            : 520;
          const flightMs = def
            ? ((def.range > 0 ? def.range : 12.5) / (def.speed ?? 3.5)) * 1000
            : 3600;
          // Charge grow + full drift + coast fade — one shot, no second spawn.
          const lifeMs = chargeMs + flightMs + 700;
          const yaw = raw.yaw ?? 0;
          const x = (raw.x ?? 0) + Math.sin(yaw) * FROST_HAND_FORWARD;
          const z = (raw.z ?? 0) + Math.cos(yaw) * FROST_HAND_FORWARD;
          frostHand.current.set(
            sessionId,
            spawnCastEffect(
              abilityId,
              { x, z, yaw, y: FROST_HAND_Y },
              {
                followOwnerId: sessionId,
                followSpawnOffset: FROST_HAND_FORWARD,
                lifeMs,
                chargeMs,
              },
            ),
          );
        }
      }

      // Barrier: rising ground particles + growing bubble from cast start.
      if (catalog && isBarrier) {
        const enteringAnticipation = phase === "anticipation" && prev !== "anticipation";
        const missedAnticipation =
          phase === "cast" &&
          prev !== "anticipation" &&
          prev !== "cast" &&
          !barrierCast.current.has(sessionId);
        if (enteringAnticipation || missedAnticipation) {
          barrierCast.current.get(sessionId)?.cancel();
          cancelFollowOwnerVfx("barrier", sessionId);
          const def = ABILITIES[abilityId];
          const chargeMs = def
            ? (enteringAnticipation
                ? phaseDurationMs(def, "anticipation") + phaseDurationMs(def, "cast")
                : phaseDurationMs(def, "cast")) + 80
            : 800;
          // Charge grow + full shield window (3s) + dissolve.
          const lifeMs = chargeMs + 3200 + 500;
          barrierCast.current.set(
            sessionId,
            spawnCastEffect(
              abilityId,
              { x: raw.x ?? 0, z: raw.z ?? 0, yaw: raw.yaw ?? 0, y: 0 },
              {
                followOwnerId: sessionId,
                followSpawnOffset: 0,
                lifeMs,
                chargeMs,
              },
            ),
          );
        }
      }

      // Bolt-style: schedule muzzle when cast phase begins
      if (catalog && !isFrost && !isBarrier && phase === "cast" && prev !== "cast") {
        const def = ABILITIES[abilityId];
        const castMs = def ? phaseDurationMs(def, "cast") : 200;
        // Poison Dart: release exactly at impact (Right Hook frame 11) — no early lead.
        const leadMs = abilityId === "poisonDart" ? 0 : MUZZLE_LEAD_MS;
        const fireAt = now + Math.max(0, castMs - leadMs);
        pending.current.set(sessionId, { abilityId, fireAt });
        fired.current.delete(sessionId);
      }

      // Cancel / leave cast window — drop pending + frost hand if aborted
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
        if (phase === "cancel" || phase === "interrupt" || phase === "idle" || phase === "") {
          frostHand.current.get(sessionId)?.cancel();
          frostHand.current.delete(sessionId);
          barrierCast.current.get(sessionId)?.cancel();
          barrierCast.current.delete(sessionId);
          gustWave.current.get(sessionId)?.cancel();
          gustWave.current.delete(sessionId);
        }
      }

      // Clear frost handle after impact (shot continues as the projectile visual)
      if (isFrost && phase === "impact" && prev !== "impact") {
        if (!frostHand.current.has(sessionId)) {
          // Missed cast patches — spawn full-size orb that latches to the projectile.
          const def = ABILITIES[abilityId];
          const flightMs = def
            ? ((def.range > 0 ? def.range : 12.5) / (def.speed ?? 3.5)) * 1000
            : 3600;
          const yaw = raw.yaw ?? 0;
          const x = (raw.x ?? 0) + Math.sin(yaw) * FROST_HAND_FORWARD;
          const z = (raw.z ?? 0) + Math.cos(yaw) * FROST_HAND_FORWARD;
          frostHand.current.set(
            sessionId,
            spawnCastEffect(
              abilityId,
              { x, z, yaw, y: FROST_HAND_Y },
              {
                followOwnerId: sessionId,
                followSpawnOffset: FROST_HAND_FORWARD,
                lifeMs: flightMs + 700,
                chargeMs: 1,
              },
            ),
          );
        }
        frostHand.current.delete(sessionId);
      }
      // Barrier shot keeps running through the shield buff — only drop the handle map entry.
      if (isBarrier && phase === "impact" && prev !== "impact") {
        barrierCast.current.delete(sessionId);
      }
      if (isGust && phase === "recovery" && prev !== "recovery") {
        gustWave.current.delete(sessionId);
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
        !isFrost &&
        !isBarrier &&
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
        frostHand.current.get(id)?.cancel();
        frostHand.current.delete(id);
        barrierCast.current.get(id)?.cancel();
        barrierCast.current.delete(id);
        cancelFollowOwnerVfx("barrier", id);
        gustWave.current.get(id)?.cancel();
        gustWave.current.delete(id);
        stopBoltCastSfx(id);
      }
    }
  });

  return null;
}

function fireMuzzle(sessionId: string, abilityId: string, raw: PlayerCast): void {
  const yaw = raw.yaw ?? 0;
  const forward =
    abilityId === "poisonDart" ? POISON_DART_CAST.spawnOffset : BOLT_MUZZLE_FORWARD;
  const y = abilityId === "poisonDart" ? POISON_DART_CAST.handY : BOLT_MUZZLE_Y;
  const x = (raw.x ?? 0) + Math.sin(yaw) * forward;
  const z = (raw.z ?? 0) + Math.cos(yaw) * forward;
  spawnCastEffect(
    abilityId,
    { x, z, yaw, y },
    { followOwnerId: sessionId, followSpawnOffset: forward },
  );
}
