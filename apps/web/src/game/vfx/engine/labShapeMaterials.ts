import * as THREE from "three";
import { VFX_PATTERN_URLS, type PatternId } from "../shaders/patternUrls";

const patternCache = new Map<PatternId, THREE.Texture>();

export function getLabPatternTexture(id: PatternId): THREE.Texture {
  let tex = patternCache.get(id);
  if (!tex) {
    tex = new THREE.TextureLoader().load(VFX_PATTERN_URLS[id]);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    patternCache.set(id, tex);
  }
  return tex;
}

/* ─── Energy beam — flowing streaks + lightning jag (not a straight pipe) ─── */

export type LabBeamPass = "core" | "shell" | "halo";

const BEAM_VERT = /* glsl */ `
uniform float uTime;
uniform float uPass;
varying vec2 vUv;
varying float vFacing;
varying float vAlong;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float jag(float along, float seed) {
  float segs = 14.0;
  float f = along * segs;
  float i = floor(f);
  float t = fract(f);
  t = t * t * (3.0 - 2.0 * t);
  float a = hash(i + seed) - 0.5;
  float b = hash(i + 1.0 + seed) - 0.5;
  return mix(a, b, t);
}

void main() {
  vUv = uv;
  vAlong = uv.y;
  // Mild lightning-style wander — ends pinned, mid kinks (AW electric streak feel).
  float ends = sin(clamp(uv.y, 0.0, 1.0) * 3.14159265);
  float flicker = floor(uTime * 18.0);
  float jx = jag(uv.y, 3.1 + flicker * 0.01) * 0.07 * ends;
  float jy = jag(uv.y, 11.7 + flicker * 0.01) * 0.05 * ends;
  vec3 displaced = position + vec3(jx, 0.0, jy) * (uPass < 0.5 ? 0.55 : 1.0);

  vec3 worldN = normalize(mat3(modelMatrix) * normal);
  vec3 viewDir = normalize(cameraPosition - (modelMatrix * vec4(displaced, 1.0)).xyz);
  vFacing = abs(dot(worldN, viewDir));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColorHot;
uniform vec3 uColorMid;
uniform vec3 uColorHalo;
uniform float uOpacity;
uniform float uTime;
uniform float uPass;
varying vec2 vUv;
varying float vFacing;
varying float vAlong;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  float along = vAlong;
  float around = vUv.x;

  // Braided / lattice energy (electric_streaks reference) crawling downrange.
  float flow = along * 7.0 - uTime * 3.6;
  float braidA = abs(sin(around * 22.0 + flow));
  float braidB = abs(sin(around * 22.0 - flow * 1.15 + 1.7));
  float lattice = pow(max(braidA, braidB), 2.4);
  float streak = abs(sin(around * 14.0 + flow + noise(vec2(around * 6.0, flow)) * 2.0));
  streak = pow(smoothstep(0.4, 1.0, streak), 1.6);
  float weave = max(lattice * 0.85, streak);

  float n = noise(vec2(around * 4.0, along * 2.5 - uTime * 1.2));
  float band = 0.6 + 0.4 * sin((along * 3.5 - uTime * 2.2) * 6.2831853 + n);

  vec3 col;
  float alpha;
  if (uPass < 0.5) {
    float axis = pow(vFacing, 1.5);
    col = mix(uColorMid, uColorHot, axis * 0.75 + weave * 0.45);
    alpha = (0.4 + axis * 0.4) * (0.55 + weave * 0.45) * band;
  } else if (uPass < 1.5) {
    float rim = pow(1.0 - vFacing, 1.7);
    col = mix(uColorMid * 0.45, uColorHot, rim * 0.55 + weave * 0.55);
    alpha = (0.12 + rim * 0.45 + weave * 0.4) * band;
  } else {
    float rim = pow(1.0 - vFacing, 2.2);
    col = mix(uColorHalo * 0.35, uColorMid, rim + weave * 0.2);
    alpha = (0.05 + rim * 0.18 + weave * 0.1) * band;
  }

  alpha *= uOpacity;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

export function createLabBeamMaterial(
  pass: LabBeamPass,
  colors: { hot: string; mid: string; halo?: string },
): THREE.ShaderMaterial {
  const passId = pass === "core" ? 0 : pass === "shell" ? 1 : 2;
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorHot: { value: new THREE.Color(colors.hot) },
      uColorMid: { value: new THREE.Color(colors.mid) },
      uColorHalo: { value: new THREE.Color(colors.halo ?? colors.mid) },
      uOpacity: { value: pass === "core" ? 0.88 : pass === "shell" ? 0.62 : 0.38 },
      uTime: { value: 0 },
      uPass: { value: passId },
    },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function tickLabBeamMaterial(mat: THREE.ShaderMaterial, dt: number): void {
  mat.uniforms.uTime!.value += dt;
}

/* ─── AW oval shield — fresnel ellipsoid (armor_shield.vis scale) ─── */

const OVAL_VERT = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vViewDir;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const OVAL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uOpacity;
uniform float uTime;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

float hash11(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(vViewDir);
  float ndv = max(dot(N, V), 0.0);
  // Soft rim + faint outer bloom (emanation past the hard shell)
  float rim = pow(1.0 - ndv, 3.2);
  float bloom = pow(1.0 - ndv, 1.55) * 0.28;
  float edge = max(rim, bloom);
  if (edge < 0.04) discard;

  // Spherical energy crawl — hex-ish bands that drift
  float lat = asin(clamp(N.y, -1.0, 1.0));
  float lon = atan(N.z, N.x);
  float bands = abs(sin(lat * 14.0 + uTime * 2.2)) * abs(sin(lon * 10.0 - uTime * 1.6));
  bands = pow(smoothstep(0.55, 1.0, bands), 1.4);
  float spark = step(0.92, hash11(floor(lon * 18.0 + uTime * 6.0) + floor(lat * 12.0))) * rim;

  float breath = 0.88 + 0.12 * sin(uTime * 2.1);
  float shimmer = 0.85 + 0.15 * sin(lon * 6.0 + uTime * 3.5);
  float a = (smoothstep(0.08, 0.62, rim) * (0.42 + bands * 0.35 + spark * 0.4) + bloom * 0.55)
    * breath * shimmer * uOpacity;
  vec3 col = mix(uColor * 0.5, uHot, smoothstep(0.15, 0.95, rim) * 0.7 + bands * 0.45 + spark);
  col = mix(col, uColor * 0.9, bloom * 0.7);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`;

export function createLabOvalShieldMaterial(color: string, hot: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uHot: { value: new THREE.Color(hot) },
      uOpacity: { value: 0.55 },
      uTime: { value: 0 },
    },
    vertexShader: OVAL_VERT,
    fragmentShader: OVAL_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // Draw over the character so the oval rim isn't buried behind them.
    depthTest: false,
    // Front only — back faces were reading as a shell "behind" the body.
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

export function tickLabOvalShield(mat: THREE.ShaderMaterial, dt: number): void {
  mat.uniforms.uTime!.value += dt;
}

/** Soft camera-facing shield oval — readable from top-down (fresnel spheres vanish). */
const SHIELD_BILLBOARD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHIELD_BILLBOARD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // Oval biased slightly long — foot coverage comes from mesh offset down.
  // UV domain is larger than the soft halo (~1.32) so fade reaches 0 before the quad edge.
  vec2 p = (vUv * 2.0 - 1.0) * vec2(1.4, 1.15);
  p.y += 0.08; // shift silhouette toward feet side of the billboard
  float d = length(p);
  float ang = atan(p.y, p.x);
  // Empty center — hard hollow
  if (d < 0.38) discard;

  // Dual counter-rotating energy rings
  float r0 = 0.68 + 0.02 * sin(ang * 3.0 + uTime * 2.4);
  float r1 = 0.78 + 0.015 * sin(ang * 5.0 - uTime * 1.8);
  float ringA = smoothstep(0.045, 0.0, abs(d - r0));
  float ringB = smoothstep(0.038, 0.0, abs(d - r1));
  float wall = smoothstep(0.98, 0.52, d) * smoothstep(0.36, 0.66, d);

  // Flowing runes / ticks racing along the rim
  float flow = ang * 10.0 - uTime * 3.2;
  float ticks = smoothstep(0.82, 1.0, abs(sin(flow))) * ringA;
  float ticks2 = smoothstep(0.88, 1.0, abs(sin(ang * 14.0 + uTime * 4.5))) * ringB * 0.55;

  // Soft thickness shimmer (breaks the flat stamp look)
  float noise = hash21(floor(p * 28.0 + vec2(uTime * 1.5, -uTime)));
  float shimmer = 0.75 + 0.25 * noise;

  // Occasional spark flashes on the rim
  float spark = step(0.97, hash21(vec2(floor(ang * 16.0 + uTime * 8.0), floor(uTime * 5.0)))) * ringA;

  // Outer emanation past the hard rim
  float outerGlow = smoothstep(1.28, 0.88, d) * smoothstep(0.62, 0.92, d);
  outerGlow *= 0.85 + 0.15 * sin(ang * 4.0 + uTime * 1.6);

  float breath = 0.9 + 0.1 * sin(uTime * 2.0);
  float a = (ringA * 0.85 + ringB * 0.55 + wall * 0.22 + ticks * 0.55 + ticks2 + spark * 0.7 + outerGlow * 0.42)
    * breath * shimmer * uOpacity;
  a *= smoothstep(1.32, 0.9, d);
  if (a < 0.012) discard;
  vec3 col = mix(uColor * 0.55, uHot, ringA * 0.7 + ticks * 0.5 + spark);
  col = mix(col, uHot * 1.1, ringB * 0.35);
  col = mix(col, uColor * 0.85, outerGlow * 0.65);
  gl_FragColor = vec4(col, a);
}
`;

export function createLabShieldBillboardMaterial(color: string, hot: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uHot: { value: new THREE.Color(hot) },
      uOpacity: { value: 0.75 },
      uTime: { value: 0 },
    },
    vertexShader: SHIELD_BILLBOARD_VERT,
    fragmentShader: SHIELD_BILLBOARD_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function tickLabShieldBillboard(mat: THREE.ShaderMaterial, dt: number): void {
  mat.uniforms.uTime!.value += dt;
}

/** Soft aura disc for holy feet — oval in UV, fading rim (dot_aura style). */
const AURA_DISC_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;

void main() {
  // Oval stretch — AW neat oval silhouette
  vec2 p = (vUv * 2.0 - 1.0) * vec2(1.0, 1.28);
  float d = length(p);
  float ring = smoothstep(0.07, 0.0, abs(d - 0.78));
  float outer = smoothstep(1.05, 0.72, d) * smoothstep(0.35, 0.78, d);
  float coreHollow = 1.0 - smoothstep(0.0, 0.55, d);
  float a = (ring * 0.95 + outer * 0.35 - coreHollow * 0.2);
  a = max(a, 0.0) * (0.9 + 0.1 * sin(uTime * 2.0)) * uOpacity;
  vec3 col = mix(uColor, uHot, ring);
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}
`;

const AURA_DISC_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export function createLabAuraDiscMaterial(color: string, hot: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uHot: { value: new THREE.Color(hot) },
      uOpacity: { value: 0.8 },
      uTime: { value: 0 },
    },
    vertexShader: AURA_DISC_VERT,
    fragmentShader: AURA_DISC_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function tickLabAuraDisc(mat: THREE.ShaderMaterial, dt: number): void {
  mat.uniforms.uTime!.value += dt;
}

/* ─── Ground marks ─── */

export type LabGroundMode =
  | "cracks"
  | "frost"
  | "spiral"
  | "sigil"
  | "poison"
  | "scorch"
  | "void"
  | "arc"
  | "wind";

const GROUND_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GROUND_FRAG = /* glsl */ `
uniform vec3 uColorHot;
uniform vec3 uColorMid;
uniform vec3 uColorEdge;
uniform float uOpacity;
uniform float uTime;
uniform float uMode;
uniform sampler2D uMap;
uniform float uHasMap;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.05;
    a *= 0.5;
  }
  return v;
}
/** Cheap 2D voronoi — x = dist, y = cell id (elemental sandbox GroundDecals). */
vec2 voronoi2(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float minDist = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash(n + g), hash(n + g + 19.7));
      vec2 r = g + o - f;
      float dd = dot(r, r);
      if (dd < minDist) { minDist = dd; id = hash(n + g + 31.7); }
    }
  }
  return vec2(sqrt(minDist), id);
}
/**
 * Settled snow height ~0..1 — drifts + voronoi slabs + fine grain.
 * Ported from elemental sandbox GroundDecals FROST (MIT).
 */
float snowDepth(vec2 q, float seed, float sharpness) {
  float drift = fbm(q * 0.85 + seed) * 0.5 + 0.5;
  vec2 cell = voronoi2(q * (1.4 + sharpness * 0.9) + seed * 7.0);
  float slabs = smoothstep(0.0, 0.55, cell.x) * 0.30 + cell.y * 0.12;
  float grain = noise(q * (7.0 + sharpness * 5.0) + seed * 3.0) * 0.15;
  return drift * 0.60 + slabs + grain;
}
float ring(float d, float r, float w) {
  return smoothstep(w, 0.0, abs(d - r));
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  float ang = atan(p.y, p.x);
  float a = 0.0;
  vec3 col = uColorMid;

  if (uMode < 0.5) {
    // CRACKS
    float pat = uHasMap > 0.5 ? texture2D(uMap, vUv * 1.35).r : noise(p * 5.0);
    float radial = pow(smoothstep(0.55, 1.0, abs(sin(ang * 5.0 + fbm(p * 2.0) * 3.0))), 2.4);
    radial *= smoothstep(0.12, 0.85, d);
    float fissure = pow(pat, 1.7) * 0.9 + radial * 0.55;
    float mask = smoothstep(1.0, 0.78, d);
    col = mix(uColorEdge, mix(uColorMid, uColorHot, fissure), fissure);
    a = fissure * mask;
  } else if (uMode < 1.5) {
    // FROST — elemental sandbox GroundDecals FROST: shaded powder, not flat paint
    float seed = 3.7;
    float sharp = 1.5;
    // Sample slightly tighter so footprint matches other marks
    vec2 q = p * 2.05;
    vec2 warp = vec2(fbm(q * 0.55 + seed), fbm(q * 0.55 + seed + 5.7)) * 0.4;
    float lobes = fbm(q * 0.8 + warp + seed + 13.0);
    float reach = d * (1.0 - lobes * 0.28);
    float cover = smoothstep(0.92, 0.4, reach);
    if (cover < 0.004) discard;

    float e = 0.08;
    float h  = snowDepth(q, seed, sharp);
    float hx = snowDepth(q + vec2(e, 0.0), seed, sharp);
    float hy = snowDepth(q + vec2(0.0, e), seed, sharp);
    // Shallow bump — steep fake normals read as gravel
    vec3 nrm = normalize(vec3((h - hx) / e * 0.30, 1.0, (h - hy) / e * 0.30));
    vec3 lightDir = normalize(vec3(0.35, 0.85, 0.4));
    float lambert = clamp(dot(nrm, lightDir), 0.0, 1.0);
    // Snow scatters deep — shadows go blue, never black
    float shade = 0.36 + 0.64 * pow(lambert, 0.8);

    float lie = smoothstep(0.10, 0.52, cover * (0.34 + 0.78 * h));
    // Lit face → white; own-shadow → cool edge (sandbox colorFrost / colorFrostEdge)
    col = mix(uColorEdge * 0.55, mix(uColorMid, uColorHot, 0.45), shade);

    // Soft glints (no floor()-snap — that read as staggered pops)
    float glint = smoothstep(0.88, 1.0, noise(q * 9.0 + uTime * 0.55 + seed));
    col += glint * pow(lambert, 2.0) * 0.4 * uColorHot;

    float lip = smoothstep(0.10, 0.0, abs(reach - 0.72)) * 0.55;
    col = mix(col, mix(uColorEdge, uColorHot, 0.6), lip);
    // Match other ground footprints — frost was reading wider from lobe reach
    float edge = smoothstep(1.0, 0.82, d);
    a = clamp(lie * 0.95 + lip * cover * 0.25, 0.0, 1.0) * edge;
  } else if (uMode < 2.5) {
    // HEAL wash — soft verdant mist only; leaves come from particles
    float mask = smoothstep(1.0, 0.7, d);
    float wash = smoothstep(0.92, 0.1, d) * (0.4 + 0.35 * fbm(p * 2.0));
    float glint = pow(noise(p * 8.0), 6.0) * wash * 0.25;
    a = (wash * 0.5 + glint) * mask;
    col = mix(uColorEdge, mix(uColorMid, uColorHot, glint), wash);
  } else if (uMode < 3.5) {
    // SIGIL
    float spin = ang + uTime * 0.28;
    a += ring(d, 0.88, 0.022);
    a += ring(d, 0.62, 0.018);
    a += ring(d, 0.36, 0.02);
    float spokes = smoothstep(0.9, 1.0, abs(sin(spin * 8.0)));
    a += spokes * (1.0 - smoothstep(0.15, 0.9, d)) * 0.5;
    float ticks = smoothstep(0.92, 1.0, abs(sin(ang * 24.0))) * ring(d, 0.75, 0.035);
    a += ticks * 0.65;
    col = mix(uColorMid, uColorHot, a);
    a *= smoothstep(1.0, 0.8, d);
  } else if (uMode < 4.5) {
    // POISON — morphing blot (domain blend), not translating scroll
    float nA = fbm(p * 2.3);
    float nB = fbm(p * 2.3 + 17.3);
    float morph = 0.5 + 0.5 * sin(uTime * 0.7);
    float blot = mix(nA, nB, morph);
    // Soft bubble breathe — no floor() pops
    float bub = pow(noise(p * 8.5), 3.5) * (0.55 + 0.45 * sin(uTime * 2.2 + blot * 6.0));
    float cover = smoothstep(0.95, 0.22, d * (1.0 - blot * 0.32));
    float rim = ring(d, 0.82, 0.1) * (0.4 + 0.6 * blot);
    a = cover * (0.5 + blot * 0.4) + bub * cover * 0.4 + rim * 0.3;
    col = mix(uColorEdge, mix(uColorMid, uColorHot, bub), blot);
    a *= smoothstep(1.0, 0.75, d);
  } else if (uMode < 5.5) {
    // SCORCH — burnt blot that fills most of the footprint (was too center-faded)
    float pat = uHasMap > 0.5 ? texture2D(uMap, vUv * 1.25).r : noise(p * 4.0);
    float blot = smoothstep(0.08, 0.85, (1.15 - d * 0.95) * (0.55 + pat * 0.7));
    float ember = pow(noise(p * 9.0 + uTime * 0.4), 3.5) * blot;
    float rimChar = ring(d, 0.88, 0.14) * (0.35 + 0.65 * pat);
    col = mix(uColorEdge, mix(uColorMid, uColorHot, ember), blot);
    col = mix(col, uColorHot * 0.7, rimChar * 0.35);
    a = (blot * 1.1 + ember * 0.55 + rimChar * 0.25) * smoothstep(1.0, 0.88, d);
  } else if (uMode < 6.5) {
    // VOID — dark well: dense core + purple mid mist + edge filaments
    float mask = smoothstep(1.0, 0.78, d);
    float well = pow(smoothstep(0.85, 0.0, d), 0.65);
    float core = pow(smoothstep(0.5, 0.0, d), 1.1);
    float warp = fbm(p * 2.4 + 9.0);
    float fil = fbm(p * 4.5 + warp);
    float veins = smoothstep(0.5, 0.82, fil) * (1.0 - smoothstep(0.88, 0.98, fil));

    // Mid-band haze — bridges empty ring between core and rim
    float midBand = smoothstep(0.42, 0.58, d) * smoothstep(0.78, 0.55, d);
    float midSwirl = fbm(p * 2.6 + vec2(ang * 0.2 + uTime * 0.08, warp));
    float midMist = midBand * (0.45 + 0.55 * midSwirl);
    float midVeins = midBand * smoothstep(0.42, 0.78, fbm(p * 3.8 + warp * 1.5));

    // Core swirl
    float swirl = fbm(p * 3.2 + vec2(ang * 0.15, 0.0));
    float coreFil = smoothstep(0.4, 0.75, swirl) * core;
    veins = max(veins * smoothstep(0.08, 0.7, d), max(coreFil, midVeins));

    float rim = ring(d, 0.82, 0.07) * (0.5 + 0.5 * warp);
    col = mix(uColorEdge * 0.15, uColorMid, well * 0.5 + midMist * 0.7 + veins * 0.85 + rim * 0.45);
    col = mix(col, uColorHot * 0.65, core * 0.5 + midMist * 0.25 + rim * 0.3);
    a = (well * 0.75 + core * 0.55 + midMist * 0.55 + veins * 0.55 + rim * 0.4) * mask;
  } else if (uMode < 7.5) {
    // LIGHTNING — snare burnt wash + ground-level forks (no white ring / core pool)
    float radius = 0.94;
    float interior = smoothstep(radius + 0.02, radius - 0.08, d);
    float radial = clamp(d / max(radius, 0.001), 0.0, 1.0);
    // Soft perimeter falloff — keep energy in the disc, dissolve at the rim
    float edgeFade = smoothstep(1.0, 0.52, d);

    // Veins burnt across the disc — plane-sampled ridged (sandbox snare field)
    float warp = fbm(p * 0.55 + uTime * 0.2) * 0.55;
    vec2 rq = p * 2.0 + warp;
    float ridged = 0.0;
    float ra = 0.5;
    for (int k = 0; k < 4; k++) {
      ridged += ra * (1.0 - abs(noise(rq) * 2.0 - 1.0));
      rq *= 2.06;
      ra *= 0.5;
    }
    float veins = smoothstep(0.58, 0.96, ridged) * interior;

    // Soft mid wash (not rim-crowded) so the perimeter can fade cleanly
    float wash = interior * (1.0 - pow(radial, 1.6)) * 0.45;
    float body = wash + veins * 1.4;

    // Ground-level jagged forks (tendril read) — restrike in plane
    float flicker = floor(uTime * 8.0);
    float bolts = 0.0;
    for (float i = 0.0; i < 3.0; i++) {
      float seed = i * 17.3 + flicker * 0.19;
      float a0 = hash(vec2(seed, 2.7)) * 6.2831853;
      float along = d;
      float segs = 10.0;
      float f = along * segs;
      float si = floor(f);
      float st = fract(f);
      st = st * st * (3.0 - 2.0 * st);
      float j0 = hash(vec2(si + seed, 1.0)) - 0.5;
      float j1 = hash(vec2(si + 1.0 + seed, 1.0)) - 0.5;
      float jag = mix(j0, j1, st) * 0.5;
      float angOff = a0 + jag;
      float da = abs(atan(sin(ang - angOff), cos(ang - angOff)));
      float w = 0.018 + 0.008 * hash(vec2(seed, along));
      float stroke = smoothstep(w, 0.0, da);
      float forkT = 0.3 + 0.25 * hash(vec2(seed, 8.0));
      float forkMask = smoothstep(forkT - 0.04, forkT, along) * smoothstep(0.72, 0.45, along);
      float a1 = a0 + (hash(vec2(seed, 5.0)) - 0.5) * 1.1;
      float da2 = abs(atan(sin(ang - a1), cos(ang - a1)));
      float branch = smoothstep(w * 0.9, 0.0, da2) * forkMask * 0.65;
      float tip = smoothstep(0.08, 0.22, along) * smoothstep(0.7, 0.4, along);
      bolts += (stroke + branch) * tip;
    }
    float blink = 0.7 + 0.3 * step(0.2, hash(vec2(flicker, 3.1)));
    float boltA = clamp(bolts, 0.0, 1.0) * blink * interior;

    col = mix(uColorEdge * 0.3, uColorMid, clamp(body, 0.0, 1.0));
    col = mix(col, uColorHot, boltA * 0.55 + veins * 0.2);
    a = max(body * 0.7, boltA * 0.85) * edgeFade;
  } else {
    // WIND — radial gust ribbons + soft expanding dust rings
    float mask = smoothstep(1.0, 0.72, d) * smoothstep(0.04, 0.22, d);

    // Curved ribbons racing center → rim
    float swirl = fbm(vec2(ang * 1.8, d * 2.2));
    float twist = d * 2.2 - uTime * 0.7;
    float blades = abs(sin(ang * 5.0 + swirl * 2.4 + twist * 0.35));
    blades = pow(smoothstep(0.52, 1.0, blades), 2.1);
    float pulse = 0.55 + 0.45 * sin((d * 3.5 - uTime * 1.1) * 6.2831853);
    float ribbon = blades * pulse * smoothstep(0.06, 0.3, d);

    // Soft dust rings drifting outward
    float phase = fract(uTime * 0.28);
    float dust = smoothstep(0.09, 0.0, abs(d - phase * 0.92)) * (1.0 - phase);
    float phase2 = fract(phase + 0.5);
    dust += smoothstep(0.08, 0.0, abs(d - phase2 * 0.92)) * (1.0 - phase2) * 0.65;

    // Thin haze between gusts
    float haze = fbm(p * 2.8 + vec2(uTime * 0.12, -uTime * 0.08)) * 0.18;

    a = (ribbon * 0.8 + dust * 0.5 + haze) * mask;
    col = mix(uColorEdge, uColorMid, ribbon * 0.75 + dust * 0.35);
    col = mix(col, uColorHot, ribbon * pulse * 0.35);
  }

  a *= uOpacity;
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

const MODE_ID: Record<LabGroundMode, number> = {
  cracks: 0,
  frost: 1,
  spiral: 2,
  sigil: 3,
  poison: 4,
  scorch: 5,
  void: 6,
  arc: 7,
  wind: 8,
};

export function createLabGroundMarkMaterial(
  mode: LabGroundMode,
  colors: { hot: string; mid: string; edge: string },
  opts?: { pattern?: PatternId; opacity?: number; additive?: boolean },
): THREE.ShaderMaterial {
  const map = opts?.pattern ? getLabPatternTexture(opts.pattern) : null;
  const additive = opts?.additive ?? (mode !== "frost" && mode !== "void");
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorHot: { value: new THREE.Color(colors.hot) },
      uColorMid: { value: new THREE.Color(colors.mid) },
      uColorEdge: { value: new THREE.Color(colors.edge) },
      uOpacity: { value: opts?.opacity ?? (mode === "wind" ? 0.4 : mode === "frost" ? 0.9 : 0.92) },
      uTime: { value: 0 },
      uMode: { value: MODE_ID[mode] },
      uMap: { value: map },
      uHasMap: { value: map ? 1 : 0 },
    },
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
    transparent: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function tickLabGroundMark(mat: THREE.ShaderMaterial, dt: number): void {
  mat.uniforms.uTime!.value += dt;
}

/* ─── Soft charge orb (half-sphere friendly, low opacity) ─── */

const ORB_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vViewDir;
varying vec3 vObj;
void main() {
  vObj = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const ORB_FRAG = /* glsl */ `
uniform vec3 uColorHot;
uniform vec3 uColorMid;
uniform float uOpacity;
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying vec3 vObj;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

void main() {
  float fres = pow(1.0 - max(dot(normalize(vNormalW), normalize(vViewDir)), 0.0), 2.4);
  float turb = noise(vObj * 3.8 + vec3(0.0, uTime * 1.4, uTime * 0.55));
  float bands = pow(abs(sin(vObj.y * 8.0 + turb * 2.5 - uTime * 3.0)), 2.8);
  // Soft shell — hollowish charge, not a bright marble
  float a = (fres * 0.7 + bands * 0.25 + turb * 0.12) * uOpacity;
  vec3 col = mix(uColorMid, uColorHot, fres * 0.6 + bands * 0.3);
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}
`;

export function createLabChargeOrbMaterial(hot: string, mid: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorHot: { value: new THREE.Color(hot) },
      uColorMid: { value: new THREE.Color(mid) },
      uOpacity: { value: 0.45 },
      uTime: { value: 0 },
    },
    vertexShader: ORB_VERT,
    fragmentShader: ORB_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function tickLabChargeOrb(mat: THREE.ShaderMaterial, dt: number): void {
  mat.uniforms.uTime!.value += dt;
}

/* ─── AW melee slash — crescent swipe on a flat disc (slash01 flat_sphere recipe) ─── */

const SLASH_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SLASH_FRAG = /* glsl */ `
uniform vec3 uColorHot;
uniform vec3 uColorMid;
uniform vec3 uColorEdge;
uniform float uOpacity;
uniform float uProgress; // 0..1 wipe along the arc
uniform float uTime;
varying vec2 vUv;

void main() {
  // Map UV to disc; crescent lives in a band of radius
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  float ang = atan(p.y, p.x); // -PI..PI

  // Arc window — ~half-circle slash (like AW oval mask on flat sphere)
  float arcStart = -1.15;
  float arcEnd = 1.35;
  float arcLen = arcEnd - arcStart;
  float along = clamp((ang - arcStart) / arcLen, 0.0, 1.0);

  // Soft radial band (crescent thickness)
  float r0 = 0.52;
  float r1 = 0.88;
  float band = smoothstep(r0 - 0.08, r0 + 0.02, d) * smoothstep(r1 + 0.06, r1 - 0.02, d);

  // Tips taper
  float tip = smoothstep(0.0, 0.12, along) * smoothstep(1.0, 0.82, along);

  // Progress wipe — leading edge of the swipe
  float head = uProgress;
  float trail = 0.28;
  float wipe = smoothstep(head - trail, head - 0.02, along) * (1.0 - smoothstep(head, head + 0.08, along));
  // Soft body behind the head while the slash is mid-flight
  float body = smoothstep(head - 0.55, head - 0.08, along) * step(along, head + 0.02);
  float drawn = max(wipe * 1.15, body * 0.55);

  // Flow streaks along the blade (AW flow tile feel)
  float flow = abs(sin(along * 28.0 - uTime * 14.0 + d * 6.0));
  flow = pow(smoothstep(0.35, 1.0, flow), 1.8);

  float a = band * tip * drawn * (0.55 + flow * 0.55) * uOpacity;
  if (a < 0.02) discard;

  vec3 col = mix(uColorEdge, uColorMid, band * 0.7 + flow * 0.4);
  col = mix(col, uColorHot, wipe * 0.85 + flow * 0.25);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

export function createLabMeleeSlashMaterial(
  hot: string,
  mid: string,
  edge: string,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorHot: { value: new THREE.Color(hot) },
      uColorMid: { value: new THREE.Color(mid) },
      uColorEdge: { value: new THREE.Color(edge) },
      uOpacity: { value: 0.95 },
      uProgress: { value: 0.5 },
      uTime: { value: 0 },
    },
    vertexShader: SLASH_VERT,
    fragmentShader: SLASH_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function tickLabMeleeSlash(mat: THREE.ShaderMaterial, dt: number, progress01: number): void {
  mat.uniforms.uTime!.value += dt;
  mat.uniforms.uProgress!.value = THREE.MathUtils.clamp(progress01, 0, 1);
}

// Back-compat aliases used by older call sites
export const createLabShieldHaloMaterial = createLabAuraDiscMaterial;
export const tickLabShieldHalo = tickLabAuraDisc;
