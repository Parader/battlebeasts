import * as THREE from "three";

/**
 * Waterfall meshes in the packs are a toon water shader, not a slice of the
 * prop atlas. Sampling that atlas is what turns the falls black and red.
 * Color is the Deserted Temples pond: a bright shallow blue broken into
 * darker pockets, pale patches, and small white glints.
 */
const WATER_PROP = /waterfall|water[_ ]?ripple|water[_ ]?disk/;

/**
 * Crest vertices are red and some sheet vertices are black. They are masks,
 * not a tint. Multiplying them paints a red line on the lip and dark stripes.
 */
const WATER_VERTEX_MASK = `#if defined( USE_COLOR_ALPHA )
  diffuseColor.a *= vColor.a;
#endif`;

/** Value noise for the pack's foam streaks. Declared outside main, next to common. */
const WATER_NOISE = `float envHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float envNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash(i), envHash(i + vec2(1.0, 0.0)), f.x), mix(envHash(i + vec2(0.0, 1.0)), envHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 envToonWater(vec2 space, float down, float fresnel) {
  vec3 envShallow = vec3(0.32, 0.62, 0.66);
  vec3 envMid = vec3(0.08, 0.36, 0.44);
  vec3 envDeep = vec3(0.015, 0.14, 0.22);
  float envPocket = envNoise(space);
  float envMottle = envNoise(space * 2.2 + vec2(2.2, 0.7));
  vec3 envBody = mix(envMid, envDeep, smoothstep(0.45, 0.82, envPocket) * (0.75 + down * 0.25));
  envBody = mix(envBody, envShallow, smoothstep(0.58, 0.86, envMottle));
  float envCaustic = envNoise(space * 4.5 + vec2(1.7, 0.6));
  envBody = mix(envBody, vec3(0.55, 0.82, 0.84), smoothstep(0.78, 0.94, envCaustic) * 0.35 + fresnel * 0.1);
  float envGlint = envNoise(space * 26.0 + vec2(8.2, 2.4));
  envBody = mix(envBody, vec3(0.95, 0.98, 1.0), smoothstep(0.955, 0.99, envGlint));
  return envBody;
}`;

function paintMaterial(mat: THREE.MeshStandardMaterial, falls: boolean): void {
  const data = mat.userData as { envClock?: { value: number } };
  if (!data.envClock) data.envClock = { value: 0 };
  const uniform = data.envClock;
  mat.color.setRGB(1, 1, 1);
  mat.map = null;
  mat.emissive.setRGB(0, 0, 0);
  mat.emissiveIntensity = 0;
  mat.roughness = 0.45;
  mat.metalness = 0;
  mat.transparent = true;
  mat.opacity = falls ? 0.97 : 0.94;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  mat.forceSinglePass = true;
  mat.userData.envMotion = falls ? "falls" : "water";
  mat.customProgramCacheKey = () => (falls ? "toon-falls-25" : "toon-water-15");
  const position = (mat.userData as { envMesh?: THREE.Mesh }).envMesh?.geometry.getAttribute("position");
  let lip = 0;
  let foot = -1;
  if (position) {
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      if (y > lip) lip = y;
      if (y < foot) foot = y;
    }
  }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uEnvTime = uniform;
    shader.uniforms.uEnvLip = { value: lip };
    shader.uniforms.uEnvFoot = { value: foot };
    // Body, pockets, and bright patches follow the Deserted Temples pond.
    // UVs restart per row, so the pattern uses position.
    const vertDeclare = `#include <common>
uniform float uEnvTime;
varying vec3 envLocalPos;
varying vec3 envViewNormal;
varying vec2 envUv;`;
    const fragDeclare = `#include <common>
uniform float uEnvTime;
uniform float uEnvLip;
uniform float uEnvFoot;
varying vec3 envLocalPos;
varying vec3 envViewNormal;
varying vec2 envUv;
${WATER_NOISE}`;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", vertDeclare);
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nenvLocalPos = position;\nenvViewNormal = normalize(normalMatrix * normal);\nenvUv = uv;",
    );
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", fragDeclare);
    const flow = `float envDown = clamp((uEnvLip - envLocalPos.y) / max(uEnvLip - uEnvFoot, 0.001), 0.0, 1.0);
float envFresnel = pow(1.0 - abs(dot(normalize(envViewNormal), normalize(vViewPosition))), 2.0);
${
  falls
    ? `float envAcross = envLocalPos.z * 0.7 + envLocalPos.x * 0.2;
vec2 envSpace = vec2(envAcross * 1.6, envDown * 3.2 - uEnvTime * 0.16);
diffuseColor.rgb = envToonWater(envSpace, envDown, envFresnel);`
    : `vec2 envSpace = envLocalPos.xz * 0.42 + vec2(uEnvTime * 0.04, -uEnvTime * 0.03);
diffuseColor.rgb = envToonWater(envSpace, 0.0, envFresnel);`
}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
${flow}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      "gl_FragColor = vec4(diffuseColor.rgb, diffuseColor.a);",
    );
    shader.fragmentShader = shader.fragmentShader.replace("#include <tonemapping_fragment>", "");
    // Keep this in sync with environmentMotion.ts. Vertex colors on these
    // meshes are masks. Multiplying them turns the crest red and the sheet into stripes.
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", WATER_VERTEX_MASK);
  };
  mat.onBeforeRender = () => {
    uniform.value = performance.now() / 1000;
  };
  mat.needsUpdate = true;
}

export function paintToonWater(root: THREE.Object3D, propKey: string): void {
  if (!WATER_PROP.test(propKey.toLowerCase()) || /lily|plant|tank|underwater|vegetation/.test(propKey.toLowerCase())) return;
  const falls = /waterfall/.test(propKey.toLowerCase());
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const label = `${material.name} ${mesh.name}`.toLowerCase();
      const sheet = /ripple|foam|splash|stream|water[_ ]?disk|water_1/.test(label);
      const namedFalls = /waterfall/.test(label);
      if (!sheet && !namedFalls && !falls) continue;
      if (!sheet && !namedFalls && falls) continue;
      // A ripple sheet on a waterfall is the same water, not the pond blue.
      material.userData.envMesh = mesh;
      paintMaterial(material, falls || namedFalls);
    }
    mesh.renderOrder = 2;
  });
}
