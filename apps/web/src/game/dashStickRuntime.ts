/** Latest WASD world stick. Updated with movement input; dash preview/travel reads it. */

let moveX = 0;
let moveZ = 0;

export function setDashStick(x: number, z: number): void {
  moveX = Number.isFinite(x) ? x : 0;
  moveZ = Number.isFinite(z) ? z : 0;
}

export function getDashStick(): { x: number; z: number } {
  return { x: moveX, z: moveZ };
}
