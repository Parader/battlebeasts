import * as THREE from "three";

const FRESNEL_VERT = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vViewDir;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRESNEL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPower;
uniform float uBias;
varying vec3 vWorldNormal;
varying vec3 vViewDir;
void main() {
  float f = uBias + (1.0 - uBias) * pow(1.0 - max(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0), uPower);
  gl_FragColor = vec4(uColor * f, f * uOpacity);
}
`;

/** Soft rim glow — shields, aura shells, charge bubbles. */
export function createFresnelGlowMaterial(
  color: string,
  opts?: { opacity?: number; power?: number; bias?: number },
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opts?.opacity ?? 0.85 },
      uPower: { value: opts?.power ?? 2.4 },
      uBias: { value: opts?.bias ?? 0.08 },
    },
    vertexShader: FRESNEL_VERT,
    fragmentShader: FRESNEL_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function setFresnelColor(mat: THREE.ShaderMaterial, color: string): void {
  (mat.uniforms.uColor!.value as THREE.Color).set(color);
}
