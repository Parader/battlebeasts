import { BufferAttribute, type BufferGeometry, type InterleavedBufferAttribute, type Object3D } from "three";

/**
 * A vertex color that never rises above this is not a tint. The kits store
 * masks in that channel, and multiplying them paints the atlas black.
 */
const DEAD_VERTEX_COLOR = 0.25;

type ColorAttr = BufferAttribute | InterleavedBufferAttribute;

function brightest(color: ColorAttr): number {
  let max = 0;
  const count = color.count;
  for (let i = 0; i < count; i++) {
    const r = color.getX(i);
    const g = color.getY(i);
    const b = color.getZ(i);
    if (r > max) max = r;
    if (g > max) max = g;
    if (b > max) max = b;
    if (max >= DEAD_VERTEX_COLOR) return max;
  }
  return max;
}

/**
 * Share of vertices whose darkest channel is missing. Wind masks in these
 * packs leave blue or green at 0 while another channel stays bright, and
 * multiplying that into the atlas wipes the leaf color.
 */
const MASK_VERTEX_SHARE = 0.3;

function isMask(color: ColorAttr): boolean {
  const count = color.count;
  if (count === 0) return false;
  const step = Math.max(1, Math.floor(count / 400));
  let seen = 0;
  let crushed = 0;
  let peak = 0;
  for (let i = 0; i < count; i += step) {
    const r = color.getX(i);
    const g = color.getY(i);
    const b = color.getZ(i);
    const hi = Math.max(r, g, b);
    if (hi > peak) peak = hi;
    if (Math.min(r, g, b) < DEAD_VERTEX_COLOR) crushed += 1;
    seen += 1;
  }
  return peak < DEAD_VERTEX_COLOR || (peak > 0.5 && crushed / seen > MASK_VERTEX_SHARE);
}

function paintWhite(color: ColorAttr): void {
  for (let i = 0; i < color.count; i++) color.setXYZ(i, 1, 1, 1);
  color.needsUpdate = true;
}

/**
 * Drop a flat black vertex color so the atlas shows. A crest or a real tint
 * still has a bright vertex and is left alone.
 *
 * Tree cards also store a wind mask in the color. Pass `masks` for those
 * props. Water crests are a mask too, and this must not run on them.
 */
type Vec3Attr = { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number };

function percentile(values: number[], p: number): number {
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
}

/**
 * Object-space radius of a rigid trunk.
 * Above zero, vertices inside that radius are the trunk and should hold still.
 * Below zero, the crown is no wider than the base, so the mesh is wood.
 * Zero means the whole mesh is foliage.
 */
export function foliageTrunkRadius(position: Vec3Attr | undefined): number {
  if (!position || position.count < 8) return 0;
  let minY = Infinity;
  let maxY = -Infinity;
  const step = Math.max(1, Math.floor(position.count / 4000));
  for (let i = 0; i < position.count; i += step) {
    const y = position.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY;
  if (!(height > 0.15)) return 0;
  const baseCut = minY + height * 0.2;
  const crownCut = minY + height * 0.55;
  const base: number[] = [];
  const crown: number[] = [];
  for (let i = 0; i < position.count; i += step) {
    const radius = Math.hypot(position.getX(i), position.getZ(i));
    const y = position.getY(i);
    if (y <= baseCut) base.push(radius);
    else if (y >= crownCut) crown.push(radius);
  }
  if (base.length < 4 || crown.length < 4) return 0;
  const baseRadius = percentile(base, 0.9);
  const crownRadius = percentile(crown, 0.9);
  if (!(baseRadius > 0.02)) return 0;
  const ratio = crownRadius / baseRadius;
  if (ratio >= 1.8) return baseRadius;
  if (ratio <= 1.15) return -1;
  return 0;
}

/**
 * Leaf cards are large flat triangles. Trunks and branches are small ones.
 * A mesh with both gets a 0/1 weight so only the cards sway. A bare trunk,
 * a branch, or a palm of similarly small triangles returns null and keeps
 * the radial gate.
 */
const LEAF_CARD_AREA = 0.35;

export function markLeafCards(geometry: BufferGeometry): boolean {
  if (geometry.getAttribute("envLeaf") && geometry.getAttribute("envPivot")) return true;
  const position = geometry.getAttribute("position") as Vec3Attr | undefined;
  const index = geometry.getIndex();
  if (!position || !index || position.count < 8) return false;
  const idx = index.array;
  const maxArea = new Float32Array(position.count);
  const pivot = new Float32Array(position.count * 3);
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const ia = idx[i] ?? 0;
    const ib = idx[i + 1] ?? 0;
    const ic = idx[i + 2] ?? 0;
    const ax = position.getX(ia);
    const ay = position.getY(ia);
    const az = position.getZ(ia);
    const bx = position.getX(ib);
    const by = position.getY(ib);
    const bz = position.getZ(ib);
    const cx0 = position.getX(ic);
    const cy0 = position.getY(ic);
    const cz0 = position.getZ(ic);
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx0 - ax;
    const acy = cy0 - ay;
    const acz = cz0 - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const area = 0.5 * Math.hypot(nx, ny, nz);
    const px = (ax + bx + cx0) / 3;
    const py = (ay + by + cy0) / 3;
    const pz = (az + bz + cz0) / 3;
    for (const v of [ia, ib, ic]) {
      if (area <= (maxArea[v] ?? 0)) continue;
      maxArea[v] = area;
      pivot[v * 3] = px;
      pivot[v * 3 + 1] = py;
      pivot[v * 3 + 2] = pz;
    }
  }
  let leaf = 0;
  let wood = 0;
  for (let i = 0; i < maxArea.length; i++) {
    if ((maxArea[i] ?? 0) >= LEAF_CARD_AREA) leaf += 1;
    else wood += 1;
  }
  if (!(leaf > 50 && wood > 50 && leaf > wood)) return false;
  const weights = new Float32Array(position.count);
  for (let i = 0; i < weights.length; i++) weights[i] = (maxArea[i] ?? 0) >= LEAF_CARD_AREA ? 1 : 0;
  geometry.setAttribute("envLeaf", new BufferAttribute(weights, 1));
  geometry.setAttribute("envPivot", new BufferAttribute(pivot, 3));
  return true;
}

export function liftDeadVertexColors(root: Object3D, masks = false): void {
  const seen = new Set<ColorAttr>();
  root.traverse((object) => {
    const mesh = object as Object3D & { isMesh?: boolean; geometry?: { getAttribute(name: string): ColorAttr | undefined } };
    if (!mesh.isMesh || !mesh.geometry) return;
    const color = mesh.geometry.getAttribute("color");
    if (!color || seen.has(color)) return;
    seen.add(color);
    if (brightest(color) < DEAD_VERTEX_COLOR || (masks && isMask(color))) paintWhite(color);
  });
}
