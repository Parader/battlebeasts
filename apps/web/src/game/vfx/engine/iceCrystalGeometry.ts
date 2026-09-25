/**
 * Ice crystal / shard meshes — ported from elemental sandbox
 * `ProceduralGeometry.js` (MIT). Unit space: base on y=0 (radius ~0.5), tip at y=1.
 */
import * as THREE from "three";

const TAU = Math.PI * 2;
const RING_HEIGHTS = [0, 0.22, 0.5, 0.75, 0.92];

function hash11(n: number): number {
  return ((Math.sin(n) * 43758.5453) % 1 + 1) % 1;
}

function profileRadius(t: number, taper: number): number {
  return taper + (1 - taper) * Math.pow(1 - t, 1.15);
}

export type IceCrystalOpts = {
  seed?: number;
  sides?: number;
  taper?: number;
  roughness?: number;
  bend?: number;
};

/** Tapered faceted prism — main spike. */
export function createIceCrystalGeometry(opts: IceCrystalOpts = {}): THREE.BufferGeometry {
  const seed = opts.seed ?? 1;
  const facets = Math.max(3, Math.round(opts.sides ?? 6));
  const tipRadius = Math.min(0.9, Math.max(0.01, opts.taper ?? 0.13));
  const roughness = opts.roughness ?? 0.28;
  const bend = opts.bend ?? 0.22;

  const bendAngle = hash11(seed * 1.77) * TAU;
  const bendX = Math.cos(bendAngle);
  const bendZ = Math.sin(bendAngle);
  const axisOffset = (t: number) => bend * 0.5 * Math.pow(t, 1.6);

  const angles: number[] = [];
  for (let i = 0; i < facets; i++) {
    const jitter = (hash11(seed * 3.13 + i * 7.7) - 0.5) * (TAU / facets) * 0.55 * roughness * 3;
    angles.push((i / facets) * TAU + jitter);
  }

  const rings = RING_HEIGHTS.map((t, ringIndex) => {
    const baseR = profileRadius(t, tipRadius) * 0.5;
    const drift = axisOffset(t);
    const y =
      t + (hash11(seed * 5.9 + ringIndex * 2.3) - 0.5) * 0.06 * roughness * (t > 0 ? 1 : 0);
    return angles.map((angle, i) => {
      const wobble =
        1 +
        (hash11(seed * 11.1 + ringIndex * 13.7 + i * 3.9) - 0.5) *
          roughness *
          1.3 *
          (0.35 + 0.65 * t);
      const r = Math.max(0.002, baseR * wobble);
      return [Math.cos(angle) * r + bendX * drift, y, Math.sin(angle) * r + bendZ * drift] as const;
    });
  });

  const apexDrift = axisOffset(1);
  const apex: [number, number, number] = [
    bendX * apexDrift + (hash11(seed * 17.3) - 0.5) * 0.09 * roughness,
    1,
    bendZ * apexDrift + (hash11(seed * 19.7) - 0.5) * 0.09 * roughness,
  ];
  const floorCentre: [number, number, number] = [0, 0, 0];

  const positions: number[] = [];
  const push = (p: readonly [number, number, number] | number[]) => {
    positions.push(p[0]!, p[1]!, p[2]!);
  };

  for (let ring = 0; ring < rings.length - 1; ring++) {
    const lower = rings[ring]!;
    const upper = rings[ring + 1]!;
    for (let i = 0; i < facets; i++) {
      const j = (i + 1) % facets;
      push(lower[i]!);
      push(lower[j]!);
      push(upper[i]!);
      push(lower[j]!);
      push(upper[j]!);
      push(upper[i]!);
    }
  }

  const top = rings[rings.length - 1]!;
  const base = rings[0]!;
  for (let i = 0; i < facets; i++) {
    const j = (i + 1) % facets;
    push(top[i]!);
    push(top[j]!);
    push(apex);
    push(floorCentre);
    push(base[j]!);
    push(base[i]!);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Short wide rubble shard — ankle-height ice fragments on the frost sheet. */
export function createIceShardGeometry(seed = 5, sides = 5): THREE.BufferGeometry {
  return createIceCrystalGeometry({
    seed: seed * 2.7 + 41,
    sides,
    taper: 0.22,
    roughness: 0.55,
    bend: 0.35,
  });
}
