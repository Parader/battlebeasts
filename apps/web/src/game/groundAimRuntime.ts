/** Latest mouse→ground aim point (XZ). Updated by scene raycasts; read when casting. */

let aimX = 0;
let aimZ = 0;
let hasAim = false;

export function setGroundAim(x: number, z: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  aimX = x;
  aimZ = z;
  hasAim = true;
}

export function getGroundAim(): { x: number; z: number } | null {
  return hasAim ? { x: aimX, z: aimZ } : null;
}
