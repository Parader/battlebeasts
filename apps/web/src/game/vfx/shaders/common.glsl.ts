/**
 * Shared shading helpers — fresnel, dissolve, gradients, soft particles.
 *
 * Ported from the elemental sandbox. `softFade` needs three's `<packing>` chunk,
 * so only inject this into raw ShaderMaterials (not MeshStandardMaterial patches
 * that already include packing).
 */
export const commonGLSL = /* glsl */ `
#ifndef COMMON_LIB_INCLUDED
#define COMMON_LIB_INCLUDED

#include <packing>

float softFade(sampler2D sceneDepth, vec2 screenUV, float fragViewZ, float near, float far, float fadeDist) {
  float packed = unpackRGBAToDepth(texture2D(sceneDepth, screenUV));
  float sceneViewZ = perspectiveDepthToViewZ(packed, near, far);
  return clamp((fragViewZ - sceneViewZ) / max(fadeDist, 1e-4), 0.0, 1.0);
}

float fresnelTerm(vec3 viewDir, vec3 normal, float power, float scale) {
  return clamp(scale * pow(1.0 - abs(dot(normalize(viewDir), normalize(normal))), power), 0.0, 4.0);
}

vec2 dissolveMask(float noiseValue, float threshold, float edgeWidth) {
  float mask = step(threshold, noiseValue);
  float edge = smoothstep(threshold, threshold + edgeWidth, noiseValue) - mask;
  return vec2(mask, clamp(edge, 0.0, 1.0));
}

vec3 gradient4(vec3 c0, vec3 c1, vec3 c2, vec3 c3, float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = mix(c0, c1, smoothstep(0.0, 0.34, t));
  vec3 b = mix(a, c2, smoothstep(0.30, 0.68, t));
  return mix(b, c3, smoothstep(0.64, 1.0, t));
}

vec2 screenUVFromClip(vec4 clipPos) {
  return (clipPos.xy / clipPos.w) * 0.5 + 0.5;
}

float aastep(float threshold, float value) {
  float afwidth = fwidth(value) * 0.7;
  return smoothstep(threshold - afwidth, threshold + afwidth, value);
}

#endif
`;

/**
 * Frost / ice field recipes (sandbox FrostFieldMaterial + IceMaterial).
 * Keep as GLSL snippets for when we need ground rime or crystal shading —
 * not wired into a live spell yet.
 */
export const frostPlateGLSL = /* glsl */ `
// Voronoi plates + bright seams (rime at cell boundaries via F2-F1).
// Needs an F1/F2 voronoi; the shared voronoi2 returns F1+id only — use this
// when you expand it, or sample the baked frost-plates.png.
vec3 frostPlates(vec2 pMetres, float plateScale, float seam, float plates, float seed) {
  vec2 cell = voronoi2(pMetres * plateScale + seed * 20.0);
  float plate = mix(0.55, 1.0, cell.y) * plates;
  float seams = smoothstep(0.28, 0.02, cell.x) * seam; // approx; prefer F2-F1
  return vec3(plate, seams, cell.y);
}
`;

export const frostFingersGLSL = /* glsl */ `
// Domain-warped ridged frost fingers — sample in the plane, never atan spokes.
float frostFingers(vec2 pMetres, float fingerScale, float warpAmt, float crawl, float time, float seed) {
  float warp = fbm3(vec3(pMetres * 0.5, time * 0.12 + seed)) * warpAmt;
  float fil = ridged(vec3(pMetres * fingerScale + warp, seed * 11.0 + time * crawl), 4);
  return smoothstep(0.66, 0.95, fil);
}
`;

export const iceFractureGLSL = /* glsl */ `
// World-space ridged cracks (fixed physical scale across crystal sizes).
float iceFracture(vec3 worldPos, float scale, float seed) {
  return smoothstep(0.55, 0.98, ridged(worldPos * scale + seed * 37.0, 4));
}
`;
