import * as THREE from "three";
import { attachClothReach, CLOTH_WAVE } from "./clothReach";
import { envMotionKind, isTreeProp, vertexColorIsWindMask, type EnvMotionKind } from "./envMotionKind";
import { foliageTrunkRadius, liftDeadVertexColors, markLeafCards } from "./vertexTint";

/** Bump when the water or wind shading changes, so open editors re-dress props. */
export const ENV_MOTION_REV = 4;

/**
 * Crest vertices are red and some sheet vertices are black. They are masks,
 * not a tint. Keep this in sync with waterPaint.ts.
 */
const WATER_VERTEX_MASK = `#if defined( USE_COLOR_ALPHA )
  diffuseColor.a *= vColor.a;
#endif`;

/** Shared clock. Materials read it from their own uniform each draw. */
export const envMotionClock = { time: 0 };

export function tickEnvMotion(dt: number): void {
  envMotionClock.time += dt;
}

const patched = new WeakSet<THREE.Material>();

/** 1 is the original gust. Tall crowns move the most, so this is the leaf knob. */
const FOLIAGE_SWAY = 0.45;
/** 1 is the original pace. Lower is a slower sway. */
const FOLIAGE_SWAY_SPEED = 0.6;
/**
 * Leaf cards are about 2m across. The grass wave (about 2 rad/m) turns a card
 * inside out, and the atlas mip then flashes a different tile. A broad wave
 * keeps one card in one piece.
 */
const FOLIAGE_CARD_FREQ = 0.16;

/** Stop a folded card from sampling a neighboring atlas tile. */
const FOLIAGE_STABLE_MAP = `#ifdef USE_MAP
	vec2 envDx = dFdx(vMapUv);
	vec2 envDy = dFdy(vMapUv);
	float envSpan = max(length(envDx), length(envDy));
	if (envSpan > 0.02) {
		float envScale = 0.02 / envSpan;
		envDx *= envScale;
		envDy *= envScale;
	}
	vec4 sampledDiffuseColor = textureGrad(map, vMapUv, envDx, envDy);
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`;

function shaderFor(kind: EnvMotionKind): { vertex: string; fragment: string; output?: string; skipTone?: boolean } {
  if (kind === "foliage") {
    return {
      vertex: `#include <begin_vertex>
float envRadial = length(position.xz);
float envLeaf = uTrunkRadius < 0.0 ? 0.0 : (uTrunkRadius > 0.0 ? smoothstep(uTrunkRadius, uTrunkRadius * 1.85, envRadial) : 1.0);
float envSway = sin(uEnvTime * ${1.7 * FOLIAGE_SWAY_SPEED} + position.x * 2.4 + position.z * 1.6) * envLeaf;
transformed.x += envSway * ${FOLIAGE_SWAY} * (0.035 + max(position.y, 0.0) * 0.05);
transformed.z += cos(uEnvTime * ${1.3 * FOLIAGE_SWAY_SPEED} + position.z * 2.0) * envLeaf * ${FOLIAGE_SWAY} * (0.02 + max(position.y, 0.0) * 0.03);`,
      // Only lift texels that are still crushed to black. A midtone atlas
      // pushed through a steep power lands on white.
      fragment: `#include <color_fragment>
float envLuma = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
float envCrush = 1.0 - smoothstep(0.05, 0.16, envLuma);
vec3 envLifted = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(0.55));
diffuseColor.rgb = mix(diffuseColor.rgb, envLifted, envCrush);`,
    };
  }
  if (kind === "cloth") {
    // Distance from the pole axis, not the mesh origin. See clothReach.ts.
    return {
      vertex: CLOTH_WAVE,
      fragment: "",
    };
  }
  if (kind === "fire") {
    return {
      vertex: "",
      fragment: `#include <emissivemap_fragment>
float envRed = diffuseColor.r - max(diffuseColor.g, diffuseColor.b);
float envBright = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
float envWarm = diffuseColor.r + diffuseColor.g - diffuseColor.b * 2.0;
float envFlame = max(smoothstep(0.16, 0.42, envRed), smoothstep(0.78, 0.96, envBright) * smoothstep(0.05, 0.35, envWarm));
float envFlick = 0.55 + 0.45 * sin(uEnvTime * 11.0 + envBright * 18.0);
totalEmissiveRadiance += vec3(1.0, 0.38, 0.05) * envFlame * envFlick * 1.4;`,
    };
  }
  // Unity falls are a blue body plus two noise layers scrolled down the sheet
  // until they blow out white. A sine between two teals stays a pale stripe.
  const flow =
    kind === "falls"
      ? `float envLine = envNoise(vec2(envUv.x * 14.0, envUv.y * 0.35 - uEnvTime * 0.45));
float envLine2 = envNoise(vec2(envUv.x * 23.0 + 3.1, envUv.y * 0.55 - uEnvTime * 0.62));
float envBreak = envNoise(vec2(envUv.x * 6.0 + 1.7, envUv.y * 2.2 - uEnvTime * 0.75));
float envLines = max(1.0 - smoothstep(0.16, 0.44, envLine), (1.0 - smoothstep(0.08, 0.26, envLine2)) * 0.8);
float envBlueAmt = envLines * mix(0.55, 1.0, smoothstep(0.15, 0.75, envBreak));
vec3 envBlue = vec3(0.05, 0.46, 0.98);
diffuseColor.rgb = mix(vec3(1.0), envBlue, envBlueAmt);`
      : `float envWarp = envNoise(envLocalPos.xz * 2.2 + vec2(uEnvTime * 0.12, -uEnvTime * 0.08));
float envRipple = envNoise(envLocalPos.xz * 3.6 + vec2(-uEnvTime * 0.18, uEnvTime * 0.14));
float envCrest = smoothstep(0.74, 0.92, envRipple);
vec3 envDeep = vec3(0.02, 0.30, 0.86);
diffuseColor.rgb = mix(envDeep, vec3(0.12, 0.52, 0.98), envWarp);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.97, 1.0), envCrest * 0.5);`;
  return {
    vertex: `#include <begin_vertex>
envLocalPos = position;
envUv = uv;`,
    fragment: `#include <map_fragment>
${flow}`,
    output: "gl_FragColor = vec4(diffuseColor.rgb, diffuseColor.a);",
    skipTone: true,
  };
}

function patchMaterial(mat: THREE.MeshStandardMaterial, kind: EnvMotionKind): void {
  if (patched.has(mat)) return;
  patched.add(mat);
  const uniform = { value: 0 };
  const chunks = shaderFor(kind);
  mat.userData.envMotion = kind;
  const leafCards = kind === "foliage" && mat.userData.leafCards === true;
  mat.customProgramCacheKey = () => `env-motion:${kind}:${leafCards ? "cards" : "radial"}:22`;
  mat.onBeforeCompile = (shader) => {
    if (!chunks.vertex && !chunks.fragment) return;
    shader.uniforms.uEnvTime = uniform;
    if (kind === "foliage") {
      const trunk = (mat.userData as { trunkRadius?: { value: number } }).trunkRadius;
      shader.uniforms.uTrunkRadius = trunk ?? { value: 0 };
    }
    const water = kind === "falls" || kind === "water";
    const noiseFns = `float envHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float envNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash(i), envHash(i + vec2(1.0, 0.0)), f.x), mix(envHash(i + vec2(0.0, 1.0)), envHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`;
    const vertCommon = water
      ? `#include <common>
uniform float uEnvTime;
varying vec3 envLocalPos;
varying vec2 envUv;`
        : kind === "cloth"
          ? "#include <common>\nuniform float uEnvTime;\nattribute float envReach;"
          : kind === "foliage"
            ? leafCards
              ? "#include <common>\nuniform float uEnvTime;\nattribute float envLeaf;\nattribute vec3 envPivot;"
              : "#include <common>\nuniform float uEnvTime;\nuniform float uTrunkRadius;"
            : "#include <common>\nuniform float uEnvTime;";
    const fragCommon = water
      ? `#include <common>
uniform float uEnvTime;
varying vec3 envLocalPos;
varying vec2 envUv;
${noiseFns}`
      : kind === "foliage" && leafCards
        ? "#include <common>\nuniform float uEnvTime;"
        : vertCommon;
    const common = fragCommon;
    if (chunks.vertex) {
      const vertex = leafCards
        ? `#include <begin_vertex>
float envSway = sin(uEnvTime * ${1.7 * FOLIAGE_SWAY_SPEED} + envPivot.x * ${FOLIAGE_CARD_FREQ} + envPivot.z * ${FOLIAGE_CARD_FREQ * 0.65}) * envLeaf;
transformed.x += envSway * ${FOLIAGE_SWAY} * (0.035 + max(envPivot.y, 0.0) * 0.05);
transformed.z += cos(uEnvTime * ${1.3 * FOLIAGE_SWAY_SPEED} + envPivot.z * ${FOLIAGE_CARD_FREQ}) * envLeaf * ${FOLIAGE_SWAY} * (0.02 + max(envPivot.y, 0.0) * 0.03);`
        : chunks.vertex;
      shader.vertexShader = shader.vertexShader.replace("#include <common>", vertCommon);
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", vertex);
    }
    if (chunks.fragment) {
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", common);
      if (kind === "foliage") {
        if (leafCards) shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", FOLIAGE_STABLE_MAP);
        shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", chunks.fragment);
      } else {
        const slot = kind === "fire" ? "#include <emissivemap_fragment>" : "#include <map_fragment>";
        shader.fragmentShader = shader.fragmentShader.replace(slot, chunks.fragment);
        if (kind === "falls" || kind === "water") {
          shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", WATER_VERTEX_MASK);
          if (chunks.output) {
            shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", chunks.output);
          }
          if (chunks.skipTone) {
            shader.fragmentShader = shader.fragmentShader.replace("#include <tonemapping_fragment>", "");
          }
        }
      }
    }
  };
  mat.onBeforeRender = () => {
    uniform.value = envMotionClock.time;
  };
  if (kind === "falls" || kind === "water") {
    mat.color.setRGB(1, 1, 1);
    mat.map = null;
    mat.emissive.setRGB(0, 0, 0);
    mat.emissiveIntensity = 0;
    mat.roughness = 0.45;
    mat.metalness = 0;
    mat.transparent = true;
    mat.opacity = kind === "falls" ? 0.9 : 0.94;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    mat.forceSinglePass = true;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
  }
  if (kind === "fire") {
    mat.emissive.setRGB(0, 0, 0);
    mat.emissiveIntensity = 1;
  }
  mat.needsUpdate = true;
}

/** A glow card: the lights atlas is a fade-to-black ramp, meant to add, not to shade. */
function paintGlowCard(mat: THREE.MeshStandardMaterial): void {
  if (!mat.map) return;
  if (mat.emissive.r + mat.emissive.g + mat.emissive.b < 1.2) return;
  mat.emissiveMap = mat.map;
  mat.emissive.setRGB(1, 1, 1);
  mat.emissiveIntensity = 3.2;
  mat.color.setRGB(0, 0, 0);
  mat.transparent = true;
  mat.blending = THREE.AdditiveBlending;
  mat.depthWrite = false;
  mat.toneMapped = false;
  mat.side = THREE.DoubleSide;
}

function dressMaterial(mat: THREE.Material, propKey: string, meshName: string): void {
  if (!(mat instanceof THREE.MeshStandardMaterial)) return;
  const kind = envMotionKind(propKey, mat.name, meshName);
  if (!kind) return;
  if (kind === "foliage" && isTreeProp(propKey) && mat.transparent && mat.blending === THREE.NormalBlending) {
    mat.transparent = false;
    mat.depthWrite = true;
    if (!(mat.alphaTest > 0)) mat.alphaTest = 0.5;
    mat.side = THREE.DoubleSide;
  }
  if (kind === "foliage") paintGlowCard(mat);
  patchMaterial(mat, kind);
}

const CUTOUT_ATLAS = /vegetation|grass|flower|leaf|leaves|palm|fern|bush|foliage/i;

/**
 * Leaf cards that share a pack atlas were exported opaque, so the empty
 * texels draw as black squares. Cut those out. Trunk atlases keep their name
 * and stay solid.
 */
const DECAL_PROP = /decals|billboard|board/i;

function billboardColors(propKey: string): { bark: string; leaf: string } {
  const prop = propKey.toLowerCase();
  if (/dead/.test(prop)) return { bark: "0.36, 0.30, 0.24", leaf: "0.46, 0.40, 0.32" };
  if (/pine|fir|spruce/.test(prop)) return { bark: "0.34, 0.22, 0.12", leaf: "0.15, 0.34, 0.16" };
  if (/debris|fallen/.test(prop)) return { bark: "0.34, 0.26, 0.14", leaf: "0.42, 0.32, 0.16" };
  return { bark: "0.38, 0.24, 0.12", leaf: "0.28, 0.50, 0.18" };
}

/** The decal atlas stores a white shape on black, with a solid alpha. */
function uvRegionIsMask(map: THREE.Texture, geometry: THREE.BufferGeometry): boolean {
  const image = map.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  const uv = geometry.getAttribute("uv");
  if (!image?.width || !image.height || !uv || uv.count < 3) return false;
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  const step = Math.max(1, Math.floor(uv.count / 240));
  for (let i = 0; i < uv.count; i += step) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  const sx = Math.max(0, Math.floor(u0 * image.width));
  const sw = Math.max(1, Math.min(image.width - sx, Math.ceil((u1 - u0) * image.width)));
  const sy = Math.max(0, Math.floor((1 - v1) * image.height));
  const sh = Math.max(1, Math.min(image.height - sy, Math.ceil((v1 - v0) * image.height)));
  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 24;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.imageSmoothingEnabled = false;
  let data: Uint8ClampedArray;
  try {
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, 24, 24);
    data = ctx.getImageData(0, 0, 24, 24).data;
  } catch {
    return false;
  }
  let white = 0;
  let black = 0;
  let color = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 18) color += 1;
    else if (r > 220 && g > 220 && b > 220) white += 1;
    else if (r < 28 && g < 28 && b < 28) black += 1;
  }
  return color / n < 0.04 && white / n > 0.04 && black / n > 0.04;
}

/**
 * Fantasy Nature boards are a white silhouette on a black card. The alpha
 * channel is solid, so the card draws white. Use the brightness as the
 * cutout and paint bark and leaf over the shape.
 */
export function colorBillboardMasks(root: THREE.Object3D, propKey: string): void {
  if (!DECAL_PROP.test(propKey)) return;
  const tint = billboardColors(propKey);
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material || !mesh.geometry) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || !material.map) continue;
      if (material.userData.billboardTint) continue;
      if (!uvRegionIsMask(material.map, mesh.geometry)) continue;
      material.userData.billboardTint = true;
      material.alphaTest = 0.35;
      material.side = THREE.DoubleSide;
      material.metalness = 0;
      material.roughness = 1;
      const physical = material as THREE.MeshStandardMaterial & { specularIntensity?: number };
      if (physical.specularIntensity !== undefined) physical.specularIntensity = 0.1;
      material.customProgramCacheKey = () => "billboard-mask-2";
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <color_fragment>",
          `#include <color_fragment>
float envMask = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
vec3 envBark = vec3(${tint.bark});
vec3 envLeaf = vec3(${tint.leaf});
#ifdef USE_MAP
float envCrown = smoothstep(0.08, 0.42, vMapUv.y);
#else
float envCrown = 1.0;
#endif
diffuseColor.rgb = mix(envBark, envLeaf, envCrown);
diffuseColor.a = envMask;`,
        );
      };
      material.needsUpdate = true;
    }
  });
}

export function cutoutVegetationAtlas(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (material.alphaTest > 0 || material.transparent) continue;
      if (!CUTOUT_ATLAS.test(material.name)) continue;
      material.alphaTest = 0.5;
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
    }
  });
}

/** Tag every mesh on a loaded prop. Safe to call again. */
export function dressEnvironmentObject(root: THREE.Object3D, propKey: string): void {
  liftDeadVertexColors(root, vertexColorIsWindMask(propKey));
  cutoutVegetationAtlas(root);
  colorBillboardMasks(root, propKey);
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.material) meshes.push(mesh);
  });
  for (const mesh of meshes) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial && isTreeProp(propKey) && mesh.geometry) {
        const data = material.userData as { trunkRadius?: { value: number }; leafCards?: boolean };
        if (!data.trunkRadius) {
          data.trunkRadius = { value: foliageTrunkRadius(mesh.geometry.getAttribute("position")) };
        }
        if (markLeafCards(mesh.geometry)) data.leafCards = true;
      }
      dressMaterial(material, propKey, mesh.name);
    }
    if (materials.some((material) => material.userData.envMotion === "cloth") && mesh.geometry) {
      attachClothReach(mesh.geometry);
    }
    if (materials.some((material) => material.userData.envMotion === "falls" || material.userData.envMotion === "water")) {
      mesh.renderOrder = 2;
    }
  }
}
