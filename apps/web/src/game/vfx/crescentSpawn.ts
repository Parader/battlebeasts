import { comboSwingVariant } from "@battlebeasts/shared";
import { spawnCastEffect } from "./runtime";

/** Melee just fired — wait briefly for a hit so we can place the swoop toward the target. */
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

/** Place the swoop clearly in front of the target (toward the caster). */
function frontOfTarget(
  targetX: number,
  targetZ: number,
  casterX: number,
  casterZ: number,
  standOff = 0.85,
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

/** Always follow the caster so strafing / walking keeps the swoop attached. */
function spawnFollowing(
  ownerId: string,
  yaw: number,
  variant: number,
  reach: number,
) {
  spawnCastEffect(
    "crescent",
    { x: 0, z: 0, yaw, y: 1.05 },
    {
      followOwnerId: ownerId,
      followSpawnOffset: Math.max(0.7, Math.min(2.2, reach)),
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
 * Crescent melee resolved — hold briefly; a following hit aims reach toward the target.
 * On miss, the swoop follows the caster at melee range.
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
    const reach =
      msg.casterX != null && msg.casterZ != null
        ? Math.hypot(pend.x - msg.casterX, pend.z - msg.casterZ)
        : 1.15;
    spawnFollowing(ownerId, pend.yaw, pend.variant, reach);
  }, 45);

  pendingByOwner.set(ownerId, {
    x: msg.x,
    z: msg.z,
    yaw,
    variant,
    timer,
  });
}

/** Hit landed — follow caster, reach set so the swoop sits on the front of the target. */
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
  let reach = 1.15;
  if (msg.casterX != null && msg.casterZ != null) {
    const front = frontOfTarget(msg.x, msg.z, msg.casterX, msg.casterZ, 0.85);
    reach = Math.hypot(front.x - msg.casterX, front.z - msg.casterZ);
  }

  spawnFollowing(ownerId, yaw, variant, reach);
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
