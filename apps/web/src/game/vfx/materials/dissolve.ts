import * as THREE from "three";

const DISSOLVE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DISSOLVE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uThreshold;
uniform float uEdge;
varying vec2 vUv;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  float n = hash(vUv * 18.0);
  float edge = smoothstep(uThreshold - uEdge, uThreshold, n);
  float body = 1.0 - smoothstep(uThreshold, uThreshold + uEdge, n);
  float a = body * uOpacity;
  vec3 col = uColor * (1.0 + edge * 1.5);
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}
`;

/**
 * Threshold dissolve — animate `uThreshold` 0→1 to burn away.
 * Useful for despawn flashes and future ability telegraphs.
 */
export function createDissolveMaterial(
  color: string,
  opts?: { opacity?: number; edge?: number; threshold?: number },
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opts?.opacity ?? 1 },
      uThreshold: { value: opts?.threshold ?? 0 },
      uEdge: { value: opts?.edge ?? 0.08 },
    },
    vertexShader: DISSOLVE_VERT,
    fragmentShader: DISSOLVE_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function setDissolveThreshold(mat: THREE.ShaderMaterial, t: number): void {
  mat.uniforms.uThreshold!.value = THREE.MathUtils.clamp(t, 0, 1);
}
