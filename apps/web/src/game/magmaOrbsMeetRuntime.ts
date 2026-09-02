type MeetTarget = {
  meetRange: number;
  collideX?: number;
  collideZ?: number;
  yaw?: number;
  /** Wall-clock when this target was last written. */
  updatedAt: number;
};

/**
 * Server-authored Magma Orbs meet point / range so client curves match damage.
 * Filled from cast_phase (range + collide xz) and aoe combat_fx (final collide).
 */
const byOwner = new Map<string, MeetTarget>();

export function setMagmaOrbsMeetRange(
  ownerId: string,
  meetRange: number,
  opts?: { keepCollide?: boolean },
): void {
  if (!ownerId || !(meetRange > 0)) return;
  const prev = byOwner.get(ownerId);
  const keep = opts?.keepCollide === true;
  byOwner.set(ownerId, {
    meetRange,
    collideX: keep ? prev?.collideX : undefined,
    collideZ: keep ? prev?.collideZ : undefined,
    yaw: keep ? prev?.yaw : undefined,
    updatedAt: performance.now(),
  });
}

export function setMagmaOrbsMeetCollide(
  ownerId: string,
  collideX: number,
  collideZ: number,
  yaw?: number,
  meetRange?: number,
): void {
  if (!ownerId) return;
  if (!Number.isFinite(collideX) || !Number.isFinite(collideZ)) return;
  const prev = byOwner.get(ownerId);
  byOwner.set(ownerId, {
    meetRange: meetRange ?? prev?.meetRange ?? 0,
    collideX,
    collideZ,
    yaw: yaw ?? prev?.yaw,
    updatedAt: performance.now(),
  });
}

export function getMagmaOrbsMeet(ownerId: string | undefined): MeetTarget | null {
  if (!ownerId) return null;
  return byOwner.get(ownerId) ?? null;
}

export function clearMagmaOrbsMeet(ownerId: string | undefined): void {
  if (!ownerId) return;
  byOwner.delete(ownerId);
}
