import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { getAbilityVfxProfile } from "./profiles/registry";
import { castEngines, type PlayerCastPose } from "./engines";
import {
  cancelPlayerCastHandles,
  cleanupPlayerVfx,
  forEachPlayerVfxRuntime,
  getPlayerVfxRuntime,
} from "./runtime/playerVfxRuntime";
import { cancelFollowOwnerVfx } from "./runtime";
import { stopBoltCastSfx } from "../gameSfx";

/**
 * Phase-driven cast VFX — routes each ability to a timing engine via AbilityVfxProfile.
 * Melee swoops (crescent) spawn from combat_fx instead.
 */
export function SpellVfxBridge({ room }: { room: Room | null }) {
  useFrame(() => {
    if (!room?.state?.players) return;
    const now = performance.now();
    const live = new Set<string>();

    room.state.players.forEach((raw: PlayerCastPose, sessionId: string) => {
      live.add(sessionId);
      const phase = raw.castPhase ?? "";
      const abilityId = raw.castAbilityId ?? "";
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
