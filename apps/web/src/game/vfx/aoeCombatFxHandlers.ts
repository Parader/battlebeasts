import {
  ABILITIES,
  ARC_THREAD_CAST,
  FIREBALL_CAST,
  FIREWALL_CAST,
  FROST_MIST_CAST,
  GROOVE_CAST,
  HEAL_BEAM_CAST,
  HOLY_GROUND_CAST,
  LIFE_LEECH_CAST,
  POISON_CLOUD_CAST,
  SMOKE_BOMB_CAST,
  VOLCANO_CAST,
} from "@battlebeasts/shared";
import { playSlamHitSfx } from "../gameSfx";
import type { CombatFxDispatchCtx, CombatFxMessage } from "./combatFxTypes";
import type { CombatFxAoeMode } from "./profiles/types";
import { CHANNEL_VFX } from "./profiles/registry";
import { cancelFollowOwnerVfx, spawnImpactEffect } from "./runtime";

function ownerYaw(msg: CombatFxMessage, ctx: CombatFxDispatchCtx, fallback = 0): number {
  let yaw = typeof msg.yaw === "number" ? msg.yaw : fallback;
  if (!msg.ownerId) return yaw;
  const owner = ctx.getOwner(msg.ownerId);
  const localOwner = msg.ownerId === ctx.localSessionId;
  return localOwner ? ctx.localYaw : (owner?.yaw ?? yaw);
}

type AoeHandler = (msg: CombatFxMessage, ctx: CombatFxDispatchCtx) => void;

/**
 * Profile `combatFx.onAoe` → spawn. Add new ground/channel FX here instead of
 * another `if (effectKindAoe === …)` arm in `dispatchCombatFxVfx`.
 */
export const AOE_COMBAT_FX_HANDLERS: Partial<Record<CombatFxAoeMode, AoeHandler>> = {
  groundCrack: (msg) => {
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.04 },
      { radius: msg.radius ?? ABILITIES.smash?.radius ?? 1.65 },
    );
    if (msg.abilityId === "smash") playSlamHitSfx();
  },

  spikes: (msg) => {
    spawnImpactEffect(msg.abilityId, { x: msg.x, z: msg.z, y: 0.02 }, { lifeMs: 560 });
  },

  firewall: (msg) => {
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.03, yaw: msg.yaw },
      { lifeMs: FIREWALL_CAST.zoneDurationMs + 100, radius: msg.radius },
    );
  },

  poisonCloud: (msg) => {
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.03, yaw: msg.yaw },
      {
        lifeMs: POISON_CLOUD_CAST.zoneDurationMs + 200,
        radius: msg.radius ?? POISON_CLOUD_CAST.radius,
        originX: msg.x2,
        originZ: msg.z2,
      },
    );
  },

  smokeBomb: (msg) => {
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.03, yaw: msg.yaw },
      {
        lifeMs: SMOKE_BOMB_CAST.zoneDurationMs + 200,
        radius: msg.radius ?? SMOKE_BOMB_CAST.radius,
      },
    );
  },

  holyGround: (msg) => {
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.03, yaw: msg.yaw },
      {
        lifeMs: HOLY_GROUND_CAST.zoneDurationMs + 200,
        radius: msg.radius ?? HOLY_GROUND_CAST.radius,
      },
    );
  },

  fireballBurn: (msg) => {
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.03 },
      {
        lifeMs: FIREBALL_CAST.burnDurationMs + 200,
        radius: msg.radius ?? FIREBALL_CAST.burnRadiusMax,
      },
    );
  },

  volcano: (msg) => {
    if (msg.variant === 1) {
      spawnImpactEffect(
        msg.abilityId,
        { x: msg.x, z: msg.z, y: 0.04 },
        {
          lifeMs: VOLCANO_CAST.telegraphMs,
          variant: 1,
          radius: msg.radius ?? VOLCANO_CAST.rockBlastRadius,
          originX: msg.x2,
          originZ: msg.z2,
        },
      );
    } else if (msg.variant === 2) {
      spawnImpactEffect(
        msg.abilityId,
        { x: msg.x, z: msg.z, y: 0.04 },
        {
          lifeMs: 900,
          variant: 2,
          radius: msg.radius ?? VOLCANO_CAST.rockBlastRadius,
        },
      );
    }
  },

  iceLanceExplode: (msg) => {
    spawnImpactEffect(
      msg.abilityId,
      {
        x: msg.x,
        z: msg.z,
        y: typeof msg.y === "number" ? msg.y : 0.85,
      },
      { lifeMs: 900, radius: msg.radius ?? 2.0 },
    );
  },

  channelOnce: (msg, ctx) => {
    if ((msg.comboHit ?? 1) !== 1) return;
    const yaw = ownerYaw(msg, ctx);
    const mistDef = ABILITIES.frostMist;
    const ch = CHANNEL_VFX.frostMist;
    const channelMs = ch.ticks * ch.tickMs + ch.lifePadMs;
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.04, yaw },
      {
        lifeMs: channelMs,
        radius: mistDef?.range ?? ch.fallbackRange,
        startRadius: mistDef?.mistStartRange ?? ch.fallbackStartRange,
        growMs: FROST_MIST_CAST.mistGrowMs,
        followOwnerId: msg.ownerId,
      },
    );
  },

  groove: (msg, ctx) => {
    const yaw = ownerYaw(msg, ctx);
    const grooveDef = ABILITIES.groove;
    const ch = CHANNEL_VFX.groove;
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 1.0, yaw },
      {
        lifeMs: GROOVE_CAST.channelMs + ch.lifePadMs,
        radius: grooveDef?.radius ?? ch.fallbackRadius,
        followOwnerId: msg.ownerId,
      },
    );
  },

  healBeam: (msg, ctx) => {
    if ((msg.comboHit ?? 1) !== 1) return;
    const yaw = ownerYaw(msg, ctx);
    const beamDef = ABILITIES.healBeam;
    const ch = CHANNEL_VFX.healBeam;
    const channelMs = ch.ticks * ch.tickMs + ch.lifePadMs;
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 1.1, yaw },
      {
        lifeMs: channelMs,
        radius: beamDef?.range ?? HEAL_BEAM_CAST.range,
        growMs: ch.growMs,
        followOwnerId: msg.ownerId,
      },
    );
  },

  lifeLeech: (msg, ctx) => {
    if ((msg.comboHit ?? 1) !== 1) return;
    const yaw = ownerYaw(msg, ctx);
    const beamDef = ABILITIES.lifeLeech;
    const ch = CHANNEL_VFX.lifeLeech;
    const channelMs = beamDef?.holdChannel
      ? LIFE_LEECH_CAST.holdMaxMs + ch.lifePadMs
      : ch.ticks * ch.tickMs + ch.lifePadMs;
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 1.1, yaw },
      {
        lifeMs: channelMs,
        radius: beamDef?.range ?? LIFE_LEECH_CAST.range,
        growMs: ch.growMs,
        followOwnerId: msg.ownerId,
      },
    );
  },

  arcThread: (msg, ctx) => {
    const yaw = ownerYaw(msg, ctx);
    if (msg.variant === 2) {
      if (msg.ownerId) cancelFollowOwnerVfx(msg.abilityId, msg.ownerId);
      spawnImpactEffect(
        msg.abilityId,
        { x: msg.x, z: msg.z, y: 1.1, yaw },
        {
          lifeMs: 280,
          variant: 2,
          followOwnerId: msg.ownerId,
          followTargetId: msg.targetId,
        },
      );
      return;
    }
    if (msg.variant === 1) {
      if (msg.ownerId) cancelFollowOwnerVfx(msg.abilityId, msg.ownerId);
      spawnImpactEffect(
        msg.abilityId,
        { x: msg.x, z: msg.z, y: 1.1, yaw },
        {
          lifeMs: 320,
          variant: 1,
          followOwnerId: msg.ownerId,
          followTargetId: msg.targetId,
        },
      );
      return;
    }
    if ((msg.comboHit ?? 1) !== 1 || !msg.targetId) return;
    const lifeMs =
      typeof msg.phaseEndsAt === "number"
        ? Math.max(120, msg.phaseEndsAt - Date.now())
        : ARC_THREAD_CAST.threadDurationMs;
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: ARC_THREAD_CAST.handY, yaw },
      {
        lifeMs,
        followOwnerId: msg.ownerId,
        followTargetId: msg.targetId,
        radius: msg.radius ?? ARC_THREAD_CAST.range,
      },
    );
  },

  catalogImpact: (msg, ctx) => {
    const yaw = ownerYaw(msg, ctx);
    spawnImpactEffect(msg.abilityId, { x: msg.x, z: msg.z, y: 0.04, yaw });
  },

  silenceSweep: () => {
    // Owned by bridged cast / catalog cast path.
  },

  none: () => {},
};

export function dispatchAoeCombatFx(
  msg: CombatFxMessage,
  ctx: CombatFxDispatchCtx,
  mode: CombatFxAoeMode | undefined,
): void {
  if (msg.kind !== "aoe" || !mode || mode === "none") return;
  AOE_COMBAT_FX_HANDLERS[mode]?.(msg, ctx);
}
