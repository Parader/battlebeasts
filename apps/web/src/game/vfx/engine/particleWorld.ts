import * as THREE from "three";
import { MAX_DT, MAX_EMITTERS, MAX_PARTICLES, LOD_TRAIL_RATIO } from "./budgets";
import { getBatchMaterial, tickSmokeMaterial } from "./billboardMaterial";
import { ATLAS_UV, primeParticleAtlas } from "./atlas";
import {
  BatchId,
  Collide,
  LodRank,
  type AtlasUv,
  type EmitterSpawn,
  type ParticleStats,
} from "./types";

type Emitter = {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  rate: number;
  acc: number;
  spread: number;
  gravity: number;
  drag: number;
  noise: number;
  groundY: number;
  collide: Collide;
  batch: BatchId;
  uv: AtlasUv;
  c0: THREE.Color;
  c1: THREE.Color;
  c2: THREE.Color;
  size: number;
  sizeEnd: number;
  life: number;
  lifeJitter: number;
  rotRate: number;
  rotJitter: number;
  opacity: number;
  lod: LodRank;
  remaining: number;
  /** >0 steers living particles from this emitter toward homeX/Y/Z. */
  homeStrength: number;
  homeX: number;
  homeY: number;
  homeZ: number;
  /** Kill particle when within this distance of home (0 = never). */
  homeKillRadius: number;
};

type GpuBatch = {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  pos: Float32Array;
  color: Float32Array;
  sizeRot: Float32Array;
  uv: Float32Array;
  posAttr: THREE.InstancedBufferAttribute;
  colorAttr: THREE.InstancedBufferAttribute;
  sizeRotAttr: THREE.InstancedBufferAttribute;
  uvAttr: THREE.InstancedBufferAttribute;
  write: number;
};

const _c0 = new THREE.Color();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _cOut = new THREE.Color();

function lerpStops(t: number, c0: THREE.Color, c1: THREE.Color, c2: THREE.Color, out: THREE.Color) {
  if (t < 0.35) return out.copy(c0).lerp(c1, t / 0.35);
  return out.copy(c1).lerp(c2, (t - 0.35) / 0.65);
}

function alphaAt(t: number, batch: BatchId): number {
  // Sandbox smoke: soft fade-in, early fade-out (uFadeIn≈0.14, uFadeOut≈0.3).
  if (batch === BatchId.AlphaSmoke) {
    const fadeIn = Math.min(1, t / 0.14);
    const fadeOut = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
    return fadeIn * Math.max(0, fadeOut);
  }
  if (t < 0.12) return t / 0.12;
  if (t < 0.55) return 1;
  return 1 - (t - 0.55) / 0.45;
}

function sizeAt(t: number, a: number, b: number, batch: BatchId): number {
  // Smoke billows hard (sandbox uEndSize ≈ 3×) — lean into growth after birth.
  if (batch === BatchId.AlphaSmoke) {
    const grow = 0.35 + 0.65 * Math.min(1, t / 0.45);
    return (a + (b - a) * t) * grow;
  }
  const k = 0.45 + 0.7 * Math.min(1, t * 1.15);
  return (a + (b - a) * t) * k;
}

function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function defaultUv(batch: BatchId): AtlasUv {
  if (batch === BatchId.AdditiveFire) return ATLAS_UV.fire;
  if (batch === BatchId.AdditiveSpark) return ATLAS_UV.spark;
  if (batch === BatchId.AlphaSmoke) return ATLAS_UV.smoke;
  return ATLAS_UV.ice;
}

const QUAD = new THREE.PlaneGeometry(1, 1);

function makeGpuBatch(batch: BatchId, max: number): GpuBatch {
  const geo = new THREE.InstancedBufferGeometry();
  const index = QUAD.index;
  if (index) geo.setIndex(index.clone());
  geo.setAttribute("position", QUAD.getAttribute("position")!.clone());
  geo.setAttribute("uv", QUAD.getAttribute("uv")!.clone());
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const pos = new Float32Array(max * 3);
  const color = new Float32Array(max * 4);
  const sizeRot = new Float32Array(max * 2);
  const uv = new Float32Array(max * 4);
  const posAttr = new THREE.InstancedBufferAttribute(pos, 3);
  const colorAttr = new THREE.InstancedBufferAttribute(color, 4);
  const sizeRotAttr = new THREE.InstancedBufferAttribute(sizeRot, 2);
  const uvAttr = new THREE.InstancedBufferAttribute(uv, 4);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  sizeRotAttr.setUsage(THREE.DynamicDrawUsage);
  uvAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aInstPos", posAttr);
  geo.setAttribute("aInstColor", colorAttr);
  geo.setAttribute("aInstSizeRot", sizeRotAttr);
  geo.setAttribute("aInstUv", uvAttr);

  const mesh = new THREE.Mesh(geo, getBatchMaterial(batch));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.name = `VfxParticleBatch:${batch}`;
  mesh.renderOrder = 8;
  mesh.visible = false;

  return {
    mesh,
    geo,
    pos,
    color,
    sizeRot,
    uv,
    posAttr,
    colorAttr,
    sizeRotAttr,
    uvAttr,
    write: 0,
  };
}

export class ParticleWorld {
  readonly group = new THREE.Group();
  readonly stats: ParticleStats = {
    living: 0,
    emitters: 0,
    simMs: 0,
    draws: 0,
    lodActive: false,
  };

  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly pz = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly vz = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly size0 = new Float32Array(MAX_PARTICLES);
  private readonly size1 = new Float32Array(MAX_PARTICLES);
  private readonly rot = new Float32Array(MAX_PARTICLES);
  private readonly rotRate = new Float32Array(MAX_PARTICLES);
  private readonly batchOf = new Uint8Array(MAX_PARTICLES);
  private readonly collideOf = new Uint8Array(MAX_PARTICLES);
  private readonly groundY = new Float32Array(MAX_PARTICLES);
  private readonly gravity = new Float32Array(MAX_PARTICLES);
  private readonly drag = new Float32Array(MAX_PARTICLES);
  private readonly noise = new Float32Array(MAX_PARTICLES);
  private readonly opacity = new Float32Array(MAX_PARTICLES);
  private readonly uv0 = new Float32Array(MAX_PARTICLES);
  private readonly uv1 = new Float32Array(MAX_PARTICLES);
  private readonly uv2 = new Float32Array(MAX_PARTICLES);
  private readonly uv3 = new Float32Array(MAX_PARTICLES);
  private readonly c0r = new Float32Array(MAX_PARTICLES);
  private readonly c0g = new Float32Array(MAX_PARTICLES);
  private readonly c0b = new Float32Array(MAX_PARTICLES);
  private readonly c1r = new Float32Array(MAX_PARTICLES);
  private readonly c1g = new Float32Array(MAX_PARTICLES);
  private readonly c1b = new Float32Array(MAX_PARTICLES);
  private readonly c2r = new Float32Array(MAX_PARTICLES);
  private readonly c2g = new Float32Array(MAX_PARTICLES);
  private readonly c2b = new Float32Array(MAX_PARTICLES);
  private readonly alive = new Uint8Array(MAX_PARTICLES);
  /** Emitter id that spawned this particle (−1 if none). */
  private readonly emitterOf = new Int16Array(MAX_PARTICLES);
  private readonly free: number[] = [];
  private living = 0;

  private readonly emitters: Emitter[] = [];
  private readonly emitterFree: number[] = [];
  private emitterCount = 0;
  private readonly batches: GpuBatch[] = [];
  private disposed = false;
  private time = 0;

  constructor() {
    this.group.name = "VfxParticleWorld";
    for (let i = MAX_PARTICLES - 1; i >= 0; i--) this.free.push(i);
    this.emitterOf.fill(-1);
    for (let i = MAX_EMITTERS - 1; i >= 0; i--) this.emitterFree.push(i);
    for (let i = 0; i < MAX_EMITTERS; i++) {
      this.emitters.push({
        alive: false,
        x: 0,
        y: 0,
        z: 0,
        dirX: 0,
        dirY: 1,
        dirZ: 0,
        rate: 0,
        acc: 0,
        spread: 0.18,
        gravity: 0,
        drag: 0.12,
        noise: 0,
        groundY: 0,
        collide: Collide.Kill,
        batch: BatchId.AdditiveFire,
        uv: ATLAS_UV.fire,
        c0: new THREE.Color("#fff7ed"),
        c1: new THREE.Color("#fb923c"),
        c2: new THREE.Color("#ef4444"),
        size: 0.4,
        sizeEnd: 0.12,
        life: 1,
        lifeJitter: 0.35,
        rotRate: 1.2,
        rotJitter: 1,
        opacity: 1,
        lod: LodRank.Core,
        remaining: -1,
        homeStrength: 0,
        homeX: 0,
        homeY: 0,
        homeZ: 0,
        homeKillRadius: 0,
      });
    }
    for (let b = 0; b < 4; b++) {
      const gpu = makeGpuBatch(b as BatchId, MAX_PARTICLES);
      this.batches.push(gpu);
      this.group.add(gpu.mesh);
    }
    primeParticleAtlas();
  }

  spawnEmitter(cfg: EmitterSpawn): number {
    if (this.disposed) return -1;
    const id = this.emitterFree.pop();
    if (id === undefined) return -1;
    const e = this.emitters[id]!;
    const batch = cfg.batch ?? BatchId.AdditiveFire;
    e.alive = true;
    e.x = cfg.x;
    e.y = cfg.y;
    e.z = cfg.z;
    e.dirX = cfg.dirX ?? 0;
    e.dirY = cfg.dirY ?? 1;
    e.dirZ = cfg.dirZ ?? 0;
    e.rate = cfg.rate ?? 70;
    e.acc = 0;
    e.spread = cfg.spread ?? 0.18;
    e.gravity = cfg.gravity ?? 0.4;
    e.drag = cfg.drag ?? 0.12;
    e.noise = cfg.noise ?? 0.35;
    e.groundY = cfg.groundY ?? 0;
    e.collide = cfg.collide ?? Collide.Kill;
    e.batch = batch;
    e.uv = cfg.atlasUv ?? defaultUv(batch);
    e.c0.set(cfg.color0 || "#fff7ed");
    e.c1.set(cfg.color1 || "#fb923c");
    e.c2.set(cfg.color2 || "#ef4444");
    e.size = cfg.size ?? 0.42;
    e.sizeEnd = cfg.sizeEnd ?? 0.1;
    e.life = cfg.life ?? 1.05;
    e.lifeJitter = cfg.lifeJitter ?? 0.35;
    e.rotRate = cfg.rotRate ?? 1.4;
    e.rotJitter = cfg.rotJitter ?? 1;
    e.opacity = cfg.opacity ?? 1;
    e.lod = cfg.lod ?? LodRank.Core;
    e.remaining = cfg.duration && cfg.duration > 0 ? cfg.duration : -1;
    e.homeStrength = cfg.homeStrength ?? 0;
    e.homeX = cfg.homeX ?? cfg.x;
    e.homeY = cfg.homeY ?? cfg.y;
    e.homeZ = cfg.homeZ ?? cfg.z;
    e.homeKillRadius = cfg.homeKillRadius ?? 0;
    this.emitterCount++;
    const burst = cfg.burst ?? 0;
    for (let i = 0; i < burst; i++) this.emitOne(e, id);
    return id;
  }

  setEmitterPose(id: number, x: number, y: number, z: number, dirX?: number, dirY?: number, dirZ?: number): void {
    const e = this.emitters[id];
    if (!e?.alive) return;
    e.x = x;
    e.y = y;
    e.z = z;
    if (dirX !== undefined) e.dirX = dirX;
    if (dirY !== undefined) e.dirY = dirY;
    if (dirZ !== undefined) e.dirZ = dirZ;
  }

  setEmitterRate(id: number, rate: number): void {
    const e = this.emitters[id];
    if (!e?.alive) return;
    e.rate = Math.max(0, rate);
  }

  setEmitterLook(id: number, spread: number, size: number, sizeEnd: number): void {
    const e = this.emitters[id];
    if (!e?.alive) return;
    e.spread = Math.max(0, spread);
    e.size = Math.max(0.01, size);
    e.sizeEnd = Math.max(0.005, sizeEnd);
  }

  setEmitterLife(id: number, life: number, lifeJitter?: number): void {
    const e = this.emitters[id];
    if (!e?.alive) return;
    e.life = Math.max(0.05, life);
    if (lifeJitter !== undefined) e.lifeJitter = Math.max(0, lifeJitter);
  }

  /** Steer living particles from this emitter toward a world point. */
  setEmitterHoming(
    id: number,
    x: number,
    y: number,
    z: number,
    strength: number,
    killRadius = 0,
  ): void {
    const e = this.emitters[id];
    if (!e?.alive) return;
    e.homeX = x;
    e.homeY = y;
    e.homeZ = z;
    e.homeStrength = Math.max(0, strength);
    e.homeKillRadius = Math.max(0, killRadius);
  }

  killEmitter(id: number): void {
    const e = this.emitters[id];
    if (!e?.alive) return;
    e.alive = false;
    this.emitterCount--;
    this.emitterFree.push(id);
  }

  killAll(): void {
    for (let i = 0; i < MAX_EMITTERS; i++) {
      if (this.emitters[i]!.alive) this.killEmitter(i);
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.alive[i]) {
        this.alive[i] = 0;
        this.free.push(i);
      }
    }
    this.living = 0;
  }

  tick(dt: number): void {
    if (this.disposed) return;
    const t0 = performance.now();
    const safeDt = Math.min(MAX_DT, Math.max(0, dt));
    this.time += safeDt;
    tickSmokeMaterial(this.time);
    const lod = this.living / MAX_PARTICLES > LOD_TRAIL_RATIO;

    for (let i = 0; i < MAX_EMITTERS; i++) {
      const e = this.emitters[i]!;
      if (!e.alive) continue;
      if (e.remaining > 0) {
        e.remaining -= safeDt;
        if (e.remaining <= 0) {
          this.killEmitter(i);
          continue;
        }
      }
      if (lod && e.lod === LodRank.Trail) continue;
      if (e.rate <= 0 || this.living >= MAX_PARTICLES) continue;
      e.acc += e.rate * safeDt;
      let n = e.acc | 0;
      e.acc -= n;
      while (n > 0 && this.living < MAX_PARTICLES) {
        this.emitOne(e, i);
        n--;
      }
    }

    for (const b of this.batches) b.write = 0;

    let living = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;
      let remaining = this.life[i]! - safeDt;
      if (remaining <= 0) {
        this.alive[i] = 0;
        this.emitterOf[i] = -1;
        this.free.push(i);
        continue;
      }
      this.life[i] = remaining;
      const batch = this.batchOf[i]! as BatchId;
      const eid = this.emitterOf[i]!;
      if (eid >= 0) {
        const em = this.emitters[eid];
        if (em?.alive && em.homeStrength > 0) {
          const dx = em.homeX - this.px[i]!;
          const dy = em.homeY - this.py[i]!;
          const dz = em.homeZ - this.pz[i]!;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (em.homeKillRadius > 0 && dist <= em.homeKillRadius) {
            this.alive[i] = 0;
            this.emitterOf[i] = -1;
            this.free.push(i);
            continue;
          }
          if (dist > 1e-4) {
            // Receding from home = already flew past. Don't U-turn; fade out on the far side.
            const closing =
              this.vx[i]! * dx + this.vy[i]! * dy + this.vz[i]! * dz;
            if (em.homeKillRadius > 0 && closing < 0) {
              this.life[i] = Math.min(this.life[i]!, 0.16);
            } else {
              const inv = 1 / dist;
              const pull = em.homeStrength * safeDt;
              this.vx[i]! += dx * inv * pull;
              this.vy[i]! += dy * inv * pull;
              this.vz[i]! += dz * inv * pull;
            }
          }
        }
      }
      const n = this.noise[i]!;
      if (n > 0) {
        // Curl-ish swirl (sandbox USE_CURL): two phase-offset oscillators.
        const h = hash(i) * 6.28318 + this.time * (batch === BatchId.AlphaSmoke ? 1.35 : 3.1);
        const amp = n * safeDt;
        this.vx[i]! += Math.sin(h) * amp;
        this.vz[i]! += Math.cos(h * 0.87 + 1.7) * amp;
        if (batch === BatchId.AlphaSmoke) {
          this.vy[i]! += Math.sin(h * 0.61 + 0.4) * amp * 0.35;
        }
      }
      this.vy[i]! += this.gravity[i]! * safeDt;
      const drag = 1 - this.drag[i]! * safeDt;
      this.vx[i]! *= drag;
      this.vy[i]! *= drag;
      this.vz[i]! *= drag;
      this.px[i]! += this.vx[i]! * safeDt;
      this.py[i]! += this.vy[i]! * safeDt;
      this.pz[i]! += this.vz[i]! * safeDt;
      this.rot[i]! += this.rotRate[i]! * safeDt;

      const collide = this.collideOf[i]!;
      if (collide !== Collide.None && this.py[i]! < this.groundY[i]!) {
        if (collide === Collide.Bounce) {
          this.py[i] = this.groundY[i]!;
          this.vy[i]! *= -0.35;
        } else {
          this.alive[i] = 0;
          this.emitterOf[i] = -1;
          this.free.push(i);
          continue;
        }
      }

      const t = 1 - remaining / this.maxLife[i]!;
      const gpu = this.batches[batch]!;
      const w = gpu.write;
      if (w >= MAX_PARTICLES) continue;
      gpu.pos[w * 3] = this.px[i]!;
      gpu.pos[w * 3 + 1] = this.py[i]!;
      gpu.pos[w * 3 + 2] = this.pz[i]!;
      _c0.setRGB(this.c0r[i]!, this.c0g[i]!, this.c0b[i]!);
      _c1.setRGB(this.c1r[i]!, this.c1g[i]!, this.c1b[i]!);
      _c2.setRGB(this.c2r[i]!, this.c2g[i]!, this.c2b[i]!);
      lerpStops(t, _c0, _c1, _c2, _cOut);
      gpu.color[w * 4] = _cOut.r;
      gpu.color[w * 4 + 1] = _cOut.g;
      gpu.color[w * 4 + 2] = _cOut.b;
      gpu.color[w * 4 + 3] = alphaAt(t, batch) * this.opacity[i]!;
      gpu.sizeRot[w * 2] = sizeAt(t, this.size0[i]!, this.size1[i]!, batch);
      gpu.sizeRot[w * 2 + 1] = this.rot[i]!;
      gpu.uv[w * 4] = this.uv0[i]!;
      gpu.uv[w * 4 + 1] = this.uv1[i]!;
      gpu.uv[w * 4 + 2] = this.uv2[i]!;
      gpu.uv[w * 4 + 3] = this.uv3[i]!;
      gpu.write = w + 1;
      living++;
    }
    this.living = living;

    let draws = 0;
    for (const gpu of this.batches) {
      const n = gpu.write;
      gpu.geo.instanceCount = n;
      gpu.mesh.visible = n > 0;
      if (n > 0) {
        gpu.posAttr.needsUpdate = true;
        gpu.colorAttr.needsUpdate = true;
        gpu.sizeRotAttr.needsUpdate = true;
        gpu.uvAttr.needsUpdate = true;
        draws++;
      }
    }

    this.stats.living = living;
    this.stats.emitters = this.emitterCount;
    this.stats.simMs = performance.now() - t0;
    this.stats.draws = draws;
    this.stats.lodActive = lod;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.killAll();
    this.group.removeFromParent();
    for (const gpu of this.batches) {
      gpu.geo.dispose();
    }
  }

  private emitOne(e: Emitter, seed: number): void {
    const slot = this.free.pop();
    if (slot === undefined) return;
    const j = hash(slot + seed + (this.time * 100) | 0);
    const j2 = hash(slot * 3.1 + seed);
    const j3 = hash(slot * 7.7 + seed * 1.3);
    this.alive[slot] = 1;
    this.emitterOf[slot] = seed;
    this.px[slot] = e.x + (j * 2 - 1) * e.spread;
    this.py[slot] = e.y + j2 * 0.06;
    this.pz[slot] = e.z + (j3 * 2 - 1) * e.spread;
    this.vx[slot] = e.dirX + (j * 2 - 1) * e.spread * 1.6;
    this.vy[slot] = e.dirY * (0.7 + j2 * 0.45);
    this.vz[slot] = e.dirZ + (j3 * 2 - 1) * e.spread * 1.6;
    const life = e.life * (1 - e.lifeJitter * 0.5 + j * e.lifeJitter);
    this.life[slot] = life;
    this.maxLife[slot] = life;
    this.size0[slot] = e.size * (0.65 + j2 * 0.5);
    this.size1[slot] = e.sizeEnd;
    this.rot[slot] = e.rotJitter > 0 ? j * 6.28318 * e.rotJitter : 0;
    this.rotRate[slot] = e.rotRate === 0 ? 0 : (j3 * 2 - 1) * e.rotRate;
    this.batchOf[slot] = e.batch;
    this.collideOf[slot] = e.collide;
    this.groundY[slot] = e.groundY;
    this.gravity[slot] = e.gravity;
    this.drag[slot] = e.drag;
    this.noise[slot] = e.noise;
    this.opacity[slot] = e.opacity;
    this.uv0[slot] = e.uv[0];
    this.uv1[slot] = e.uv[1];
    this.uv2[slot] = e.uv[2];
    this.uv3[slot] = e.uv[3];
    this.c0r[slot] = e.c0.r;
    this.c0g[slot] = e.c0.g;
    this.c0b[slot] = e.c0.b;
    this.c1r[slot] = e.c1.r;
    this.c1g[slot] = e.c1.g;
    this.c1b[slot] = e.c1.b;
    this.c2r[slot] = e.c2.r;
    this.c2g[slot] = e.c2.g;
    this.c2b[slot] = e.c2.b;
    this.living++;
  }
}

let bound: ParticleWorld | null = null;

export function bindParticleWorld(world: ParticleWorld | null): void {
  bound = world;
}

export function getParticleWorld(): ParticleWorld | null {
  return bound;
}
