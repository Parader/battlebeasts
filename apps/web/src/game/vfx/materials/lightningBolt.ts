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
 * Style: white core + colored glow, sharp branches (ribbon electricity look).
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
  float segs = 18.0;
  float f = along * segs;
  float i = floor(f);
  float t = fract(f);
  t = t * t * (3.0 - 2.0 * t);
  float a = hash(i + seed + flicker) - 0.5;
  float b = hash(i + 1.0 + seed + flicker) - 0.5;
  return mix(a, b, t) * 0.62;
}

float stroke(vec2 uv, float seed, float flicker, float width) {
  float j = jagAt(uv.x, seed, flicker);
  float d = abs(uv.y - 0.5 - j);
  float tip = smoothstep(0.0, 0.04, uv.x) * smoothstep(1.0, 0.9, uv.x);
  float core = smoothstep(width, 0.0, d);
  float glow = smoothstep(width * 4.5, 0.0, d) * 0.55;
  float halo = smoothstep(width * 8.0, 0.0, d) * 0.22;
  return (core * 1.35 + glow + halo) * tip;
}

void main() {
  float flicker = floor(uTime * 28.0 + uSeed * 3.1);

  float mainBolt = stroke(vUv, uSeed, flicker, 0.022);

  // Mid fork
  vec2 bUv = vUv;
  bUv.y = 0.5 + (vUv.y - 0.5) * 1.55;
  bUv.x = (vUv.x - 0.32) / 0.5;
  float branchMask = step(0.32, vUv.x) * step(vUv.x, 0.82);
  float branch = stroke(bUv, uSeed + 17.0, flicker + 2.0, 0.016) * branchMask * 0.75;

  // Second fork opposite side
  vec2 b2 = vUv;
  b2.y = 0.5 - (vUv.y - 0.5) * 1.35;
  b2.x = (vUv.x - 0.48) / 0.4;
  float branch2Mask = step(0.48, vUv.x) * step(vUv.x, 0.9);
  float branch2 = stroke(b2, uSeed + 41.0, flicker + 5.0, 0.014) * branch2Mask * 0.55;

  float a = mainBolt + branch + branch2;
  float blink = 0.7 + 0.3 * step(0.1, hash(flicker + uSeed));
  a *= blink;

  float hotAmt = clamp(mainBolt * 1.6, 0.0, 1.0);
  vec3 col = mix(uColor, uHot, hotAmt);
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
