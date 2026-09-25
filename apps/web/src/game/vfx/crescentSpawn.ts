import { ABILITIES, comboSwingVariant } from "@battlebeasts/shared";
import { spawnCastEffect } from "./runtime";
import { playCrescentSwingSfx } from "../gameSfx";

/** Ability melee tip — slash VFX ends here (matches hit volume far edge). */
export const CRESCENT_SPELL_RANGE = ABILITIES.crescent?.range ?? 2.2;

/** Melee just fired — wait briefly for a hit so we can aim the hub at the target. */
const pendingByOwner = new Map<
  string,
  {
    x: number;
    z: number;
    yaw: number;
    variant: number;
    timer: ReturnType<typeof setTimeout>;
  }
>();

/** Place a reference in front of the target (toward the caster). */
function frontOfTarget(
  targetX: number,
  targetZ: number,
  casterX: number,
  casterZ: number,
  standOff = 0.55,
): { x: number; z: number } {
  const dx = casterX - targetX;
  const dz = casterZ - targetZ;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return { x: targetX, z: targetZ };
  const dist = Math.min(standOff, Math.max(0.35, len * 0.45));
  return {
    x: targetX + (dx / len) * dist,
    z: targetZ + (dz / len) * dist,
  };
}

/** Clamp aim distance used to pull the hub in on close hits. */
function aimDistFor(dist: number): number {
  return Math.max(0.7, Math.min(CRESCENT_SPELL_RANGE, dist));
}

/** Always follow the caster so strafing / walking keeps the swoop attached. */
function spawnFollowing(
  ownerId: string,
  yaw: number,
  variant: number,
  aimDist: number,
  playSwing: boolean,
) {
  if (playSwing) playCrescentSwingSfx();
  spawnCastEffect(
    "crescent",
    { x: 0, z: 0, yaw, y: 1.05 },
    {
      followOwnerId: ownerId,
      /** Near-hit aim distance — pulls hub toward the caster; size stays max range. */
      followSpawnOffset: aimDistFor(aimDist),
      variant,
    },
  );
}

type CrescentFxMsg = {
  x: number;
  z: number;
  yaw?: number;
  ownerId?: string;
  casterX?: number;
  casterZ?: number;
  /** 1-based combo hit from server combat_fx. */
  comboHit?: number;
};

/**
 * Crescent melee resolved — hold briefly; a following hit aims tip at the target.
 * On miss, the swoop reaches full spell range.
 */
export function notifyCrescentMelee(msg: CrescentFxMsg) {
  const ownerId = msg.ownerId ?? "_";
  const prev = pendingByOwner.get(ownerId);
  if (prev) clearTimeout(prev.timer);

  const variant = comboSwingVariant(msg.comboHit);
  const yaw = msg.yaw ?? 0;
  const timer = setTimeout(() => {
    const pend = pendingByOwner.get(ownerId);
    if (!pend) return;
    pendingByOwner.delete(ownerId);
    // Miss — slash out to full ability range (not the melee-center sample).
    spawnFollowing(ownerId, pend.yaw, pend.variant, CRESCENT_SPELL_RANGE, true);
  }, 45);

  pendingByOwner.set(ownerId, {
    x: msg.x,
    z: msg.z,
    yaw,
    variant,
    timer,
  });
}

/**
 * Hit landed — full-size swoop pulled closer to the caster when the target is near.
 * Wind impact SFX from combatFxDispatch. Do not also play the cast swing here.
 */
export function notifyCrescentHit(msg: CrescentFxMsg) {
  const ownerId = msg.ownerId ?? "_";
  const pend = pendingByOwner.get(ownerId);
  let variant: number;
  if (pend) {
    clearTimeout(pend.timer);
    pendingByOwner.delete(ownerId);
    variant = pend.variant;
  } else {
    variant = comboSwingVariant(msg.comboHit);
  }

  const yaw = msg.yaw ?? pend?.yaw ?? 0;
  let aim = CRESCENT_SPELL_RANGE;
  if (msg.casterX != null && msg.casterZ != null) {
    const front = frontOfTarget(msg.x, msg.z, msg.casterX, msg.casterZ);
    aim = Math.hypot(front.x - msg.casterX, front.z - msg.casterZ);
  }

  spawnFollowing(ownerId, yaw, variant, aim, false);
}

/** Clear pending timers/maps (room leave / disconnect). */
export function clearCrescentSpawnState(ownerId?: string) {
  if (ownerId) {
    const pend = pendingByOwner.get(ownerId);
    if (pend) clearTimeout(pend.timer);
    pendingByOwner.delete(ownerId);
    return;
  }
  for (const pend of pendingByOwner.values()) clearTimeout(pend.timer);
  pendingByOwner.clear();
}
