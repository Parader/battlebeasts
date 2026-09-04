import * as THREE from "three";

/** Soft fade pad at each end of the vine ribbon (fraction of length). */
const END_PAD = 0.18;

/**
 * Unit plane with vertex alpha faded at both ends (local Y = length axis).
 * Scale X = width, Y = length in world after parenting.
 */
export function makeBloomingVineRibbonGeo(
  widthSegs = 1,
  lengthSegs = 18,
): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(1, 1, widthSegs, lengthSegs);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const along01 = y + 0.5;
    const endFade =
      Math.min(1, along01 / END_PAD) * Math.min(1, (1 - along01) / END_PAD);
    const a = Math.max(0, Math.min(1, endFade));
    colors[i * 3] = a;
    colors[i * 3 + 1] = a;
    colors[i * 3 + 2] = a;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}
