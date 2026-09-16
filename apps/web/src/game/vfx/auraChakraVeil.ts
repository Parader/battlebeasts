import * as THREE from "three";

/**
 * Soft energy sheet around the silhouette — sits outside armor so equipped
 * gear doesn't eat the vessel glow. Fresnel + rising noise, no hard shell.
 */
const VERT = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying vec3 vObjPos;
varying float vY01;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  vObjPos = position;
  vY01 = clamp(position.y * 0.5 + 0.5, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;

varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying vec3 vObjPos;
varying float vY01;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 v = normalize(vViewDir);
  float ndv = abs(dot(n, v));
  float fres = pow(clamp(1.0 - ndv, 0.0, 1.0), 1.65);

  vec2 flowUv = vec2(atan(vObjPos.x, vObjPos.z) * 0.85, vObjPos.y * 1.35);
  float flow = valueNoise(flowUv * 3.4 + vec2(uTime * 0.18, -uTime * 0.62));
  float wisps = valueNoise(flowUv * 7.1 + vec2(-uTime * 0.41, -uTime * 1.05));
  float organics = mix(0.42, 1.0, flow) * mix(0.55, 1.0, wisps);

  float feet = smoothstep(0.0, 0.1, vY01);
  float crown = smoothstep(1.0, 0.38, vY01);
  float yBand = feet * crown;

  float rim = fres * organics;
  float breath = 0.03 + 0.06 * organics * (1.0 - fres);
  float alpha = (rim * 0.7 + breath) * yBand * uOpacity;
  if (alpha < 0.016) discard;

  vec3 col = uColor * (0.35 + 0.55 * fres + 0.18 * wisps);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

export type ChakraVeilMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uColor: { value: THREE.Color };
    uOpacity: { value: number };
    uTime: { value: number };
  };
};

export function createChakraVeilMaterial(): ChakraVeilMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color("#ffffff") },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  }) as ChakraVeilMaterial;
}

export function createChakraVeilGeometry(): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(1, 0.82, 2, 28, 1, true);
}
