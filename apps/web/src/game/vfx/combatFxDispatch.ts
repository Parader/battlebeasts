import {
  ABILITIES,
  COMBAT_FX_VARIANT_WALL_HIT,
  FIREWALL_CAST,
  FROST_MIST_CAST,
  GROOVE_CAST,
  HEAL_BEAM_CAST,
  VOLCANO_CAST,
} from "@battlebeasts/shared";
import { abilityVfxColor } from "./colors";
import { spawnImpactEffect } from "./runtime";
import { CHANNEL_VFX, getAbilityVfxProfile } from "./profiles/registry";
import {
  usesAoeCrackFx,
  usesBridgedAoeFx,
  usesFirewallFx,
  usesFrostMistFx,
  usesGrooveFx,
  usesHealBeamFx,
  usesIceLanceExplodeFx,
  usesMeleeSwoopFx,
  usesSpikeFx,
  usesVolcanoFx,
} from "./catalog";
import { notifyCrescentHit, notifyCrescentMelee } from "./crescentSpawn";
import { playBoltHitSfx, playSlamHitSfx } from "../gameSfx";
import type { FxBurst } from "../CombatVfx";

export type CombatFxMessage = {
  kind: "aoe" | "melee" | "dash" | "hit" | "cast_phase" | "portal";
  abilityId: string;
  x: number;
  z: number;
  y?: number;
  x2?: number;
  z2?: number;
  radius?: number;
  yaw?: number;
  ownerId?: string;
  damage?: number;
  crit?: boolean;
  phase?: string;
  phaseEndsAt?: number;
  cooldownMs?: number;
  comboHit?: number;
  variant?: number;
};

export type CombatFxDispatchCtx = {
  localSessionId: string | null;
  localYaw: number;
  predicted: { x: number; z: number };
  getOwner: (ownerId: string) => { x?: number; z?: number; yaw?: number } | undefined;
  pushBurst: (burst: FxBurst) => void;
  nextFxKey: () => number;
  fxColors: Record<"aoe" | "melee" | "dash" | "hit", string>;
};

function resolveOwnerYaw(
  msg: CombatFxMessage,
  ctx: CombatFxDispatchCtx,
  fallback = 0,
): number {
  let yaw = typeof msg.yaw === "number" ? msg.yaw : fallback;
  if (!msg.ownerId) return yaw;
  const owner = ctx.getOwner(msg.ownerId);
  const localOwner = msg.ownerId === ctx.localSessionId;
  return localOwner ? ctx.localYaw : (owner?.yaw ?? yaw);
}

function shouldSkipLegacyBurst(msg: CombatFxMessage): boolean {
  return (
    (usesMeleeSwoopFx(msg.abilityId) && (msg.kind === "melee" || msg.kind === "hit")) ||
    (usesAoeCrackFx(msg.abilityId) && msg.kind === "aoe") ||
    (usesBridgedAoeFx(msg.abilityId) && msg.kind === "aoe") ||
    (usesSpikeFx(msg.abilityId) && msg.kind === "aoe") ||
    (usesFrostMistFx(msg.abilityId) && msg.kind === "aoe") ||
    (usesGrooveFx(msg.abilityId) && msg.kind === "aoe") ||
    (usesHealBeamFx(msg.abilityId) && msg.kind === "aoe") ||
    (usesFirewallFx(msg.abilityId) && msg.kind === "aoe") ||
    (usesIceLanceExplodeFx(msg.abilityId) && msg.kind === "aoe") ||
    (usesVolcanoFx(msg.abilityId) && msg.kind === "aoe") ||
    (msg.abilityId === "protectionBubble" && msg.kind === "aoe") ||
    (msg.abilityId === "shrooms" && msg.kind === "aoe") ||
    (msg.abilityId === "bloodRush" && msg.kind === "dash") ||
    (msg.abilityId === "spiritForm" && msg.kind === "dash") ||
    // Hit lands at the teleport spot during the invisible window — skip so we
    // don't flash a "reappear" burst before the vanish ends. Dash puff stays.
    (msg.abilityId === "revenge" && msg.kind === "hit") ||
    (msg.kind === "hit" && msg.variant === COMBAT_FX_VARIANT_WALL_HIT) ||
    Boolean(getAbilityVfxProfile(msg.abilityId).combatFx?.skipLegacyBurst && msg.kind === "dash")
  );
}

/**
 * Profile-driven combat_fx VFX spawning (not portal / cast_phase gameplay).
 * Returns true when the message was fully handled as portal (caller should return).
 */
export function dispatchCombatFxVfx(
  msg: CombatFxMessage,
  ctx: CombatFxDispatchCtx,
): { handledPortal: boolean } {
  if (msg.kind === "portal") {
    return { handledPortal: false };
  }
  if (msg.kind === "cast_phase") {
    return { handledPortal: false };
  }

  if (msg.kind === "hit" && msg.variant === COMBAT_FX_VARIANT_WALL_HIT) {
    spawnImpactEffect(
      msg.abilityId,
      {
        x: msg.x,
        z: msg.z,
        y: typeof msg.y === "number" ? msg.y : 0.55,
      },
      {
        lifeMs: 420,
        variant: COMBAT_FX_VARIANT_WALL_HIT,
      },
    );
    return { handledPortal: false };
  }

  if (!shouldSkipLegacyBurst(msg)) {
    const life = msg.kind === "hit" ? 280 : msg.kind === "dash" ? 220 : 450;
    const tint =
      msg.kind === "hit"
        ? abilityVfxColor(msg.abilityId, ctx.fxColors.hit)
        : abilityVfxColor(msg.abilityId, ctx.fxColors[msg.kind]);
    ctx.pushBurst({
      key: ctx.nextFxKey(),
      kind: msg.kind,
      x: msg.x,
      z: msg.z,
      radius: msg.radius ?? (msg.kind === "hit" ? 0.7 : 2.2),
      born: performance.now(),
      life,
      color: tint,
    });
  }

  if (msg.kind === "dash" && msg.abilityId === "bloodRush") {
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.04, yaw: resolveOwnerYaw(msg, ctx) },
      {
        lifeMs: 700,
        followOwnerId: msg.ownerId,
      },
    );
  }

  if (msg.kind === "dash" && msg.abilityId === "spiritForm") {
    const dur =
      typeof msg.phaseEndsAt === "number"
        ? Math.max(200, msg.phaseEndsAt - Date.now() + 180)
        : 650;
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.5, yaw: resolveOwnerYaw(msg, ctx) },
      {
        lifeMs: dur,
        followOwnerId: msg.ownerId,
      },
    );
  }

  if (usesMeleeSwoopFx(msg.abilityId) && msg.ownerId) {
    const owner = ctx.getOwner(msg.ownerId);
    const localOwner = msg.ownerId === ctx.localSessionId;
    const yaw = localOwner ? ctx.localYaw : (owner?.yaw ?? ctx.localYaw);
    const payload = {
      x: msg.x,
      z: msg.z,
      yaw,
      ownerId: msg.ownerId,
      casterX: localOwner ? ctx.predicted.x : owner?.x,
      casterZ: localOwner ? ctx.predicted.z : owner?.z,
      comboHit: msg.comboHit,
    };
    if (msg.kind === "melee") notifyCrescentMelee(payload);
    else if (msg.kind === "hit") notifyCrescentHit(payload);
  }

  const onAoe = getAbilityVfxProfile(msg.abilityId).combatFx?.onAoe;
  const effectKindAoe =
    onAoe ??
    (usesSpikeFx(msg.abilityId)
      ? "spikes"
      : usesFrostMistFx(msg.abilityId)
        ? "channelOnce"
        : usesGrooveFx(msg.abilityId)
          ? "groove"
          : usesHealBeamFx(msg.abilityId)
            ? "healBeam"
            : usesFirewallFx(msg.abilityId)
              ? "firewall"
              : usesAoeCrackFx(msg.abilityId)
                ? "groundCrack"
                : usesIceLanceExplodeFx(msg.abilityId)
                  ? "iceLanceExplode"
                  : undefined);

  if (msg.kind === "aoe" && effectKindAoe === "groundCrack") {
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.04 },
      { radius: msg.radius ?? 2.6 },
    );
    if (msg.abilityId === "smash") playSlamHitSfx();
  }

  if (msg.kind === "aoe" && effectKindAoe === "spikes") {
    spawnImpactEffect(msg.abilityId, { x: msg.x, z: msg.z, y: 0.02 }, { lifeMs: 560 });
  }

  if (msg.kind === "aoe" && effectKindAoe === "firewall") {
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.03, yaw: msg.yaw },
      { lifeMs: FIREWALL_CAST.zoneDurationMs + 100, radius: msg.radius },
    );
  }

  if (msg.kind === "aoe" && effectKindAoe === "volcano") {
    // variant 0 = schema mesh spawn (no one-shot). 1 = rock telegraph, 2 = impact.
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
  }

  if (msg.kind === "aoe" && msg.abilityId === "shrooms" && (msg.variant === 1 || msg.variant === 2)) {
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.04 },
      {
        lifeMs: 900,
        variant: msg.variant,
        radius: msg.radius ?? 3.4,
      },
    );
  }

  if (msg.kind === "aoe" && effectKindAoe === "iceLanceExplode") {
    spawnImpactEffect(
      msg.abilityId,
      {
        x: msg.x,
        z: msg.z,
        y: typeof msg.y === "number" ? msg.y : 0.85,
      },
      { lifeMs: 900, radius: msg.radius ?? 2.0 },
    );
  }

  if (
    msg.kind === "aoe" &&
    effectKindAoe === "channelOnce" &&
    (msg.comboHit ?? 1) === 1
  ) {
    const yaw = resolveOwnerYaw(msg, ctx);
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
  }

  if (msg.kind === "aoe" && effectKindAoe === "groove") {
    const yaw = resolveOwnerYaw(msg, ctx);
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
  }

  if (
    msg.kind === "aoe" &&
    effectKindAoe === "healBeam" &&
    (msg.comboHit ?? 1) === 1
  ) {
    const yaw = resolveOwnerYaw(msg, ctx);
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
  }

  const onHit = getAbilityVfxProfile(msg.abilityId).combatFx?.onHit;
  if (msg.kind === "hit" && (onHit === "sfxOnly" || msg.abilityId === "bolt")) {
    if (msg.abilityId === "bolt") playBoltHitSfx();
  }

  if (msg.kind === "hit" && onHit === "catalogImpact") {
    const hitY = getAbilityVfxProfile(msg.abilityId).combatFx?.hitY ?? 0.7;
    const yaw = resolveOwnerYaw(msg, ctx, 0);
    spawnImpactEffect(msg.abilityId, {
      x: msg.x,
      z: msg.z,
      y: hitY,
      yaw,
    });
  }

  return { handledPortal: false };
}
