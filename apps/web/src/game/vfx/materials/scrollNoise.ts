import * as THREE from "three";

/** Tiny procedural hash noise — no texture asset required. */
const NOISE_GLSL = /* glsl */ `
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
`;

const SCROLL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SCROLL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform vec2 uScroll;
uniform float uScale;
uniform float uContrast;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 uv = vUv * uScale + uScroll * uTime;
  float n = noise(uv);
  n = pow(n, uContrast);
  gl_FragColor = vec4(uColor * n, n * uOpacity);
}
`;

/** Animated UV noise field — energy sheets, portals, charge swirls. */
export function createScrollNoiseMaterial(
  color: string,
  opts?: {
    opacity?: number;
    scroll?: [number, number];
    scale?: number;
    contrast?: number;
  },
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opts?.opacity ?? 0.75 },
      uTime: { value: 0 },
      uScroll: { value: new THREE.Vector2(...(opts?.scroll ?? [0.35, 0.15])) },
      uScale: { value: opts?.scale ?? 4 },
      uContrast: { value: opts?.contrast ?? 1.6 },
    },
    vertexShader: SCROLL_VERT,
    fragmentShader: SCROLL_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function tickScrollNoise(mat: THREE.ShaderMaterial, dt: number): void {
  mat.uniforms.uTime!.value += dt;
}
