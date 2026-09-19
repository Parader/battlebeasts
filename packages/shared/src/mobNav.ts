import {
  bodyBlockers,
  COLLISION,
  lastFreeTBeforeWalls,
  resolveCollisions,
  type StaticCollider,
} from "./collision";
import {
  PVE_MOB_NAV_CELL_M,
  PVE_MOB_NAV_FLOW_MS,
  PVE_MOB_NAV_LOS_M,
  PVE_MOB_TURN_RAD_PER_SEC,
  PVE_MOB_WALK_YAW_EPS_M,
} from "./pveWave";
import type { Vec2 } from "./protocol";
import { length2, stepYawToward } from "./sim";

const DIAG = Math.SQRT2;
const INF = 1e9;
const MAX_SPAN_M = 320;
const BOUNDS_PAD_M = 16;
const DEFAULT_HALF_M = 48;

const NBR: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, DIAG],
  [1, -1, DIAG],
  [-1, 1, DIAG],
  [-1, -1, DIAG],
];

type Aabb = { minX: number; maxX: number; minZ: number; maxZ: number };

function colliderAabb(c: StaticCollider): Aabb | null {
  if (c.shape === "box") {
    const cy = Math.cos(c.yaw);
    const sy = Math.sin(c.yaw);
    const ex = Math.abs(cy) * c.halfX + Math.abs(sy) * c.halfZ;
    const ez = Math.abs(sy) * c.halfX + Math.abs(cy) * c.halfZ;
    return { minX: c.x - ex, maxX: c.x + ex, minZ: c.z - ez, maxZ: c.z + ez };
  }
  if (c.shape === "walls") {
    const segs = c.segs;
    if (segs.length < 2) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < segs.length; i += 2) {
      const x = segs[i]!;
      const z = segs[i + 1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, maxX, minZ, maxZ };
  }
  if (c.shape === "mesh") {
    const scl = c.scale || 1;
    const hx = Math.abs(c.hx) * scl;
    const hz = Math.abs(c.hz) * scl;
    const cy = Math.cos(c.yaw);
    const sy = Math.sin(c.yaw);
    const lx = c.cx * scl;
    const lz = c.cz * scl;
    const wx = c.x + lx * cy + lz * sy;
    const wz = c.z - lx * sy + lz * cy;
    const ex = Math.abs(cy) * hx + Math.abs(sy) * hz;
    const ez = Math.abs(sy) * hx + Math.abs(cy) * hz;
    return { minX: wx - ex, maxX: wx + ex, minZ: wz - ez, maxZ: wz + ez };
  }
  const r = Math.max(0.05, c.radius);
  return { minX: c.x - r, maxX: c.x + r, minZ: c.z - r, maxZ: c.z + r };
}

function unionBounds(colliders: readonly StaticCollider[], pad: number): Aabb {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of colliders) {
    const b = colliderAabb(c);
    if (!b) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.minZ < minZ) minZ = b.minZ;
    if (b.maxZ > maxZ) maxZ = b.maxZ;
  }
  if (!Number.isFinite(minX)) {
    return { minX: -DEFAULT_HALF_M, maxX: DEFAULT_HALF_M, minZ: -DEFAULT_HALF_M, maxZ: DEFAULT_HALF_M };
  }
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;
  if (maxX - minX > MAX_SPAN_M) {
    const mid = (minX + maxX) * 0.5;
    minX = mid - MAX_SPAN_M * 0.5;
    maxX = mid + MAX_SPAN_M * 0.5;
  }
  if (maxZ - minZ > MAX_SPAN_M) {
    const mid = (minZ + maxZ) * 0.5;
    minZ = mid - MAX_SPAN_M * 0.5;
    maxZ = mid + MAX_SPAN_M * 0.5;
  }
  return { minX, maxX, minZ, maxZ };
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size() {
    return this.keys.length;
  }

  push(key: number, val: number) {
    this.keys.push(key);
    this.vals.push(val);
    this.up(this.keys.length - 1);
  }

  pop(): { key: number; val: number } | undefined {
    const n = this.keys.length;
    if (n === 0) return undefined;
    const key = this.keys[0]!;
    const val = this.vals[0]!;
    const lastK = this.keys.pop()!;
    const lastV = this.vals.pop()!;
    if (n > 1) {
      this.keys[0] = lastK;
      this.vals[0] = lastV;
      this.down(0);
    }
    return { key, val };
  }

  private up(i: number) {
    const { keys, vals } = this;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (vals[p]! <= vals[i]!) break;
      const tk = keys[p]!;
      const tv = vals[p]!;
      keys[p] = keys[i]!;
      vals[p] = vals[i]!;
      keys[i] = tk;
      vals[i] = tv;
      i = p;
    }
  }

  private down(i: number) {
    const { keys, vals } = this;
    const n = keys.length;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let s = i;
      if (l < n && vals[l]! < vals[s]!) s = l;
      if (r < n && vals[r]! < vals[s]!) s = r;
      if (s === i) break;
      const tk = keys[s]!;
      const tv = vals[s]!;
      keys[s] = keys[i]!;
      vals[s] = vals[i]!;
      keys[i] = tk;
      vals[i] = tv;
      i = s;
    }
  }
}

/**
 * Occupancy grid + shared flow field so PvE mobs walk around authored props
 * instead of sliding forever into the face of a house.
 */
export class MobNavGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly originZ: number;
  private readonly blocked: Uint8Array;
  private readonly dist: Float32Array;
  private readonly flowX: Float32Array;
  private readonly flowZ: Float32Array;
  private lastFlowAt = Number.NEGATIVE_INFINITY;
  private readonly walkWalls: ReturnType<typeof bodyBlockers>["walls"];
  private readonly walkCircles: ReturnType<typeof bodyBlockers>["circles"];
  private readonly walkBoxes: ReturnType<typeof bodyBlockers>["boxes"];
  private readonly agentRadius: number;

  constructor(
    colliders: readonly StaticCollider[],
    agentRadius = COLLISION.dummyRadius + COLLISION.skin,
    cell = PVE_MOB_NAV_CELL_M,
  ) {
    this.cell = Math.max(0.5, cell);
    this.agentRadius = agentRadius;
    const pad = BOUNDS_PAD_M + agentRadius;
    const bounds = unionBounds(colliders, pad);
    this.originX = bounds.minX;
    this.originZ = bounds.minZ;
    this.cols = Math.max(4, Math.ceil((bounds.maxX - bounds.minX) / this.cell));
    this.rows = Math.max(4, Math.ceil((bounds.maxZ - bounds.minZ) / this.cell));
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.dist = new Float32Array(n);
    this.flowX = new Float32Array(n);
    this.flowZ = new Float32Array(n);
    const split = bodyBlockers(colliders);
    this.walkWalls = split.walls;
    this.walkCircles = split.circles;
    this.walkBoxes = split.boxes;
    this.paint(colliders);
  }

  hasWalkLos(from: Vec2, to: Vec2): boolean {
    const t = lastFreeTBeforeWalls(
      from,
      to,
      this.agentRadius,
      this.walkWalls,
      this.walkCircles,
      this.walkBoxes,
    );
    return t == null || t >= 0.97;
  }

  rebuildFlow(goals: readonly Vec2[], now: number, intervalMs = PVE_MOB_NAV_FLOW_MS): void {
    if (goals.length === 0) return;
    if (now - this.lastFlowAt < intervalMs && this.lastFlowAt > 0) return;
    this.lastFlowAt = now;
    const { cols, rows, blocked, dist, flowX, flowZ } = this;
    const n = cols * rows;
    dist.fill(INF);
    flowX.fill(0);
    flowZ.fill(0);
    const heap = new MinHeap();

    const seedCell = (ix: number, iz: number, d: number) => {
      if (ix < 0 || iz < 0 || ix >= cols || iz >= rows) return;
      const i = iz * cols + ix;
      if (blocked[i]) return;
      if (d >= dist[i]!) return;
      dist[i] = d;
      heap.push(i, d);
    };

    for (const g of goals) {
      const ix = this.cellX(g.x);
      const iz = this.cellZ(g.z);
      seedCell(ix, iz, 0);
      if (ix < 0 || iz < 0 || ix >= cols || iz >= rows) continue;
      const i = iz * cols + ix;
      if (!blocked[i]) continue;
      for (const [dx, dz] of NBR) {
        seedCell(ix + dx, iz + dz, dx === 0 || dz === 0 ? 1 : DIAG);
      }
    }

    while (heap.size > 0) {
      const item = heap.pop()!;
      const i = item.key;
      if (item.val > dist[i]!) continue;
      const ix = i % cols;
      const iz = (i / cols) | 0;
      for (const [dx, dz, cost] of NBR) {
        const nx = ix + dx;
        const nz = iz + dz;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        if (dx !== 0 && dz !== 0) {
          const a = iz * cols + nx;
          const b = nz * cols + ix;
          if (blocked[a] || blocked[b]) continue;
        }
        const j = nz * cols + nx;
        if (blocked[j]) continue;
        const nd = dist[i]! + cost;
        if (nd + 1e-6 >= dist[j]!) continue;
        dist[j] = nd;
        heap.push(j, nd);
      }
    }

    for (let iz = 0; iz < rows; iz++) {
      for (let ix = 0; ix < cols; ix++) {
        const i = iz * cols + ix;
        if (blocked[i] || dist[i]! >= INF) continue;
        let best = dist[i]!;
        let bx = 0;
        let bz = 0;
        for (const [dx, dz] of NBR) {
          const nx = ix + dx;
          const nz = iz + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          const j = nz * cols + nx;
          const d = dist[j]!;
          if (d + 1e-4 >= best) continue;
          best = d;
          bx = dx;
          bz = dz;
        }
        if (bx === 0 && bz === 0) continue;
        const len = Math.hypot(bx, bz) || 1;
        flowX[i] = bx / len;
        flowZ[i] = bz / len;
      }
    }
  }

  sampleDir(x: number, z: number): Vec2 {
    const ix = this.cellX(x);
    const iz = this.cellZ(z);
    const { cols, rows, blocked, dist, flowX, flowZ } = this;
    if (ix < 0 || iz < 0 || ix >= cols || iz >= rows) return { x: 0, z: 0 };
    const i = iz * cols + ix;
    if (!blocked[i] && (flowX[i] !== 0 || flowZ[i] !== 0)) {
      return { x: flowX[i]!, z: flowZ[i]! };
    }
    let best = INF;
    let bx = 0;
    let bz = 0;
    for (const [dx, dz] of NBR) {
      const nx = ix + dx;
      const nz = iz + dz;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      const j = nz * cols + nx;
      if (blocked[j] || dist[j]! >= best) continue;
      best = dist[j]!;
      bx = dx;
      bz = dz;
    }
    if (bx === 0 && bz === 0) return { x: 0, z: 0 };
    const len = Math.hypot(bx, bz) || 1;
    return { x: bx / len, z: bz / len };
  }

  private paint(colliders: readonly StaticCollider[]) {
    const infl = this.agentRadius;
    const { cell, cols, rows, blocked } = this;
    for (const c of colliders) {
      const b = colliderAabb(c);
      if (!b) continue;
      const x0 = Math.max(0, this.cellX(b.minX - infl));
      const x1 = Math.min(cols - 1, this.cellX(b.maxX + infl));
      const z0 = Math.max(0, this.cellZ(b.minZ - infl));
      const z1 = Math.min(rows - 1, this.cellZ(b.maxZ + infl));
      if (x1 < x0 || z1 < z0) continue;
      const solids: StaticCollider[] = [c];
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const i = iz * cols + ix;
          if (blocked[i]) continue;
          const p = {
            x: this.originX + (ix + 0.5) * cell,
            z: this.originZ + (iz + 0.5) * cell,
          };
          const out = resolveCollisions(p, infl, solids);
          if (length2(out.x - p.x, out.z - p.z) > 1e-4) blocked[i] = 1;
        }
      }
    }
  }

  private cellX(x: number): number {
    return Math.floor((x - this.originX) / this.cell);
  }

  private cellZ(z: number): number {
    return Math.floor((z - this.originZ) / this.cell);
  }
}

/** One step toward `goal`, detouring via the flow field when props block the ray. */
export function steerMobStep(
  from: Vec2,
  goal: Vec2,
  step: number,
  nav: MobNavGrid | null,
  preferFlow = false,
): Vec2 {
  const dx = goal.x - from.x;
  const dz = goal.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4 || step <= 0) return { x: from.x, z: from.z };
  const nx = dx / dist;
  const nz = dz / dist;
  if (!nav) {
    return { x: from.x + nx * step, z: from.z + nz * step };
  }
  const probe = Math.min(dist, PVE_MOB_NAV_LOS_M);
  const losTo: Vec2 = { x: from.x + nx * probe, z: from.z + nz * probe };
  if (!preferFlow && nav.hasWalkLos(from, losTo)) {
    return { x: from.x + nx * step, z: from.z + nz * step };
  }
  const flow = nav.sampleDir(from.x, from.z);
  const fl = Math.hypot(flow.x, flow.z);
  if (fl > 0.15) {
    return {
      x: from.x + (flow.x / fl) * step,
      z: from.z + (flow.z / fl) * step,
    };
  }
  return { x: from.x + nx * step, z: from.z + nz * step };
}

/**
 * Face the walk heading while moving; face the focus when standing, swinging,
 * or explicitly aiming.
 */
export function mobWalkYaw(
  prevYaw: number,
  movedX: number,
  movedZ: number,
  targetDx: number,
  targetDz: number,
  dt: number,
  faceTarget: boolean,
): number {
  const walking = !faceTarget && movedX * movedX + movedZ * movedZ > PVE_MOB_WALK_YAW_EPS_M * PVE_MOB_WALK_YAW_EPS_M;
  const want = walking
    ? Math.atan2(movedX, movedZ)
    : Math.atan2(targetDx, targetDz);
  return stepYawToward(prevYaw, want, PVE_MOB_TURN_RAD_PER_SEC, dt);
}
