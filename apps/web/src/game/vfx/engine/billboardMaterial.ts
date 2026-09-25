import * as THREE from "three";
import { noiseGLSL } from "../shaders/noise.glsl";
import { BatchId } from "./types";

const VS = /* glsl */ `
attribute vec3 aInstPos;
attribute vec4 aInstColor;
attribute vec2 aInstSizeRot;
attribute vec4 aInstUv;

varying vec4 vColor;
varying vec2 vUv;
varying float vSeed;

void main() {
  vColor = aInstColor;
  vUv = uv * aInstUv.zw + aInstUv.xy;
  vSeed = aInstSizeRot.y;
  float size = aInstSizeRot.x;
  float rot = aInstSizeRot.y;
  float c = cos(rot);
  float s = sin(rot);
  vec2 p = position.xy * size;
  vec2 rp = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 worldPos = aInstPos + right * rp.x + up * rp.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const FS_ATLAS = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
varying vec2 vUv;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  vec4 col = vec4(tex.rgb * vColor.rgb, tex.a * vColor.a);
  if (col.a < 0.02) discard;
  gl_FragColor = col;
}
`;

/**
 * Elemental-sandbox smoke silhouette: soft disc eroded by animated fbm.
 * No atlas sample — tint comes entirely from particle colour.
 */
const FS_SMOKE = /* glsl */ `
uniform float uTime;
varying vec4 vColor;
varying float vSeed;
varying vec2 vLocalUv;

${noiseGLSL}

void main() {
  vec2 c = (vLocalUv - 0.5) * 2.0;
  float d = length(c);
  float n = fbm3(vec3(c * 1.6, vSeed * 21.0 + uTime * 0.25));
  float mask = smoothstep(1.0, 0.05, d + n * 0.42) * 0.9;
  float alpha = mask * vColor.a;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, alpha);
}
`;

const VS_SMOKE = /* glsl */ `
attribute vec3 aInstPos;
attribute vec4 aInstColor;
attribute vec2 aInstSizeRot;
attribute vec4 aInstUv;

varying vec4 vColor;
varying vec2 vLocalUv;
varying float vSeed;

void main() {
  vColor = aInstColor;
  vLocalUv = uv;
  // rot stores both spin and a stable seed — fold into 0..1-ish for fbm.
  vSeed = fract(aInstSizeRot.y * 0.1591549 + aInstPos.x * 0.13 + aInstPos.z * 0.07);
  float size = aInstSizeRot.x;
  float rot = aInstSizeRot.y;
  float c = cos(rot);
  float s = sin(rot);
  vec2 p = position.xy * size;
  vec2 rp = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 worldPos = aInstPos + right * rp.x + up * rp.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

let proto: THREE.ShaderMaterial | null = null;
const batchMats: THREE.ShaderMaterial[] = [];
let smokeTime = 0;

function whiteTex(): THREE.DataTexture {
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.needsUpdate = true;
  return tex;
}

let placeholder: THREE.Texture | null = null;

function getPlaceholder(): THREE.Texture {
  if (!placeholder) placeholder = whiteTex();
  return placeholder;
}

export function getBillboardProto(): THREE.ShaderMaterial {
  if (!proto) {
    proto = new THREE.ShaderMaterial({
      name: "VfxParticleBillboard",
      uniforms: {
        uMap: { value: getPlaceholder() },
      },
      vertexShader: VS,
      fragmentShader: FS_ATLAS,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }
  return proto;
}

function blendingFor(batch: BatchId): THREE.Blending {
  return batch === BatchId.AlphaSmoke || batch === BatchId.AlphaIce
    ? THREE.NormalBlending
    : THREE.AdditiveBlending;
}

function createSmokeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "VfxParticleSmoke",
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: VS_SMOKE,
    fragmentShader: FS_SMOKE,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

export function getBatchMaterial(batch: BatchId): THREE.ShaderMaterial {
  let mat = batchMats[batch];
  if (!mat) {
    if (batch === BatchId.AlphaSmoke) {
      mat = createSmokeMaterial();
    } else {
      mat = getBillboardProto().clone();
      mat.name = `VfxParticleBillboard:${batch}`;
      mat.blending = blendingFor(batch);
      mat.uniforms.uMap = { value: getPlaceholder() };
    }
    batchMats[batch] = mat;
  }
  return mat;
}

export function setBatchMap(batch: BatchId, map: THREE.Texture): void {
  if (batch === BatchId.AlphaSmoke) return;
  const mat = getBatchMaterial(batch);
  if (mat.uniforms.uMap) mat.uniforms.uMap.value = map;
}

export function setAllBatchMaps(map: THREE.Texture): void {
  for (let i = 0; i < 4; i++) {
    if (i === BatchId.AlphaSmoke) continue;
    setBatchMap(i as BatchId, map);
  }
}

/** Drive smoke fbm crawl — call once per particle tick. */
export function tickSmokeMaterial(timeSec: number): void {
  smokeTime = timeSec;
  const mat = batchMats[BatchId.AlphaSmoke];
  if (mat?.uniforms.uTime) mat.uniforms.uTime.value = smokeTime;
}

/** One-instance geometry matching live attribute layout — for gl.compile. */
export function createWarmBillboardMesh(): THREE.Mesh {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  if (base.index) geo.setIndex(base.index.clone());
  geo.setAttribute("position", base.getAttribute("position")!.clone());
  geo.setAttribute("uv", base.getAttribute("uv")!.clone());
  geo.instanceCount = 1;
  geo.setAttribute(
    "aInstPos",
    new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0]), 3),
  );
  geo.setAttribute(
    "aInstColor",
    new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1, 0.01]), 4),
  );
  geo.setAttribute(
    "aInstSizeRot",
    new THREE.InstancedBufferAttribute(new Float32Array([0.2, 0]), 2),
  );
  geo.setAttribute(
    "aInstUv",
    new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 1, 1]), 4),
  );
  base.dispose();
  const mesh = new THREE.Mesh(geo, getBillboardProto());
  mesh.frustumCulled = false;
  mesh.name = "VfxParticleBillboardWarm";
  return mesh;
}
