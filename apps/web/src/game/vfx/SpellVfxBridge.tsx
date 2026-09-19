import { useFrame } from "@react-three/fiber";
import { getAbilityVfxProfile } from "./profiles/registry";
import type { VfxRoomLike } from "./vfxRoomLike";
import { castEngines, type PlayerCastPose } from "./engines";
import {
  cancelPlayerCastHandles,
  cleanupPlayerVfx,
  forEachPlayerVfxRuntime,
  getPlayerVfxRuntime,
} from "./runtime/playerVfxRuntime";
import { cancelFollowOwnerVfx } from "./runtime";
import { stopBoltCastSfx } from "../gameSfx";

function tickCaster(sessionId: string, raw: PlayerCastPose, now: number, live: Set<string>) {
  live.add(sessionId);
  const phase = raw.castPhase ?? "";
  const abilityId = raw.castAbilityId ?? "";
  if (abilityId === "zombie_melee") {
    const runtime = getPlayerVfxRuntime(sessionId);
    runtime.lastPhase = phase;
    return;
  }
  const runtime = getPlayerVfxRuntime(sessionId);
  const prevPhase = runtime.lastPhase;
  const profile = getAbilityVfxProfile(abilityId);
  const engine = castEngines[profile.castEngine];

  const ctx = {
    sessionId,
    abilityId,
    phase,
    prevPhase,
    now,
    pose: raw,
    profile,
  };

  engine.onPhaseChange(ctx);
  engine.tick?.(ctx);

  // Leave cast window. Successful ownedByCast launches (fireball / ice lance)
  // already cleared their handle in onImpact / onReleaseRecovery without
  // canceling the shot — so anything still handled here is an abort and
  // must be canceled (schema clears to "" on cancel, never "cancel").
  if (
    phase === "cancel" ||
    phase === "interrupt" ||
    phase === "idle" ||
    phase === ""
  ) {
    cancelPlayerCastHandles(sessionId);
  }

  runtime.lastPhase = phase;
}

/**
 * Phase-driven cast VFX — routes each ability to a timing engine via AbilityVfxProfile.
 * Melee swoops (crescent) spawn from combat_fx instead.
 */
export function SpellVfxBridge({ room }: { room: VfxRoomLike | null }) {
  useFrame(() => {
    if (!room?.state) return;
    const now = performance.now();
    const live = new Set<string>();

    room.state.players?.forEach((raw: PlayerCastPose, sessionId: string) => {
      tickCaster(sessionId, raw, now, live);
    });

    room.state.targets?.forEach((raw: PlayerCastPose & { kind?: string }, id: string) => {
      const kind = raw.kind;
      if (kind !== "dummy" && kind !== "elite" && kind !== "lab_copy") return;
      tickCaster(id, raw, now, live);
    });

    forEachPlayerVfxRuntime((sessionId) => {
      if (live.has(sessionId)) return;
      cancelFollowOwnerVfx("barrier", sessionId);
      cleanupPlayerVfx(sessionId);
      stopBoltCastSfx(sessionId);
    });
  });

  return null;
}
