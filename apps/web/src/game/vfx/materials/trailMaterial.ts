import * as THREE from "three";

const TRAIL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uHead;
varying vec2 vUv;
void main() {
  // Soft streak: bright head (vUv.x ~ 1), fade to tail
  float along = smoothstep(0.0, uHead, vUv.x) * (1.0 - smoothstep(0.65, 1.0, vUv.y));
  float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;
  edge = pow(max(edge, 0.0), 1.4);
  float a = along * edge * uOpacity;
  gl_FragColor = vec4(uColor, a);
}
`;

/** Soft ribbon / billboard streak material for projectile trails. */
export function createTrailMaterial(
  color: string,
  opts?: { opacity?: number; head?: number },
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opts?.opacity ?? 0.9 },
      uHead: { value: opts?.head ?? 0.15 },
    },
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
