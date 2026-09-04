import {
  COMBAT_FX_VARIANT_WALL_HIT,
  HAND_SHIELD_CAST,
} from "@battlebeasts/shared";
import { abilityVfxColor } from "./colors";
import { spawnImpactEffect } from "./runtime";
import { getAbilityVfxProfile } from "./profiles/registry";
import { dispatchAoeCombatFx } from "./aoeCombatFxHandlers";
import {
  usesMagmaOrbsFx,
  usesMeleeSwoopFx,
} from "./catalog";
import { notifyCrescentHit, notifyCrescentMelee } from "./crescentSpawn";
import { playBoltHitSfx } from "../gameSfx";
import {
  setMagmaOrbsMeetCollide,
  setMagmaOrbsMeetRange,
} from "../magmaOrbsMeetRuntime";
import type { CombatFxDispatchCtx, CombatFxMessage } from "./combatFxTypes";

export type { CombatFxDispatchCtx, CombatFxMessage } from "./combatFxTypes";

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

/**
 * Prefer profile.combatFx.skipLegacyBurst. Keep only id edge-cases that do not
 * have a profile yet (or need kind-specific exceptions).
 */
function shouldSkipLegacyBurst(msg: CombatFxMessage): boolean {
  if (getAbilityVfxProfile(msg.abilityId).combatFx?.skipLegacyBurst) return true;
  if (msg.kind === "hit" && msg.variant === COMBAT_FX_VARIANT_WALL_HIT) return true;
  // Hit lands at the teleport spot during the invisible window — skip so we
  // don't flash a "reappear" burst before the vanish ends. Dash puff stays.
  if (msg.abilityId === "revenge" && msg.kind === "hit") return true;
  if (msg.abilityId === "handShield" && msg.kind === "aoe") return true;
  return false;
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
    if (
      usesMagmaOrbsFx(msg.abilityId) &&
      msg.ownerId &&
      typeof msg.radius === "number" &&
      msg.radius > 0
    ) {
      const hasCollide =
        typeof msg.x2 === "number" &&
        typeof msg.z2 === "number" &&
        Number.isFinite(msg.x2) &&
        Number.isFinite(msg.z2);
      if (hasCollide) {
        setMagmaOrbsMeetCollide(
          msg.ownerId,
          msg.x2!,
          msg.z2!,
          typeof msg.yaw === "number" ? msg.yaw : undefined,
          msg.radius,
        );
      } else {
        setMagmaOrbsMeetRange(msg.ownerId, msg.radius);
      }
    }
    return { handledPortal: false };
  }

  if (usesMagmaOrbsFx(msg.abilityId) && msg.kind === "aoe" && msg.ownerId) {
    const meetRange =
      typeof msg.x2 === "number" && typeof msg.z2 === "number"
        ? Math.hypot(msg.x - msg.x2, msg.z - msg.z2)
        : undefined;
    setMagmaOrbsMeetCollide(
      msg.ownerId,
      msg.x,
      msg.z,
      typeof msg.yaw === "number" ? msg.yaw : undefined,
      meetRange && meetRange > 0 ? meetRange : undefined,
    );
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

  const onDash = getAbilityVfxProfile(msg.abilityId).combatFx?.onDash;
  if (msg.kind === "dash" && onDash === "bloodRushTrail") {
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.04, yaw: resolveOwnerYaw(msg, ctx) },
      {
        lifeMs: 700,
        followOwnerId: msg.ownerId,
      },
    );
  }

  if (msg.kind === "dash" && onDash === "spiritForm") {
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

  if (msg.kind === "dash" && onDash === "spaceStreak") {
    const dur =
      typeof msg.phaseEndsAt === "number"
        ? Math.max(160, msg.phaseEndsAt - Date.now() + 120)
        : 400;
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.55, yaw: resolveOwnerYaw(msg, ctx) },
      {
        lifeMs: dur,
        followOwnerId: msg.ownerId,
        originX: msg.x2,
        originZ: msg.z2,
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

  dispatchAoeCombatFx(msg, ctx, getAbilityVfxProfile(msg.abilityId).combatFx?.onAoe);

  if (msg.kind === "aoe" && msg.abilityId === "handShield" && (msg.variant ?? 0) === 1) {
    const yaw = resolveOwnerYaw(msg, ctx);
    spawnImpactEffect(
      msg.abilityId,
      { x: msg.x, z: msg.z, y: 0.04, yaw },
      {
        lifeMs: 700,
        radius: msg.radius ?? HAND_SHIELD_CAST.retaliateRange,
      },
    );
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

  const onHit = getAbilityVfxProfile(msg.abilityId).combatFx?.onHit;
  if (msg.kind === "hit" && (onHit === "sfxOnly" || msg.abilityId === "bolt")) {
    if (msg.abilityId === "bolt") playBoltHitSfx();
  }

  if (msg.kind === "hit" && onHit === "catalogImpact") {
    const hitY = getAbilityVfxProfile(msg.abilityId).combatFx?.hitY ?? 0.7;
    const yaw = resolveOwnerYaw(msg, ctx, 0);
    spawnImpactEffect(
      msg.abilityId,
      {
        x: msg.x,
        z: msg.z,
        y: hitY,
        yaw,
      },
      { variant: msg.variant, lifeMs: msg.abilityId === "arcBlade" ? 220 : undefined },
    );
  }

  return { handledPortal: false };
}
