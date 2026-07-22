import * as THREE from "three";

const RUNE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RUNE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uSpokes;
varying vec2 vUv;

float ring(float d, float r, float w) {
  return smoothstep(w, 0.0, abs(d - r));
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  float ang = atan(p.y, p.x);
  float spin = ang + uTime * 0.8;

  float a = 0.0;
  a += ring(d, 0.82, 0.04);
  a += ring(d, 0.55, 0.03);
  a += ring(d, 0.28, 0.035) * 0.85;

  float spokes = abs(sin(spin * uSpokes * 0.5));
  spokes = smoothstep(0.82, 1.0, spokes);
  a += spokes * (1.0 - smoothstep(0.2, 0.9, d)) * 0.7;

  // Soft glyphs as radial ticks
  float ticks = abs(sin(ang * 16.0));
  a += smoothstep(0.9, 1.0, ticks) * ring(d, 0.68, 0.05) * 0.6;

  a *= smoothstep(1.0, 0.92, d);
  gl_FragColor = vec4(uColor, a * uOpacity);
}
`;

/** Stylized rune / sigil disc — ground telegraphs & cast circles. */
export function createRuneMaterial(
  color: string,
  opts?: { opacity?: number; spokes?: number },
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opts?.opacity ?? 0.9 },
      uTime: { value: 0 },
      uSpokes: { value: opts?.spokes ?? 6 },
    },
    vertexShader: RUNE_VERT,
    fragmentShader: RUNE_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function tickRuneMaterial(mat: THREE.ShaderMaterial, dt: number): void {
  mat.uniforms.uTime!.value += dt;
}
