import * as THREE from "three";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Tiny procedural lightning bolt on a wide thin quad.
 * UV.x = along the stroke, UV.y = across. Flickers by reseeding jagged offsets.
 */
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uOpacity;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

/** Jagged centerline offset in UV.y space (−0.5..0.5). */
float jagAt(float along, float seed, float flicker) {
  float segs = 14.0;
  float f = along * segs;
  float i = floor(f);
  float t = fract(f);
  t = t * t * (3.0 - 2.0 * t);
  float a = hash(i + seed + flicker) - 0.5;
  float b = hash(i + 1.0 + seed + flicker) - 0.5;
  return mix(a, b, t) * 0.55;
}

float stroke(vec2 uv, float seed, float flicker, float width) {
  float j = jagAt(uv.x, seed, flicker);
  float d = abs(uv.y - 0.5 - j);
  float tip = smoothstep(0.0, 0.06, uv.x) * smoothstep(1.0, 0.88, uv.x);
  float core = smoothstep(width, 0.0, d);
  float glow = smoothstep(width * 3.2, 0.0, d) * 0.4;
  return (core + glow) * tip;
}

void main() {
  // Discrete flicker buckets so the bolt snaps to new shapes.
  float flicker = floor(uTime * 22.0 + uSeed * 3.1);

  float mainBolt = stroke(vUv, uSeed, flicker, 0.028);

  // Short side branch mid-bolt
  vec2 bUv = vUv;
  bUv.y = 0.5 + (vUv.y - 0.5) * 1.4;
  bUv.x = (vUv.x - 0.35) / 0.45;
  float branchMask = step(0.35, vUv.x) * step(vUv.x, 0.8);
  float branch = stroke(bUv, uSeed + 17.0, flicker + 2.0, 0.02) * branchMask * 0.7;

  float a = mainBolt + branch;
  // Occasional full-bolt blink
  float blink = 0.65 + 0.35 * step(0.12, hash(flicker + uSeed));
  a *= blink;

  vec3 col = mix(uColor, uHot, clamp(mainBolt * 1.4, 0.0, 1.0));
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

export function createLightningBoltMaterial(
  color: string,
  opts?: { hot?: string; opacity?: number; seed?: number },
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uHot: { value: new THREE.Color(opts?.hot ?? "#fef9c3") },
      uOpacity: { value: opts?.opacity ?? 0.95 },
      uTime: { value: 0 },
      uSeed: { value: opts?.seed ?? Math.random() * 100 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function tickLightningBolt(mat: THREE.ShaderMaterial, dt: number): void {
  mat.uniforms.uTime!.value += dt;
}
