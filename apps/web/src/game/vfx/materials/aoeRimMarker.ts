import * as THREE from "three";

/**
 * Soft AoE ground marker — bright energetic rim + faint center wash.
 * Tint with `uColor` / `uHot` for fire, ice, poison, etc.
 * `uShape`: 0 = circle, 1 = capsule (stadium / corridor).
 */
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uOpacity;
uniform float uFill;
uniform float uRimWidth;
uniform float uGlowWidth;
uniform float uTime;
uniform float uNoise;
uniform float uShape;
/** Capsule: half-length / half-width (plane local). Circle unused. */
uniform float uAspect;
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
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = p * 2.15 + 11.3;
    a *= 0.5;
  }
  return v;
}

/** Signed distance: <0 inside, 0 on rim. Circle unit disc or stadium. */
float rimDistance(vec2 p) {
  if (uShape < 0.5) {
    return length(p) - 1.0;
  }
  // Capsule in local space: half-width = 1, half-length = uAspect.
  float h = max(0.0, uAspect - 1.0);
  vec2 q = vec2(p.x - clamp(p.x, -h, h), p.y);
  return length(q) - 1.0;
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  if (uShape > 0.5) {
    p.x *= uAspect;
  }

  float d = rimDistance(p);
  float n = fbm(vec2(p.x * 0.55 + uTime * 0.5, p.y * 2.2 - uTime * 0.25));
  float n2 = fbm(vec2(p.x * 1.1 - uTime * 0.35, p.y * 3.4));
  // Keep edge warp tiny so the bright core stays on the true hit rim.
  d -= (n - 0.5) * uNoise * 0.012;

  float soft = max(0.01, uRimWidth);
  float glowSoft = max(soft * 2.0, uGlowWidth);
  // Outside discard — only a thin halo past the hit edge.
  if (d > glowSoft * 0.55) discard;

  float rimCore = 1.0 - smoothstep(0.0, soft, abs(d));
  // Glow mostly inward so the marker doesn't read larger than the hitbox.
  float glowIn = 1.0 - smoothstep(0.0, glowSoft, max(0.0, -d));
  float glowOut = 1.0 - smoothstep(0.0, glowSoft * 0.35, max(0.0, d));
  float rimGlow = max(glowIn * 0.9, glowOut * 0.35);
  rimCore *= 0.82 + 0.18 * n2;
  rimGlow *= 0.88 + 0.12 * n;

  // Soft wash inside: stronger near rim, faint toward center.
  float inside = 1.0 - smoothstep(-0.02, 0.02, d);
  float fromEdge = smoothstep(-1.05, -0.08, d);
  float fill = inside * fromEdge * uFill;
  fill = pow(max(fill, 0.0), 1.25);

  float core = pow(rimCore, 1.45);
  float glow = pow(rimGlow, 1.1);
  // Softer outline — hit edge stays readable without dominating the ground.
  float alpha = (glow * 0.22 + core * 0.58 + fill) * uOpacity;
  if (alpha < 0.01) discard;

  vec3 col = mix(uColor, uHot, core * 0.7 + glow * 0.12);
  col = mix(col, uColor * 0.5, fill * (1.0 - core));
  gl_FragColor = vec4(col, alpha);
}
`;

export type AoeRimShape = "circle" | "capsule";

export type AoeRimMarkerMaterialOpts = {
  color?: string;
  /** Bright rim core (defaults to a lighter mix of color). */
  hotColor?: string;
  /** Soft interior wash strength (0..1). */
  fill?: number;
  rimWidth?: number;
  glowWidth?: number;
  /** Rim edge waviness (0 = perfect edge). */
  noise?: number;
  shape?: AoeRimShape;
  /**
   * Capsule only: total length / width (half-length / half-width in plane space).
   * Circle ignores this.
   */
  aspect?: number;
};

export function createAoeRimMarkerMaterial(
  opts: AoeRimMarkerMaterialOpts = {},
): THREE.ShaderMaterial {
  const color = new THREE.Color(opts.color ?? "#f97316");
  const hot = opts.hotColor
    ? new THREE.Color(opts.hotColor)
    : color.clone().lerp(new THREE.Color("#fff7ed"), 0.65);
  const shape = opts.shape === "capsule" ? 1 : 0;
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uHot: { value: hot },
      uOpacity: { value: 1 },
      uFill: { value: opts.fill ?? 0.12 },
      uRimWidth: { value: opts.rimWidth ?? 0.02 },
      uGlowWidth: { value: opts.glowWidth ?? 0.07 },
      uTime: { value: 0 },
      uNoise: { value: opts.noise ?? 0.3 },
      uShape: { value: shape },
      uAspect: { value: Math.max(1, opts.aspect ?? 1) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function tintAoeRimMarkerMaterial(
  mat: THREE.ShaderMaterial,
  color: string,
  hotColor?: string,
): void {
  const c = new THREE.Color(color);
  (mat.uniforms.uColor!.value as THREE.Color).copy(c);
  const hot = hotColor
    ? new THREE.Color(hotColor)
    : c.clone().lerp(new THREE.Color("#fff7ed"), 0.65);
  (mat.uniforms.uHot!.value as THREE.Color).copy(hot);
}

export function setAoeRimMarkerAspect(mat: THREE.ShaderMaterial, aspect: number): void {
  mat.uniforms.uAspect!.value = Math.max(1, aspect);
}

export function tickAoeRimMarkerMaterial(mat: THREE.ShaderMaterial, dt: number): void {
  mat.uniforms.uTime!.value += dt;
}

export function setAoeRimMarkerOpacity(mat: THREE.ShaderMaterial, opacity: number): void {
  mat.uniforms.uOpacity!.value = opacity;
}
