import * as THREE from "three";
import { attachClothReach, CLOTH_WAVE } from "@web/game/clothReach?fresh=3";
import { isTreeProp } from "@web/game/envMotionKind";
import { foliageTrunkRadius, markLeafCards } from "@web/game/vertexTint";

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

const FIRE_PROP = /camp_?fire|torch/;
const CLOTH_PROP = /flag|banner|sail/;
const FOLIAGE_PROP = /grass|leaves|leaf|fern|flower|vine|bush|palm|foliage|plant|\btree/;

/**
 * The open editor keeps the web motion module it already loaded, so fire and
 * cloth have to be painted from here or a placed campfire and flag never pick
 * up the change. Campfires are one mesh; only flame-colored texels glow.
 * Flags wave from the pole outward, because their UVs sit in a tiny atlas cell.
 */
export function paintLife(root: THREE.Object3D, propKey: string): void {
  const prop = propKey.toLowerCase();
  // The open editor still dresses from the motion module it loaded at startup.
  // Strip that wave here, or a dry crown keeps bending after this file reloads.
  if (isTreeProp(propKey) && /\bdry\b/.test(prop)) {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) holdStill(material);
      }
    });
    return;
  }
  const fire = FIRE_PROP.test(prop);
  const cloth = CLOTH_PROP.test(prop);
  const foliage = FOLIAGE_PROP.test(prop) && !/pot|plot|plantation/.test(prop);
  if (!fire && !cloth && !foliage) return;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (fire) paintFlame(material);
      else if (cloth) paintCloth(material);
      else if (isGlowCard(material)) paintGlow(material);
      else if (foliage && /vegetation|leaf|leaves|palm|fern|grass|flower|foliage|tree|pine|bush/i.test(material.name)) {
        const cards = isTreeProp(propKey) && mesh.geometry ? markLeafCards(mesh.geometry) : false;
        const radius = cards ? 0 : isTreeProp(propKey) ? foliageTrunkRadius(mesh.geometry?.getAttribute("position")) : 0;
        paintFoliage(material, radius, cards, isTreeProp(propKey));
      }
    }
    if (cloth && mesh.geometry) attachClothReach(mesh.geometry);
  });
}

function holdStill(mat: THREE.MeshStandardMaterial): void {
  mat.userData.envMotion = undefined;
  mat.customProgramCacheKey = () => "still-dry-1";
  mat.onBeforeCompile = () => {};
  mat.onBeforeRender = () => {};
  mat.needsUpdate = true;
}

function isGlowCard(mat: THREE.MeshStandardMaterial): boolean {
  return !!mat.map && mat.emissive.r + mat.emissive.g + mat.emissive.b > 1.2;
}

/** Lights-atlas cards fade to black. Added, they glow; shaded, they are a black flower. */
function paintGlow(mat: THREE.MeshStandardMaterial): void {
  if (!mat.map) return;
  mat.emissiveMap = mat.map;
  mat.emissive.setRGB(1, 1, 1);
  mat.emissiveIntensity = 3.2;
  mat.color.setRGB(0, 0, 0);
  mat.transparent = true;
  mat.blending = THREE.AdditiveBlending;
  mat.depthWrite = false;
  mat.toneMapped = false;
  mat.side = THREE.DoubleSide;
  mat.needsUpdate = true;
}

function paintFoliage(mat: THREE.MeshStandardMaterial, trunkRadius: number, leafCards: boolean, tree: boolean): void {
  const uniform = envClock(mat);
  const trunk = { value: trunkRadius };
  mat.userData.envMotion = "foliage";
  mat.userData.trunkRadius = trunk;
  mat.userData.leafCards = leafCards;
  // Blended leaf cards re-sort every frame, so the atlas appears to flicker.
  if (tree && mat.transparent && mat.blending === THREE.NormalBlending) {
    mat.transparent = false;
    mat.depthWrite = true;
    if (!(mat.alphaTest > 0)) mat.alphaTest = 0.5;
    mat.side = THREE.DoubleSide;
  }
  mat.customProgramCacheKey = () => (leafCards ? "foliage-cards-5" : "foliage-lift-7");
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uEnvTime = uniform;
    shader.uniforms.uTrunkRadius = trunk;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      leafCards
        ? "#include <common>\nuniform float uEnvTime;\nattribute float envLeaf;\nattribute vec3 envPivot;"
        : "#include <common>\nuniform float uEnvTime;\nuniform float uTrunkRadius;",
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      leafCards
        ? `#include <begin_vertex>
float envSway = sin(uEnvTime * ${1.7 * FOLIAGE_SWAY_SPEED} + envPivot.x * ${FOLIAGE_CARD_FREQ} + envPivot.z * ${FOLIAGE_CARD_FREQ * 0.65}) * envLeaf;
transformed.x += envSway * ${FOLIAGE_SWAY} * (0.035 + max(envPivot.y, 0.0) * 0.05);
transformed.z += cos(uEnvTime * ${1.3 * FOLIAGE_SWAY_SPEED} + envPivot.z * ${FOLIAGE_CARD_FREQ}) * envLeaf * ${FOLIAGE_SWAY} * (0.02 + max(envPivot.y, 0.0) * 0.03);`
        : `#include <begin_vertex>
float envRadial = length(position.xz);
float envLeaf = uTrunkRadius < 0.0 ? 0.0 : (uTrunkRadius > 0.0 ? smoothstep(uTrunkRadius, uTrunkRadius * 1.85, envRadial) : 1.0);
float envSway = sin(uEnvTime * ${1.7 * FOLIAGE_SWAY_SPEED} + position.x * 2.4 + position.z * 1.6) * envLeaf;
transformed.x += envSway * ${FOLIAGE_SWAY} * (0.035 + max(position.y, 0.0) * 0.05);
transformed.z += cos(uEnvTime * ${1.3 * FOLIAGE_SWAY_SPEED} + position.z * 2.0) * envLeaf * ${FOLIAGE_SWAY} * (0.02 + max(position.y, 0.0) * 0.03);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nuniform float uEnvTime;",
    );
    if (leafCards) shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", FOLIAGE_STABLE_MAP);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
float envLuma = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
float envCrush = 1.0 - smoothstep(0.05, 0.16, envLuma);
vec3 envLifted = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(0.55));
diffuseColor.rgb = mix(diffuseColor.rgb, envLifted, envCrush);`,
    );
  };
  mat.onBeforeRender = () => {
    uniform.value = performance.now() / 1000;
  };
  mat.needsUpdate = true;
}

function envClock(mat: THREE.Material): { value: number } {
  const data = mat.userData as { envClock?: { value: number } };
  if (!data.envClock) data.envClock = { value: 0 };
  return data.envClock;
}

function paintFlame(mat: THREE.MeshStandardMaterial): void {
  const uniform = envClock(mat);
  mat.emissive.setRGB(0, 0, 0);
  mat.emissiveIntensity = 1;
  mat.userData.envMotion = "fire";
  mat.customProgramCacheKey = () => "flame-texel-2";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uEnvTime = uniform;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nuniform float uEnvTime;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
float envRed = diffuseColor.r - max(diffuseColor.g, diffuseColor.b);
float envBright = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
float envWarm = diffuseColor.r + diffuseColor.g - diffuseColor.b * 2.0;
float envFlame = max(smoothstep(0.16, 0.42, envRed), smoothstep(0.78, 0.96, envBright) * smoothstep(0.05, 0.35, envWarm));
float envFlick = 0.55 + 0.45 * sin(uEnvTime * 11.0 + envBright * 18.0);
totalEmissiveRadiance += vec3(1.0, 0.38, 0.05) * envFlame * envFlick * 1.4;`,
    );
  };
  mat.onBeforeRender = () => {
    uniform.value = performance.now() / 1000;
  };
  mat.needsUpdate = true;
}

function paintCloth(mat: THREE.MeshStandardMaterial): void {
  const uniform = envClock(mat);
  mat.userData.envMotion = "cloth";
  mat.customProgramCacheKey = () => "flag-wave-5";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uEnvTime = uniform;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      "#include <common>\nuniform float uEnvTime;\nattribute float envReach;",
    );
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", CLOTH_WAVE);
  };
  mat.onBeforeRender = () => {
    uniform.value = performance.now() / 1000;
  };
  mat.needsUpdate = true;
}
