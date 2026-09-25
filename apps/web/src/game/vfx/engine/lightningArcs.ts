import * as THREE from "three";
import { lightningSettings } from "./lightningSettings";

/**
 * Lightning ported from `elemental sandbox` LinearAbiltyCastingThreeJS
 * (`LightningMaterial.js` + `createBoltRibbonGeometry`).
 *
 * One instanced ribbon strip; path/kinks/fan evaluated in the vertex shader
 * with *linear* value noise so corners stay sharp (reads as lightning, not a tube).
 * Live knobs: `lightningSettings` (same idea as sandbox `settings.thunder`).
 */

const NODES = 72;
const MAX_STRANDS = 16;

const HASH_GLSL = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
`;

const BOLT_VERTEX = /* glsl */ `
  #define PI  3.141592653589793
  #define TAU 6.283185307179586

  uniform float uTime;
  uniform vec3  uOrigin;
  uniform vec3  uTarget;
  uniform vec3  uSide;
  uniform float uSag;
  uniform float uSeed;
  uniform float uRestrike;

  uniform float uStrands;
  uniform float uSpread;
  uniform float uSpreadNear;
  uniform float uSpreadCurve;
  uniform float uTwist;
  uniform float uTwistSpeed;

  uniform float uJitter;
  uniform float uJitterScale;
  uniform float uOctaves;
  uniform float uJitterFalloff;
  uniform float uCrawl;
  uniform float uPinch;
  uniform float uConverge;

  uniform float uWidth;
  uniform float uWidthTip;
  uniform float uWidthCurve;
  uniform float uCoreWidth;
  uniform float uWidthScale;
  uniform float uStrandFlash;
  uniform float uFlickerSpeed;
  uniform float uFade;

  attribute float aStrand;

  varying float vT;
  varying float vSide;
  varying float vStrand;
  varying float vFlash;
  varying float vSpan;

  ${HASH_GLSL}

  float vnoise(float x, float seed) {
    float i = floor(x);
    float f = x - i;
    return mix(hash11(i + seed), hash11(i + 1.0 + seed), f) * 2.0 - 1.0;
  }

  vec2 kink(float t, float seed, float span) {
    vec2 o = vec2(0.0);
    float amp = 1.0;
    float freq = max(uJitterScale, 0.01) * span;
    float scroll = uTime * uCrawl;
    for (int i = 0; i < 5; i++) {
      float on = step(float(i), uOctaves - 1.0);
      o.x += on * amp * vnoise(t * freq + scroll, seed + 13.0 * float(i));
      o.y += on * amp * vnoise(t * freq + scroll * 1.17, seed + 71.3 + 13.0 * float(i));
      amp *= uJitterFalloff;
      freq *= 2.0;
      scroll *= 1.63;
    }
    return o;
  }

  vec3 boltPoint(float t, float seed, float radial, vec3 n1, vec3 n2, float span) {
    vec3 axis = mix(uOrigin, uTarget, t);
    axis.y += uSag * sin(t * PI);
    float pinch = max(uPinch, 1e-3);
    float ends = smoothstep(0.0, pinch, t) *
                 mix(1.0, smoothstep(0.0, pinch, 1.0 - t), clamp(uConverge, 0.0, 1.0));
    vec2 offset = kink(t, seed, span) * uJitter * ends;
    float angle = seed * TAU + (t * uTwist + uTime * uTwistSpeed) * TAU;
    float reach = mix(uSpreadNear, uSpread, pow(clamp(t, 0.0, 1.0), max(uSpreadCurve, 0.01)));
    offset += vec2(cos(angle), sin(angle)) * reach * radial;
    return axis + n1 * offset.x + n2 * offset.y;
  }

  void main() {
    float t = position.x;
    float side = position.y;
    vT = t;
    vSide = side;

    vec3 delta = uTarget - uOrigin;
    float span = max(length(delta), 0.01);
    vSpan = span;
    vec3 dir = delta / span;
    vec3 n1 = uSide - dir * dot(uSide, dir);
    n1 = length(n1) > 1e-4 ? normalize(n1) : normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
    vec3 n2 = normalize(cross(dir, n1));

    float strike = floor(uTime * max(uRestrike, 0.01));
    float seed = hash11(aStrand * 7.13 + uSeed + strike * 3.77) * 97.0;
    float radial = uStrands <= 1.0 ? 0.0 : aStrand / (uStrands - 1.0);
    vStrand = radial;

    // Shared geo instances all strands; hide extras when this cluster wants fewer
    float alive = step(aStrand + 0.5, uStrands);

    vec3 here = boltPoint(t, seed, radial, n1, n2, span);
    float step_ = 0.02;
    float ahead = t + step_;
    float flip = 1.0;
    if (ahead > 1.0) { ahead = t - step_; flip = -1.0; }
    vec3 next = boltPoint(ahead, seed, radial, n1, n2, span);
    vec3 tangent = (next - here) * flip;
    tangent = length(tangent) > 1e-5 ? normalize(tangent) : dir;

    vec3 toCamera = normalize(cameraPosition - here);
    vec3 binormal = cross(tangent, toCamera);
    float bl = length(binormal);
    binormal = bl > 1e-4 ? binormal / bl : n1;

    float flash = mix(1.0, hash11(floor(uTime * uFlickerSpeed) + aStrand * 3.7 + uSeed), uStrandFlash);
    vFlash = flash * alive;

    float halfWidth = uWidth * uWidthScale;
    halfWidth *= mix(1.0, uWidthTip, pow(clamp(t, 0.0, 1.0), max(uWidthCurve, 0.01)));
    halfWidth *= mix(uCoreWidth, 1.0, radial);
    halfWidth *= flash * uFade * alive;

    vec4 mv = viewMatrix * vec4(here + binormal * side * halfWidth, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const BOLT_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uProgress;
  uniform float uTipGlow;
  uniform float uTipLength;
  uniform float uRoundTip;
  uniform float uWidth;
  uniform float uWidthTip;
  uniform float uWidthScale;
  uniform float uCoreWidth;
  uniform float uCoreSharp;
  uniform float uGlowFalloff;
  uniform float uBranchDim;
  uniform float uFlicker;
  uniform float uFlickerSpeed;
  uniform float uPassOpacity;
  uniform float uOpacity;
  uniform float uGlow;
  uniform float uFade;
  uniform vec3  uColorCore;
  uniform vec3  uColorInner;
  uniform vec3  uColorOuter;
  uniform vec3  uColorHalo;
  uniform vec3  uColorTip;

  varying float vT;
  varying float vSide;
  varying float vStrand;
  varying float vFlash;
  varying float vSpan;

  ${HASH_GLSL}

  void main() {
    float tip = max(uTipLength, 1e-3);
    float drawn = smoothstep(uProgress, uProgress - tip, vT);
    if (drawn <= 0.002) discard;

    float roundA = 1.0;
    if (uRoundTip > 0.5) {
      float tipHalf = uWidth * uWidthScale * uWidthTip * mix(uCoreWidth, 1.0, vStrand);
      float radiusT = tipHalf / max(vSpan, 0.01);
      float nx = (1.0 - vT) / max(radiusT, 1e-4);
      if (nx < 1.05) {
        float d = length(vec2(nx - 1.0, vSide));
        roundA = 1.0 - smoothstep(0.72, 1.0, d);
        if (roundA <= 0.002) discard;
      }
    }

    float v = clamp(abs(vSide), 0.0, 1.0);
    float tipAmt = smoothstep(uProgress - tip * 2.0, uProgress, vT);
    vec3 endCore = mix(uColorCore, uColorTip, tipAmt);

    #ifdef BOLT_GLOW
      float profile = pow(1.0 - v, max(uGlowFalloff, 0.05));
      vec3 color = mix(uColorHalo, uColorOuter, profile);
      float alpha = profile;
    #else
      float profile = pow(1.0 - v, max(uCoreSharp, 0.05));
      vec3 color = mix(uColorOuter, uColorInner, smoothstep(0.0, 0.5, profile));
      color = mix(color, endCore, smoothstep(0.45, 1.0, profile));
      float alpha = profile;
    #endif

    color += uColorTip * tipAmt * uTipGlow;
    float flicker = 1.0 - uFlicker * hash11(floor(uTime * uFlickerSpeed) + uSeed);
    alpha *= drawn * roundA * flicker * vFlash * uFade * uPassOpacity * uOpacity;
    alpha *= mix(1.0, clamp(uBranchDim, 0.0, 1.0), vStrand);
    if (alpha < 0.003) discard;
    color *= uGlow;
    gl_FragColor = vec4(color, alpha);
  }
`;

function createBoltRibbonGeometry(nodes = NODES, strands = MAX_STRANDS): THREE.InstancedBufferGeometry {
  const steps = Math.max(2, Math.round(nodes));
  const count = Math.max(1, Math.round(strands));
  const positions = new Float32Array(steps * 2 * 3);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const o = i * 6;
    positions[o] = t;
    positions[o + 1] = -1;
    positions[o + 3] = t;
    positions[o + 4] = 1;
  }
  const indices = new Uint16Array((steps - 1) * 6);
  for (let i = 0; i < steps - 1; i++) {
    const a = i * 2;
    const o = i * 6;
    indices[o] = a;
    indices[o + 1] = a + 1;
    indices[o + 2] = a + 2;
    indices[o + 3] = a + 1;
    indices[o + 4] = a + 3;
    indices[o + 5] = a + 2;
  }
  const strandIndex = new Float32Array(count);
  for (let i = 0; i < count; i++) strandIndex[i] = i;

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aStrand", new THREE.InstancedBufferAttribute(strandIndex, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return geometry;
}

type BoltPass = "core" | "glow";

function createBoltMaterial(pass: BoltPass): THREE.ShaderMaterial {
  const glow = pass === "glow";
  return new THREE.ShaderMaterial({
    defines: glow ? { BOLT_GLOW: "" } : {},
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
      uTarget: { value: new THREE.Vector3(0, 0, 3) },
      uSide: { value: new THREE.Vector3(1, 0, 0) },
      uSag: { value: 0.22 },
      uSeed: { value: 0 },
      uRestrike: { value: 24 },
      uProgress: { value: 1 },
      uFade: { value: 1 },
      uStrands: { value: 9 },
      uSpread: { value: 0.55 },
      uSpreadNear: { value: 0.05 },
      uSpreadCurve: { value: 1.6 },
      uTwist: { value: 0.45 },
      uTwistSpeed: { value: 0.8 },
      uBranchDim: { value: 0.72 },
      uJitter: { value: 0.34 },
      uJitterScale: { value: 0.85 },
      uOctaves: { value: 4 },
      uJitterFalloff: { value: 0.55 },
      uCrawl: { value: 3.2 },
      uPinch: { value: 0.14 },
      uConverge: { value: 0.8 },
      uWidth: { value: 0.028 },
      uWidthTip: { value: 0.43 },
      uWidthCurve: { value: 1.09 },
      uCoreWidth: { value: 1.31 },
      uCoreSharp: { value: 4.95 },
      uGlowFalloff: { value: 2.4 },
      uWidthScale: { value: glow ? 5.7 : 1 },
      uPassOpacity: { value: glow ? 0.49 : 1 },
      uFlicker: { value: 0.3 },
      uFlickerSpeed: { value: 34 },
      uStrandFlash: { value: 0.5 },
      uTipGlow: { value: 1.2 },
      uTipLength: { value: 0.08 },
      uRoundTip: { value: 0 },
      uOpacity: { value: 1 },
      uGlow: { value: 2.3 },
      uColorCore: { value: new THREE.Color("#ffffff") },
      uColorInner: { value: new THREE.Color("#c9ecff") },
      uColorOuter: { value: new THREE.Color("#3aa0ff") },
      uColorHalo: { value: new THREE.Color("#0b3fc8") },
      uColorTip: { value: new THREE.Color("#ffffff") },
    },
    vertexShader: BOLT_VERTEX,
    fragmentShader: BOLT_FRAGMENT,
  });
}

type ClusterMode = "up" | "segment";

type Cluster = {
  alive: boolean;
  group: THREE.Group;
  glowMesh: THREE.Mesh;
  coreMesh: THREE.Mesh;
  glowMat: THREE.ShaderMaterial;
  coreMat: THREE.ShaderMaterial;
  origin: THREE.Vector3;
  target: THREE.Vector3;
  side: THREE.Vector3;
  seed: number;
  age: number;
  mode: ClusterMode;
  /** World-space endpoints when mode === "segment" */
  endA: THREE.Vector3;
  endB: THREE.Vector3;
  /** Override bolt length (m); null = use lightningSettings.length (up mode) */
  length: number | null;
  /** Multiplier on lateral spread (1 = settings default) */
  spreadMul: number;
  /** Multiplier on kink jitter (1 = settings default) */
  jitterMul: number;
  /** Override sag (m); null = settings.sag */
  sag: number | null;
  /** Override strand count; null = settings.strands */
  strands: number | null;
  /** Override tip glow; null = settings.tipGlow */
  tipGlow: number | null;
  /** Optional per-cluster palette (snare violet on ground, etc.) */
  colorCore: string | null;
  colorInner: string | null;
  colorOuter: string | null;
  colorHalo: string | null;
  /** Target-end color. Null keeps the core color (other bolts unchanged). */
  colorTip: string | null;
  /**
   * Straight ribbon: no kink, sag, crawl, restrike, or brightness strobe.
   * Global thunder settings stay untouched.
   */
  still: boolean;
  /** Glow-pass halo strength. 1 = settings. Core ribbon is unchanged. */
  glowMul: number;
};

const MAX_CLUSTERS = 24;

export type LightningClusterOpts = {
  length?: number;
  spreadMul?: number;
  jitterMul?: number;
  sag?: number;
  strands?: number;
  tipGlow?: number;
  colorCore?: string;
  colorInner?: string;
  colorOuter?: string;
  colorHalo?: string;
  /** Color of the target end. Omit to keep the core color. */
  colorTip?: string;
  /** Freeze the ribbon: straight, no crawl, no flicker. */
  still?: boolean;
  /** Glow halo strength. 1 = normal. Does not change other bolts. */
  glowMul?: number;
};

function buildCluster(sharedGeo: THREE.InstancedBufferGeometry): Cluster {
  const group = new THREE.Group();
  group.name = "LightningCluster";
  const glowMat = createBoltMaterial("glow");
  const coreMat = createBoltMaterial("core");
  const glowMesh = new THREE.Mesh(sharedGeo, glowMat);
  const coreMesh = new THREE.Mesh(sharedGeo, coreMat);
  glowMesh.frustumCulled = false;
  coreMesh.frustumCulled = false;
  glowMesh.renderOrder = 40;
  coreMesh.renderOrder = 42;
  group.add(glowMesh);
  group.add(coreMesh);
  return {
    alive: false,
    group,
    glowMesh,
    coreMesh,
    glowMat,
    coreMat,
    origin: new THREE.Vector3(),
    target: new THREE.Vector3(),
    side: new THREE.Vector3(1, 0, 0),
    seed: 0,
    age: 0,
    mode: "up",
    endA: new THREE.Vector3(),
    endB: new THREE.Vector3(0, 3, 0),
    length: null,
    spreadMul: 1,
    jitterMul: 1,
    sag: null,
    strands: null,
    tipGlow: null,
    colorCore: null,
    colorInner: null,
    colorOuter: null,
    colorHalo: null,
    colorTip: null,
    still: false,
    glowMul: 1,
  };
}

function applyClusterOpts(c: Cluster, opts?: LightningClusterOpts): void {
  c.length = opts?.length ?? null;
  c.spreadMul = opts?.spreadMul ?? 1;
  c.jitterMul = opts?.jitterMul ?? 1;
  c.sag = opts?.sag ?? null;
  c.strands = opts?.strands ?? null;
  c.tipGlow = opts?.tipGlow ?? null;
  c.colorCore = opts?.colorCore ?? null;
  c.colorInner = opts?.colorInner ?? null;
  c.colorOuter = opts?.colorOuter ?? null;
  c.colorHalo = opts?.colorHalo ?? null;
  c.colorTip = opts?.colorTip ?? null;
  c.still = opts?.still ?? false;
  c.glowMul = opts?.glowMul ?? 1;
}

function clearClusterOpts(c: Cluster): void {
  c.mode = "up";
  c.length = null;
  c.spreadMul = 1;
  c.jitterMul = 1;
  c.sag = null;
  c.strands = null;
  c.tipGlow = null;
  c.colorCore = null;
  c.colorInner = null;
  c.colorOuter = null;
  c.colorHalo = null;
  c.colorTip = null;
  c.still = false;
  c.glowMul = 1;
}

function syncMats(c: Cluster, time: number, glowPass: boolean, mat: THREE.ShaderMaterial): void {
  const s = lightningSettings;
  const u = mat.uniforms;
  u.uTime!.value = time;
  u.uOrigin!.value.copy(c.origin);
  u.uTarget!.value.copy(c.target);
  u.uSide!.value.copy(c.side);
  u.uSeed!.value = c.seed;
  u.uProgress!.value = 1;
  u.uFade!.value = 1;
  const still = c.still;
  u.uStrands!.value = still ? 1 : (c.strands ?? s.strands);
  u.uSag!.value = still ? 0 : (c.sag ?? s.sag);
  u.uRestrike!.value = still ? 0 : s.restrike;
  u.uSpread!.value = still ? 0 : s.spread * c.spreadMul;
  u.uSpreadNear!.value = still ? 0 : s.spreadNear * c.spreadMul;
  u.uSpreadCurve!.value = s.spreadCurve;
  u.uTwist!.value = still ? 0 : s.twist;
  u.uTwistSpeed!.value = still ? 0 : s.twistSpeed;
  u.uBranchDim!.value = s.branchDim;
  u.uJitter!.value = still ? 0 : s.jitter * c.jitterMul;
  u.uJitterScale!.value = s.jitterScale;
  u.uOctaves!.value = s.octaves;
  u.uJitterFalloff!.value = s.jitterFalloff;
  u.uCrawl!.value = still ? 0 : s.crawl;
  u.uPinch!.value = s.pinch;
  u.uConverge!.value = s.converge;
  u.uWidth!.value = s.width;
  u.uWidthTip!.value = s.widthTip;
  u.uWidthCurve!.value = s.widthCurve;
  u.uCoreWidth!.value = s.coreWidth;
  u.uCoreSharp!.value = s.coreSharp;
  u.uGlowFalloff!.value = s.glowFalloff;
  const glowMul = c.glowMul;
  u.uWidthScale!.value = glowPass ? s.glowWidth * glowMul : 1;
  u.uPassOpacity!.value = glowPass ? s.glowOpacity * glowMul : 1;
  u.uFlicker!.value = still ? 0 : s.flicker;
  u.uFlickerSpeed!.value = s.flickerSpeed;
  u.uStrandFlash!.value = still ? 0 : s.strandFlash;
  u.uTipGlow!.value = (c.tipGlow ?? s.tipGlow) * glowMul;
  u.uTipLength!.value = s.tipLength;
  u.uRoundTip!.value = still ? 1 : 0;
  u.uOpacity!.value = 1;
  u.uGlow!.value = s.glow;
  (u.uColorCore!.value as THREE.Color).set(c.colorCore ?? s.colorCore);
  (u.uColorInner!.value as THREE.Color).set(c.colorInner ?? s.colorInner);
  (u.uColorOuter!.value as THREE.Color).set(c.colorOuter ?? s.colorOuter);
  (u.uColorHalo!.value as THREE.Color).set(c.colorHalo ?? s.colorHalo);
  (u.uColorTip!.value as THREE.Color).set(c.colorTip ?? c.colorCore ?? s.colorCore);
}

function syncCluster(c: Cluster, time: number): void {
  // Shader writes world-space positions (viewMatrix, not modelViewMatrix),
  // so origin/target must include the cluster pose — group.position alone
  // would leave the ribbons stuck at 0 while sparks sit on the gallery slot.
  if (c.mode === "segment") {
    c.origin.copy(c.endA);
    c.target.copy(c.endB);
    const dx = c.endB.x - c.endA.x;
    const dz = c.endB.z - c.endA.z;
    // Side in the floor plane so kinks stay mostly horizontal (snare tendril read)
    c.side.set(-dz, 0, dx);
    if (c.side.lengthSq() < 1e-8) c.side.set(1, 0, 0);
    else c.side.normalize();
  } else {
    const len = Math.max(0.35, c.length ?? lightningSettings.length);
    const px = c.group.position.x;
    const py = c.group.position.y;
    const pz = c.group.position.z;
    c.origin.set(px, py + 0.05, pz);
    c.target.set(px, py + len, pz);
    c.side.set(1, 0, 0);
  }
  syncMats(c, time, true, c.glowMat);
  syncMats(c, time, false, c.coreMat);
}

export class LightningArcWorld {
  readonly group = new THREE.Group();
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly clusters: Cluster[] = [];
  private readonly free: number[] = [];
  private disposed = false;
  private time = 0;

  constructor() {
    this.group.name = "VfxLightningArcs";
    this.geo = createBoltRibbonGeometry(NODES, MAX_STRANDS);
    this.geo.instanceCount = Math.min(MAX_STRANDS, lightningSettings.strands);
    for (let i = 0; i < MAX_CLUSTERS; i++) {
      const c = buildCluster(this.geo);
      c.group.visible = false;
      this.clusters.push(c);
      this.group.add(c.group);
      this.free.push(i);
    }
  }

  /** Kept for ParticleWorldView API compatibility — camera is read in the shader. */
  setCamera(_camera: THREE.Camera | null): void {}

  spawnCluster(x: number, y: number, z: number, opts?: LightningClusterOpts): number {
    if (this.disposed) return -1;
    const id = this.free.pop();
    if (id === undefined) return -1;
    const c = this.clusters[id]!;
    c.alive = true;
    c.group.visible = true;
    c.age = 0;
    c.seed = Math.random() * 1000;
    c.mode = "up";
    applyClusterOpts(c, opts);
    // Match particle element height (gallery / focus spawn at ~1.1).
    c.group.position.set(x, y, z);
    this.geo.instanceCount = Math.min(MAX_STRANDS, Math.max(1, Math.round(lightningSettings.strands)));
    syncCluster(c, this.time);
    return id;
  }

  /** Horizontal / arched bolt between two world points (snare ground tendrils). */
  spawnClusterSegment(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    opts?: LightningClusterOpts,
  ): number {
    if (this.disposed) return -1;
    const id = this.free.pop();
    if (id === undefined) return -1;
    const c = this.clusters[id]!;
    c.alive = true;
    c.group.visible = true;
    c.age = 0;
    c.seed = Math.random() * 1000;
    c.mode = "segment";
    applyClusterOpts(c, opts);
    c.endA.set(ax, ay, az);
    c.endB.set(bx, by, bz);
    c.group.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    this.geo.instanceCount = Math.min(MAX_STRANDS, Math.max(1, Math.round(lightningSettings.strands)));
    syncCluster(c, this.time);
    return id;
  }

  moveCluster(id: number, x: number, y: number, z: number): boolean {
    const c = this.clusters[id];
    if (!c?.alive || c.mode !== "up") return false;
    c.group.position.set(x, y, z);
    return true;
  }

  setClusterSegment(
    id: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): boolean {
    const c = this.clusters[id];
    if (!c?.alive || c.mode !== "segment") return false;
    c.endA.set(ax, ay, az);
    c.endB.set(bx, by, bz);
    c.group.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    return true;
  }

  /** Live-tweak knobs on an alive cluster (e.g. ramp strands over a cast). */
  patchCluster(id: number, opts: LightningClusterOpts): boolean {
    const c = this.clusters[id];
    if (!c?.alive) return false;
    if (opts.length !== undefined) c.length = opts.length;
    if (opts.spreadMul !== undefined) c.spreadMul = opts.spreadMul;
    if (opts.jitterMul !== undefined) c.jitterMul = opts.jitterMul;
    if (opts.sag !== undefined) c.sag = opts.sag;
    if (opts.strands !== undefined) c.strands = opts.strands;
    if (opts.tipGlow !== undefined) c.tipGlow = opts.tipGlow;
    if (opts.colorCore !== undefined) c.colorCore = opts.colorCore;
    if (opts.colorInner !== undefined) c.colorInner = opts.colorInner;
    if (opts.colorOuter !== undefined) c.colorOuter = opts.colorOuter;
    if (opts.colorHalo !== undefined) c.colorHalo = opts.colorHalo;
    if (opts.colorTip !== undefined) c.colorTip = opts.colorTip;
    if (opts.still !== undefined) c.still = opts.still;
    if (opts.glowMul !== undefined) c.glowMul = opts.glowMul;
    return true;
  }

  killCluster(id: number): void {
    const c = this.clusters[id];
    if (!c?.alive) return;
    c.alive = false;
    c.group.visible = false;
    clearClusterOpts(c);
    this.free.push(id);
  }

  killAll(): void {
    for (let i = 0; i < this.clusters.length; i++) {
      if (this.clusters[i]!.alive) this.killCluster(i);
    }
  }

  tick(dt: number): void {
    if (this.disposed) return;
    this.time += Math.min(0.05, Math.max(0, dt));
    const strands = Math.min(MAX_STRANDS, Math.max(1, Math.round(lightningSettings.strands)));
    if (this.geo.instanceCount !== strands) this.geo.instanceCount = strands;
    for (const c of this.clusters) {
      if (!c.alive) continue;
      c.age += dt;
      syncCluster(c, this.time);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.killAll();
    for (const c of this.clusters) {
      c.glowMat.dispose();
      c.coreMat.dispose();
    }
    this.geo.dispose();
    this.group.removeFromParent();
  }
}

let bound: LightningArcWorld | null = null;

export function bindLightningArcWorld(world: LightningArcWorld | null): void {
  bound = world;
}

export function getLightningArcWorld(): LightningArcWorld | null {
  return bound;
}

export function spawnLightningCluster(
  x: number,
  y: number,
  z: number,
  opts?: LightningClusterOpts,
): number {
  return bound?.spawnCluster(x, y, z, opts) ?? -1;
}

export function spawnLightningSegment(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  opts?: LightningClusterOpts,
): number {
  return bound?.spawnClusterSegment(ax, ay, az, bx, by, bz, opts) ?? -1;
}

export function moveLightningCluster(id: number, x: number, y: number, z: number): boolean {
  return bound?.moveCluster(id, x, y, z) ?? false;
}

export function setLightningSegment(
  id: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  return bound?.setClusterSegment(id, ax, ay, az, bx, by, bz) ?? false;
}

export function patchLightningCluster(id: number, opts: LightningClusterOpts): boolean {
  return bound?.patchCluster(id, opts) ?? false;
}

export function killLightningCluster(id: number): void {
  bound?.killCluster(id);
}

export function killAllLightningClusters(): void {
  bound?.killAll();
}
