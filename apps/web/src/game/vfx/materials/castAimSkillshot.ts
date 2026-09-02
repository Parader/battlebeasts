import * as THREE from "three";

/**
 * Direction skillshot ground ghost — fixed shaft + chevrons + arrow tip.
 * UV: x = side (−1..1 via centered plane), y = along (0 at caster → 1 at tip).
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
uniform float uTime;
varying vec2 vUv;

float softBand(float d, float w) {
  return 1.0 - smoothstep(0.0, max(1e-4, w), abs(d));
}

void main() {
  // Centered: sx ∈ [-1,1] across width.
  // Plane lies on XZ with +Y→−Z; flip so ay=1 (tip) faces +Z / facing.
  float sx = vUv.x * 2.0 - 1.0;
  float ay = 1.0 - vUv.y;

  // Arrow occupies the far ~18% — shaft tapers into the tip.
  float tipStart = 0.82;
  float tipT = clamp((ay - tipStart) / (1.0 - tipStart), 0.0, 1.0);
  float tipHalf = mix(1.0, 0.0, tipT);
  float inTip = step(tipStart, ay);
  float halfW = mix(1.0, tipHalf, inTip);

  // Soft rectangular body / triangle tip.
  float edge = abs(sx) - halfW;
  float rimW = 0.045;
  float inside = 1.0 - smoothstep(0.0, 0.04, edge);
  float rim = softBand(edge, rimW) * inside;

  // Longitudinal fade — slightly stronger near the tip (aim focus).
  float alongFade = mix(0.55, 1.0, smoothstep(0.0, 0.35, ay));
  alongFade *= mix(1.0, 0.75, smoothstep(0.92, 1.0, ay));

  // Soft fill wash (gradient from center to edges).
  float fill = inside * (1.0 - abs(sx) * 0.55) * 0.22 * alongFade;

  // Chevrons along the shaft (not in the tip).
  float chevCount = 5.0;
  float chevPhase = fract(ay * chevCount - uTime * 0.15);
  float chevArm = abs(sx) - (0.15 + chevPhase * 0.7);
  float chev = softBand(chevArm, 0.05) * (1.0 - inTip) * inside;
  chev *= smoothstep(0.06, 0.14, ay) * (1.0 - smoothstep(tipStart - 0.06, tipStart, ay));
  chev *= 0.85;

  // Tip highlight edge.
  float tipEdge = softBand(ay - 1.0, 0.03) * inside * inTip;

  float alpha = (fill + rim * 0.75 + chev * 0.55 + tipEdge * 0.4) * uOpacity;
  if (alpha < 0.012) discard;

  vec3 col = mix(uColor * 0.65, uHot, rim * 0.55 + chev * 0.35 + tipEdge * 0.5);
  gl_FragColor = vec4(col, alpha);
}
`;

export type CastAimSkillshotMaterialOpts = {
  color?: string;
  hotColor?: string;
};

export function createCastAimSkillshotMaterial(
  opts: CastAimSkillshotMaterialOpts = {},
): THREE.ShaderMaterial {
  const color = new THREE.Color(opts.color ?? "#3ec6ff");
  const hot = opts.hotColor
    ? new THREE.Color(opts.hotColor)
    : color.clone().lerp(new THREE.Color("#ffffff"), 0.55);
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uHot: { value: hot },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export function tickCastAimSkillshotMaterial(mat: THREE.ShaderMaterial, dt: number): void {
  mat.uniforms.uTime!.value = (mat.uniforms.uTime!.value as number) + dt;
}

export function setCastAimSkillshotOpacity(mat: THREE.ShaderMaterial, opacity: number): void {
  mat.uniforms.uOpacity!.value = opacity;
}

export function tintCastAimSkillshotMaterial(
  mat: THREE.ShaderMaterial,
  color: string,
  hotColor?: string,
): void {
  (mat.uniforms.uColor!.value as THREE.Color).set(color);
  const hot = mat.uniforms.uHot!.value as THREE.Color;
  if (hotColor) hot.set(hotColor);
  else hot.copy(mat.uniforms.uColor!.value as THREE.Color).lerp(new THREE.Color("#ffffff"), 0.55);
}
