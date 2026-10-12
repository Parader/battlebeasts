import { propUrlForKey, type MapPropPlacement } from "@battlebeasts/shared";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { particleKind, type ParticleKind } from "./envMotionKind";

export { particleKind, type ParticleKind };

/** Bounds of a prop in its own space, so particles sit on the mesh. */
export function measureLocalBox(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  const piece = new THREE.Box3();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (!bounds) return;
    const intoRoot = new THREE.Matrix4();
    const chain: THREE.Object3D[] = [];
    let current: THREE.Object3D | null = mesh;
    while (current && current !== root) {
      current.updateMatrix();
      chain.push(current);
      current = current.parent;
    }
    for (let i = chain.length - 1; i >= 0; i--) intoRoot.multiply(chain[i]!.matrix);
    box.union(piece.copy(bounds).applyMatrix4(intoRoot));
  });
  return box;
}

let softMap: THREE.Texture | null = null;

function softCircle(): THREE.Texture {
  if (softMap) return softMap;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const paint = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    paint.addColorStop(0, "rgba(255,255,255,1)");
    paint.addColorStop(0.35, "rgba(255,255,255,0.55)");
    paint.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = paint;
    ctx.fillRect(0, 0, 64, 64);
  }
  softMap = new THREE.CanvasTexture(canvas);
  return softMap;
}

const materials: Partial<Record<ParticleKind, THREE.PointsMaterial>> = {};

function particleMaterial(kind: ParticleKind): THREE.PointsMaterial {
  const existing = materials[kind];
  if (existing) return existing;
  const sparks = kind === "sparks";
  const material = new THREE.PointsMaterial({
    color: sparks ? "#ffb15a" : "#e7f4ff",
    size: sparks ? 0.16 : 1.15,
    map: softCircle(),
    transparent: true,
    opacity: sparks ? 0.9 : 0.28,
    depthWrite: false,
    blending: sparks ? THREE.AdditiveBlending : THREE.NormalBlending,
    sizeAttenuation: true,
  });
  materials[kind] = material;
  return material;
}

type Mote = { x: number; z: number; age: number; life: number; sway: number };

/**
 * A puff of sparks or mist in prop-local space. Parent it to the placed prop
 * so it moves, turns and scales with the mesh.
 */
export function EnvParticleBurst({ kind, source }: { kind: ParticleKind; source: THREE.Object3D }) {
  const box = useMemo(() => measureLocalBox(source), [source]);
  if (box.isEmpty()) return null;
  if (kind === "mist") return <WaterfallSpray source={source} />;
  return <ParticlePoints kind={kind} box={box} />;
}

type SurfacePoint = { x: number; y: number; z: number };
type SheetSlice = { y: number; x: number; z: number; half: number; row: SurfacePoint[] };
type Anchors = {
  base: THREE.Vector3;
  top: THREE.Vector3;
  spread: number;
  height: number;
  /** Surface samples at each height, lip first, sorted across the sheet. */
  sheet: SheetSlice[];
};

/** Long axis of the lip, in the horizontal plane. Droplets spread along it. */
function lipAxis(samples: THREE.Vector3[]): { x: number; z: number } {
  let cx = 0;
  let cz = 0;
  for (const sample of samples) {
    cx += sample.x;
    cz += sample.z;
  }
  cx /= samples.length;
  cz /= samples.length;
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (const sample of samples) {
    const dx = sample.x - cx;
    const dz = sample.z - cz;
    xx += dx * dx;
    zz += dz * dz;
    xz += dx * dz;
  }
  const trace = xx + zz;
  const disc = Math.max(0, (trace * trace) / 4 - (xx * zz - xz * xz));
  const lambda = trace / 2 + Math.sqrt(disc);
  let ax = xz;
  let az = lambda - xx;
  if (Math.hypot(ax, az) < 1e-4) return xx >= zz ? { x: 1, z: 0 } : { x: 0, z: 1 };
  const length = Math.hypot(ax, az);
  return { x: ax / length, z: az / length };
}

/** Where the sheet starts and where it hits, in prop-local space. */
function waterfallAnchors(root: THREE.Object3D): Anchors | null {
  const groups: THREE.Vector3[][] = [];
  const point = new THREE.Vector3();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    const intoRoot = new THREE.Matrix4();
    const chain: THREE.Object3D[] = [];
    let current: THREE.Object3D | null = mesh;
    while (current && current !== root) {
      current.updateMatrix();
      chain.push(current);
      current = current.parent;
    }
    for (let i = chain.length - 1; i >= 0; i--) intoRoot.multiply(chain[i]!.matrix);
    const local: THREE.Vector3[] = [];
    const step = Math.max(1, Math.floor(position.count / 400));
    for (let i = 0; i < position.count; i += step) {
      point.fromBufferAttribute(position as THREE.BufferAttribute, i).applyMatrix4(intoRoot);
      local.push(point.clone());
    }
    if (local.length >= 8) groups.push(local);
  });
  if (groups.length === 0) return null;
  // The curtain is the tallest mesh. A ripple sheet in front of it would
  // pull an average into the hollow of the curl.
  let samples = groups[0]!;
  let bestSpan = -Infinity;
  for (const group of groups) {
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const sample of group) {
      if (sample.y < yMin) yMin = sample.y;
      if (sample.y > yMax) yMax = sample.y;
    }
    if (yMax - yMin > bestSpan) {
      bestSpan = yMax - yMin;
      samples = group;
    }
  }
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const sample of samples) {
    if (sample.y < yMin) yMin = sample.y;
    if (sample.y > yMax) yMax = sample.y;
  }
  const height = Math.max(yMax - yMin, 0.2);
  const basePts = samples.filter((sample) => sample.y <= yMin + height * 0.12);
  const topPts = samples.filter((sample) => sample.y >= yMax - height * 0.12);
  const average = (list: THREE.Vector3[]) => {
    const acc = new THREE.Vector3();
    for (const sample of list) acc.add(sample);
    return acc.multiplyScalar(1 / Math.max(list.length, 1));
  };
  const base = average(basePts.length ? basePts : samples);
  const top = average(topPts.length ? topPts : samples);
  let spread = 0.25;
  for (const sample of basePts) {
    spread = Math.max(spread, Math.hypot(sample.x - base.x, sample.z - base.z));
  }
  const axis = lipAxis(topPts.length ? topPts : samples);
  const bands = 14;
  const rows: THREE.Vector3[][] = Array.from({ length: bands }, () => []);
  for (const sample of samples) {
    const index = Math.min(bands - 1, Math.max(0, Math.floor(((yMax - sample.y) / height) * bands)));
    rows[index]!.push(sample);
  }
  const sheet: SheetSlice[] = [];
  for (const row of rows) {
    if (row.length === 0) continue;
    row.sort((a, b) => a.x * axis.x + a.z * axis.z - (b.x * axis.x + b.z * axis.z));
    let x = 0;
    let y = 0;
    let z = 0;
    for (const sample of row) {
      x += sample.x;
      y += sample.y;
      z += sample.z;
    }
    x /= row.length;
    y /= row.length;
    z /= row.length;
    let half = 0.15;
    for (const sample of row) half = Math.max(half, Math.hypot(sample.x - x, sample.z - z));
    sheet.push({
      y,
      x,
      z,
      half,
      row: row.map((sample) => ({ x: sample.x, y: sample.y, z: sample.z })),
    });
  }
  return { base, top, spread, height, sheet };
}

const sheetPoint = new THREE.Vector3();
const sheetA = new THREE.Vector3();
const sheetB = new THREE.Vector3();

/** A point on one height's surface. `across` is -1 at one edge and 1 at the other. */
function pointOnRow(row: SurfacePoint[], across: number, out: THREE.Vector3): void {
  if (row.length === 1) {
    out.set(row[0]!.x, row[0]!.y, row[0]!.z);
    return;
  }
  const t = (Math.min(1, Math.max(-1, across)) + 1) * 0.5;
  const scaled = t * (row.length - 1);
  const index = Math.min(row.length - 2, Math.floor(scaled));
  const blend = scaled - index;
  const a = row[index]!;
  const b = row[index + 1]!;
  out.set(a.x + (b.x - a.x) * blend, a.y + (b.y - a.y) * blend, a.z + (b.z - a.z) * blend);
}

/** A point on the sheet at `along` (0 at the lip, 1 at the foot). */
function pointOnSheet(anchors: Anchors, along: number, across: number): THREE.Vector3 {
  const sheet = anchors.sheet;
  if (sheet.length < 2) {
    return sheetPoint.set(
      THREE.MathUtils.lerp(anchors.top.x, anchors.base.x, along),
      THREE.MathUtils.lerp(anchors.top.y, anchors.base.y, along),
      THREE.MathUtils.lerp(anchors.top.z, anchors.base.z, along),
    );
  }
  const scaled = Math.min(1, Math.max(0, along)) * (sheet.length - 1);
  const index = Math.min(sheet.length - 2, Math.floor(scaled));
  const blend = scaled - index;
  pointOnRow(sheet[index]!.row, across, sheetA);
  pointOnRow(sheet[index + 1]!.row, across, sheetB);
  return sheetPoint.copy(sheetA).lerp(sheetB, blend);
}

type SprayMote = { role: 0 | 1 | 2; ang: number; age: number; life: number; sway: number };

/**
 * Spray at the impact, mist rising off it, and droplets falling with the sheet.
 * A single soft puff at the base never read as a waterfall.
 */
function WaterfallSpray({ source }: { source: THREE.Object3D }) {
  const anchors = useMemo(() => waterfallAnchors(source), [source]);
  if (!anchors) return null;
  const height = anchors.height;
  return (
    <>
      <SprayLayer
        anchors={anchors}
        role={0}
        count={Math.min(28, Math.round(12 + height))}
        size={Math.min(0.7, Math.max(0.22, height * 0.05))}
        color="#ffffff"
        opacity={0.7}
        additive
      />
      <SprayLayer
        anchors={anchors}
        role={1}
        count={Math.min(12, Math.round(4 + height * 0.4))}
        size={Math.min(1.6, Math.max(0.7, height * 0.1))}
        color="#f7fbff"
        opacity={0.28}
        additive
      />
      <SprayLayer
        anchors={anchors}
        role={2}
        count={Math.min(18, Math.round(8 + height))}
        size={Math.min(0.28, Math.max(0.1, height * 0.02))}
        color="#e7f7f6"
        opacity={0.55}
        additive
      />
    </>
  );
}

function SprayLayer({
  anchors,
  role,
  count,
  size,
  color,
  opacity,
  additive,
}: {
  anchors: Anchors;
  role: 0 | 1 | 2;
  count: number;
  size: number;
  color: string;
  opacity: number;
  additive?: boolean;
}) {
  const points = useRef<THREE.Points>(null);
  const motes = useMemo<SprayMote[]>(() => {
    const list: SprayMote[] = [];
    for (let i = 0; i < count; i++) {
      const life = role === 1 ? 2.2 + Math.random() * 2.2 : 0.55 + Math.random() * 0.85;
      list.push({
        role,
        ang: Math.random() * Math.PI * 2,
        age: Math.random() * life,
        life,
        sway: Math.random() * Math.PI * 2,
      });
    }
    return list;
  }, [count, role]);
  const geometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    return geometry;
  }, [count]);
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color,
        size,
        map: softCircle(),
        transparent: true,
        opacity,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        sizeAttenuation: true,
      }),
    [additive, color, opacity, size],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((_, dt) => {
    const mesh = points.current;
    if (!mesh) return;
    const step = Math.min(0.05, dt);
    const attribute = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < motes.length; i++) {
      const mote = motes[i]!;
      mote.age += step;
      if (mote.age > mote.life) {
        mote.age = 0;
        mote.ang = Math.random() * Math.PI * 2;
      }
      const along = mote.age / mote.life;
      const { base, top, spread, height } = anchors;
      const faceX = top.x - base.x;
      const faceZ = top.z - base.z;
      const faceLen = Math.hypot(faceX, faceZ) || 1;
      const nx = faceX / faceLen;
      const nz = faceZ / faceLen;
      const push = height * 0.045;
      const across = Math.sin(mote.ang) * spread;
      let x = base.x + nx * push;
      let y = base.y;
      let z = base.z + nz * push;
      if (mote.role === 0) {
        x += -nz * across;
        z += nx * across;
        y += Math.sin(along * Math.PI) * height * 0.32;
      } else if (mote.role === 1) {
        const drift = Math.sin(mote.age * 0.6 + mote.sway) * spread * 0.25;
        x += -nz * across * 0.75 + nx * drift;
        z += nx * across * 0.75 + nz * drift;
        y += along * height * 0.38;
      } else {
        const ride = pointOnSheet(anchors, along, Math.sin(mote.ang) * 0.88);
        x = ride.x + nx * push * 0.2;
        y = ride.y;
        z = ride.z + nz * push * 0.2;
      }
      attribute.setXYZ(i, x, y, z);
    }
    attribute.needsUpdate = true;
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}

function ParticlePoints({ kind, box }: { kind: ParticleKind; box: THREE.Box3 }) {
  const points = useRef<THREE.Points>(null);
  const sparks = kind === "sparks";
  const count = sparks ? 28 : 16;
  const origin = useMemo(() => {
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const y0 = sparks ? box.max.y * 0.55 : box.min.y;
    const rise = sparks ? Math.max(0.7, size.y * 0.8) : Math.min(2.2, Math.max(0.8, size.y * 0.35));
    const spread = sparks ? Math.min(0.22, size.x * 0.2) : Math.max(0.35, Math.min(size.x, size.z) * 0.28);
    return { x: center.x, z: center.z, y0, rise, spread };
  }, [box, sparks]);

  const motes = useMemo<Mote[]>(() => {
    const list: Mote[] = [];
    for (let i = 0; i < count; i++) {
      list.push({
        x: (Math.random() - 0.5) * 2,
        z: (Math.random() - 0.5) * 2,
        age: Math.random(),
        life: sparks ? 0.45 + Math.random() * 0.7 : 1.6 + Math.random() * 1.8,
        sway: Math.random() * Math.PI * 2,
      });
    }
    return list;
  }, [count, sparks]);

  const geometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    return geometry;
  }, [count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, dt) => {
    const mesh = points.current;
    if (!mesh) return;
    const step = Math.min(0.05, dt);
    const attribute = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < motes.length; i++) {
      const mote = motes[i]!;
      mote.age += step;
      if (mote.age > mote.life) {
        mote.age = 0;
        mote.x = (Math.random() - 0.5) * 2;
        mote.z = (Math.random() - 0.5) * 2;
        mote.sway = Math.random() * Math.PI * 2;
      }
      const along = mote.age / mote.life;
      const drift = Math.sin(mote.age * (sparks ? 6 : 1.2) + mote.sway) * (sparks ? 0.04 : 0.18);
      attribute.setXYZ(
        i,
        origin.x + mote.x * origin.spread + drift,
        origin.y0 + origin.rise * along,
        origin.z + mote.z * origin.spread,
      );
    }
    attribute.needsUpdate = true;
  });

  return (
    <points ref={points} geometry={geometry} material={particleMaterial(kind)} frustumCulled={false} />
  );
}

/** One burst per placement, for the instanced match view. */
export function PropParticleField({
  propKey,
  placements,
}: {
  propKey: string;
  placements: MapPropPlacement[];
}) {
  const kind = particleKind(propKey);
  const gltf = useGLTF(propUrlForKey(propKey));
  if (!kind) return null;
  return (
    <>
      {placements.map((placement) => (
        <PlacementBurst key={placement.id} placement={placement} kind={kind} source={gltf.scene} />
      ))}
    </>
  );
}

function PlacementBurst({
  placement,
  kind,
  source,
}: {
  placement: MapPropPlacement;
  kind: ParticleKind;
  source: THREE.Object3D;
}) {
  const matrix = useMemo(() => placementMatrix(placement), [placement]);
  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <EnvParticleBurst kind={kind} source={source} />
    </group>
  );
}

function placementMatrix(placement: MapPropPlacement): THREE.Matrix4 {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(placement.x, placement.y, placement.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(placement.pitch ?? 0, placement.yaw, placement.roll ?? 0, "YXZ"),
    ),
    new THREE.Vector3(placement.scale, placement.scale, placement.scale),
  );
  const px = placement.pivotX ?? 0;
  const pz = placement.pivotZ ?? 0;
  if (px !== 0 || pz !== 0) matrix.multiply(new THREE.Matrix4().makeTranslation(-px, 0, -pz));
  return matrix;
}
