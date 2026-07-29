import * as THREE from "three";

/**
 * Lightweight force-shield look (inspired by cortiz2894/flow-shield-effect):
 * fresnel rim + cheap flow noise + soft hex lines.
 * One draw, no hit buffers / dissolve / tri-planar cube projection.
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
  // Cylinder height is centered on Y — normalize to 0..1 for vertical fade.
  vY01 = clamp(position.y * 0.5 + 0.5, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRimColor;
uniform float uOpacity;
uniform float uTime;
uniform float uFresnelPower;
uniform float uFresnelStrength;
uniform float uHexScale;
uniform float uHexStrength;
uniform float uFlowStrength;
uniform float uBodyAlpha;

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

/** Cheap hex distance field (one projection — fine on a half-cylinder). */
float hexDist(vec2 p) {
  p = abs(p);
  float c = dot(p, normalize(vec2(1.0, 1.7320508)));
  c = max(c, p.x);
  return c;
}

float hexLines(vec2 uv, float scale) {
  vec2 p = uv * scale;
  // Stagger rows.
  float row = floor(p.y);
  p.x += mod(row, 2.0) * 0.5;
  vec2 gv = fract(p) - 0.5;
  float d = hexDist(gv);
  // Thin cell borders only.
  return smoothstep(0.48, 0.42, d);
}

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 v = normalize(vViewDir);
  float ndv = max(dot(n, v), 0.0);

  float fresnel = pow(1.0 - ndv, uFresnelPower) * uFresnelStrength;

  // Cylindrical-ish UV from object space (stable, no mesh UVs needed).
  vec2 faceUV = vec2(atan(vObjPos.x, vObjPos.z) * 0.55, vObjPos.y);
  float hex = hexLines(faceUV, uHexScale);

  // One cheap noise sample, scrolled — “alive” without simplex octaves.
  float t = uTime * 0.55;
  float flow = valueNoise(faceUV * 3.2 + vec2(t, t * 0.7));
  flow = flow * 0.5 + 0.5;

  // Soft crop at the tips — keep most of the tall face visible.
  float yBand = smoothstep(0.06, 0.14, vY01) * smoothstep(0.94, 0.86, vY01);
  if (yBand < 0.01) discard;

  float body = uBodyAlpha * (0.35 + 0.25 * flow) * yBand;
  float grid = hex * uHexStrength * (0.55 + 0.45 * flow) * yBand;
  float rim = fresnel * yBand;

  float alpha = (body + grid * 0.65 + rim) * uOpacity;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha < 0.01) discard;

  vec3 col = uColor * (body * 1.1 + grid * 0.85);
  col += uRimColor * rim * 1.35;
  col += uRimColor * grid * 0.35;

  gl_FragColor = vec4(col, alpha);
}
`;

export type HandShieldMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uColor: { value: THREE.Color };
    uRimColor: { value: THREE.Color };
    uOpacity: { value: number };
    uTime: { value: number };
    uFresnelPower: { value: number };
    uFresnelStrength: { value: number };
    uHexScale: { value: number };
    uHexStrength: { value: number };
    uFlowStrength: { value: number };
    uBodyAlpha: { value: number };
  };
};

export function createHandShieldMaterial(
  color = "#3b82f6",
  rimColor = "#bfdbfe",
): HandShieldMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uRimColor: { value: new THREE.Color(rimColor) },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uFresnelPower: { value: 2.6 },
      uFresnelStrength: { value: 1.35 },
      uHexScale: { value: 3.8 },
      uHexStrength: { value: 0.5 },
      uFlowStrength: { value: 0.45 },
      uBodyAlpha: { value: 0.38 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }) as HandShieldMaterial;
}
