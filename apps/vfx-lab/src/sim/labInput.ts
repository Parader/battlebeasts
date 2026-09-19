/** Keyboard + mouse aim for the lab sandbox (game-like, no Colyseus). */

const down = new Set<string>();

let aimX = 0;
let aimZ = 0;
let hasAim = false;
let worldX = 0;
let worldZ = 0;

export function setKey(code: string, pressed: boolean): void {
  if (pressed) down.add(code);
  else down.delete(code);
}

export function clearKeys(): void {
  down.clear();
}

export function isShift(): boolean {
  return down.has("ShiftLeft") || down.has("ShiftRight");
}

export function wasd(): { w: boolean; a: boolean; s: boolean; d: boolean } {
  return {
    w: down.has("KeyW"),
    a: down.has("KeyA"),
    s: down.has("KeyS"),
    d: down.has("KeyD"),
  };
}

export function setAim(x: number, z: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  aimX = x;
  aimZ = z;
  hasAim = true;
}

export function getAim(): { x: number; z: number } | null {
  return hasAim ? { x: aimX, z: aimZ } : null;
}

export function setWorldStick(x: number, z: number): void {
  worldX = Number.isFinite(x) ? x : 0;
  worldZ = Number.isFinite(z) ? z : 0;
}

export function getWorldStick(): { x: number; z: number } {
  return { x: worldX, z: worldZ };
}
