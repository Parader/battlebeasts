import * as THREE from "three";
import {
  ELEMENT_STYLE,
  GROUND_SHAPE_ID,
  type GroundDecalPreset,
  type GroundShape,
  type VfxElement,
} from "../kit/types";

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
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.05;
    a *= 0.5;
  }
  return v;
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Procedural ground decal — shape mask + elemental style in one shader.
 * uShape: 0 circle, 1 ring, 2 cone, 3 line, 4 rect, 5 arc
 * uStyle: 0 earth, 1 fire, 2 ice, 3 water, 4 wind, 5 poison
 */
const FRAG = /* glsl */ `
uniform vec3 uColorCore;
uniform vec3 uColorMid;
uniform vec3 uColorEdge;
uniform float uOpacity;
uniform float uProgress;
uniform float uTime;
uniform float uNoiseScale;
uniform float uBreakup;
uniform float uRingWidth;
uniform float uSoftness;
uniform float uStyle;
uniform float uShape;
uniform float uInnerRatio;
uniform float uHalfAngle;
uniform float uArcSpan;
uniform float uAspect;
varying vec2 vUv;
${NOISE_GLSL}

float shapeMask(vec2 p) {
  float r = length(p);
  float ang = atan(p.x, -p.y);
  float soft = max(0.002, uSoftness);
  float edgeNoise = fbm(p * uNoiseScale * 0.9 + 2.3);

  if (uShape < 0.5) {
    // Jagged blast radius — warp + secondary lobe so it isn't a clean disk
    float lobe = fbm(p * uNoiseScale * 1.6 + 7.1);
    float edge = uProgress * mix(0.48, 1.22, edgeNoise * 0.7 + lobe * 0.3);
    return 1.0 - smoothstep(edge - soft * 3.2, edge + soft * 0.55, r);
  }
  if (uShape < 1.5) {
    float mid = mix(uInnerRatio, 1.0, uProgress) * mix(0.82, 1.0, edgeNoise);
    return 1.0 - smoothstep(0.0, uRingWidth + soft, abs(r - mid));
  }
  if (uShape < 2.5) {
    float inAngle = 1.0 - smoothstep(uHalfAngle, uHalfAngle + soft * 2.0, abs(ang));
    float inRange = 1.0 - smoothstep(uProgress * mix(0.85, 1.1, edgeNoise) - soft, uProgress + soft * 0.35, r);
    return inAngle * inRange;
  }
  if (uShape < 3.5) {
    float along = 1.0 - smoothstep(uProgress - soft, uProgress + soft, abs(p.y) / max(uProgress, 0.001));
    float across = 1.0 - smoothstep(uRingWidth, uRingWidth + soft, abs(p.x));
    float forward = step(-0.02, p.y);
    return along * across * forward;
  }
  if (uShape < 4.5) {
    float halfL = 0.5 * uAspect * uProgress;
    float halfW = 0.5 * uProgress / max(uAspect, 0.15);
    float dx = 1.0 - smoothstep(halfW, halfW + soft, abs(p.x));
    float dy = 1.0 - smoothstep(halfL, halfL + soft, abs(p.y));
    return dx * dy;
  }
  float mid = mix(uInnerRatio, 0.85, uProgress) * mix(0.9, 1.05, edgeNoise);
  float band = 1.0 - smoothstep(0.0, uRingWidth + soft, abs(r - mid));
  float wedge = 1.0 - smoothstep(uArcSpan * 0.5, uArcSpan * 0.5 + soft * 2.0, abs(ang));
  return band * wedge;
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float mask = shapeMask(p);
  if (mask < 0.001) discard;

  float r = length(p);
  vec2 nUv = p * uNoiseScale + vec2(uTime * 0.15, -uTime * 0.08);
  float n = fbm(nUv);
  float n2 = fbm(nUv * 1.7 + 3.1);

  float breakAmt = smoothstep(1.0 - uBreakup, 1.0, n);
  float alpha = mask * (0.35 + 0.65 * breakAmt);

  vec3 col = uColorMid;
  float style = uStyle;

  if (style < 0.5) {
    // earth — fissures first, patchy dirt second (irregular, not round fill)
    vec2 dirtUv = p * uNoiseScale;
    float dirtN = fbm(dirtUv);
    float grit = fbm(dirtUv * 3.1 + 2.4);
    float edgeWarp = fbm(p * uNoiseScale * 1.15 + 5.0);

    float crater = mask * smoothstep(0.3, 0.75, dirtN);
    crater *= 0.3 + 0.7 * grit;
    crater *= smoothstep(0.12, 0.5, mask);

    float ang = atan(p.x, p.y);
    float warp = (dirtN - 0.5) * 1.9;
    float spokes = 6.0 + floor(grit * 3.0);
    float spoke = abs(fract((ang + warp) / 6.2831853 * spokes) - 0.5);
    float crackW = 0.012 + grit * 0.045;
    float crack = 1.0 - smoothstep(0.0, crackW, spoke);
    float reach = uProgress * mix(0.68, 1.18, edgeWarp);
    crack *= smoothstep(0.02, 0.09, r);
    crack *= 1.0 - smoothstep(reach * 0.65, reach, r);
    crack *= mask;

    float fork = abs(fract((ang * 1.7 - warp * 0.6) / 6.2831853 * 11.0) - 0.5);
    float forkCrack = 1.0 - smoothstep(0.0, 0.01 + grit * 0.025, fork);
    forkCrack *= smoothstep(0.12, 0.3, r) * (1.0 - smoothstep(reach * 0.5, reach * 0.95, r)) * mask * 0.9;

    float fissure = max(crack, forkCrack);

    float lipR = uProgress * mix(0.72, 1.08, edgeWarp);
    float lip = 1.0 - smoothstep(0.0, uRingWidth * 2.4 + uSoftness, abs(r - lipR));
    lip *= mask * smoothstep(0.4, 0.85, grit);

    vec3 soil = mix(uColorEdge, uColorMid, dirtN);
    vec3 overturn = mix(uColorMid, uColorCore, grit);
    col = mix(soil, overturn, crater * 0.8);
    col = mix(col, uColorEdge * 0.4, fissure);
    col = mix(col, uColorCore * 0.65, lip * 0.45);

    alpha = max(fissure, max(crater * 0.28, lip * 0.22));
    alpha *= mask;
  } else if (style < 1.5) {
    float heat = pow(1.0 - r, 1.4) * (0.5 + n);
    col = mix(uColorEdge, mix(uColorMid, uColorCore, heat), heat);
    alpha *= 0.5 + heat * 0.7;
  } else if (style < 2.5) {
    float rim = smoothstep(0.55, 0.95, mask) * (0.4 + n2);
    col = mix(uColorMid, uColorCore, rim);
    col = mix(col, uColorEdge, 1.0 - breakAmt);
    alpha *= 0.45 + rim * 0.55;
  } else if (style < 3.5) {
    float rip = sin((r * 18.0 - uTime * 4.0) + n * 3.0) * 0.5 + 0.5;
    col = mix(uColorEdge, uColorCore, rip * (1.0 - r));
    alpha *= 0.35 + rip * 0.4;
  } else if (style < 4.5) {
    float streak = smoothstep(0.6, 0.9, n) * smoothstep(0.3, 0.7, abs(p.x + n2 * 0.3));
    col = mix(uColorEdge, uColorCore, streak);
    alpha *= streak * 0.85;
  } else {
    float pulse = 0.65 + 0.35 * sin(uTime * 3.0 + n * 6.0);
    float blot = smoothstep(0.35, 0.75, n2);
    col = mix(uColorEdge, mix(uColorMid, uColorCore, blot), blot);
    alpha *= blot * pulse;
  }

  // Lifetime fade comes only from uOpacity (component). Never fade by uProgress —
  // that wiped the effect as soon as expand finished.
  alpha *= uOpacity;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

export function createGroundDecalMaterial(
  preset: GroundDecalPreset,
  shape?: GroundShape,
): THREE.ShaderMaterial {
  const resolvedShape = shape ?? preset.shape;
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorCore: { value: new THREE.Color(preset.colorCore) },
      uColorMid: { value: new THREE.Color(preset.colorMid) },
      uColorEdge: { value: new THREE.Color(preset.colorEdge) },
      uOpacity: { value: preset.opacity },
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uNoiseScale: { value: preset.noiseScale },
      uBreakup: { value: preset.breakup },
      uRingWidth: { value: preset.ringWidth },
      uSoftness: { value: preset.softness },
      uStyle: { value: ELEMENT_STYLE[preset.element] },
      uShape: { value: GROUND_SHAPE_ID[resolvedShape] },
      uInnerRatio: { value: preset.innerRatio ?? 0.55 },
      uHalfAngle: { value: preset.halfAngle ?? 0.55 },
      uArcSpan: { value: preset.arcSpan ?? Math.PI * 0.9 },
      uAspect: { value: preset.aspect ?? 2.2 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: preset.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function setGroundDecalProgress(mat: THREE.ShaderMaterial, progress01: number): void {
  mat.uniforms.uProgress!.value = THREE.MathUtils.clamp(progress01, 0, 1);
}

export function setGroundDecalOpacity(mat: THREE.ShaderMaterial, opacity: number): void {
  mat.uniforms.uOpacity!.value = opacity;
}

export function tickGroundDecal(mat: THREE.ShaderMaterial, dt: number, _spin = 0): void {
  mat.uniforms.uTime!.value += dt;
}

export function applyGroundDecalPreset(
  mat: THREE.ShaderMaterial,
  preset: GroundDecalPreset,
  shape?: GroundShape,
): void {
  mat.uniforms.uColorCore!.value.set(preset.colorCore);
  mat.uniforms.uColorMid!.value.set(preset.colorMid);
  mat.uniforms.uColorEdge!.value.set(preset.colorEdge);
  mat.uniforms.uOpacity!.value = preset.opacity;
  mat.uniforms.uNoiseScale!.value = preset.noiseScale;
  mat.uniforms.uBreakup!.value = preset.breakup;
  mat.uniforms.uRingWidth!.value = preset.ringWidth;
  mat.uniforms.uSoftness!.value = preset.softness;
  mat.uniforms.uStyle!.value = ELEMENT_STYLE[preset.element as VfxElement];
  mat.uniforms.uShape!.value = GROUND_SHAPE_ID[shape ?? preset.shape];
  mat.uniforms.uInnerRatio!.value = preset.innerRatio ?? 0.55;
  mat.uniforms.uHalfAngle!.value = preset.halfAngle ?? 0.55;
  mat.uniforms.uArcSpan!.value = preset.arcSpan ?? Math.PI * 0.9;
  mat.uniforms.uAspect!.value = preset.aspect ?? 2.2;
  mat.blending = preset.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
}
