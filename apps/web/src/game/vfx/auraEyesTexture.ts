import type { CosmeticAuraId } from "@battlebeasts/shared";
import * as THREE from "three";
import { VFX_AURA_EYES_URL, VFX_AURA_EYES_URLS } from "./vfxUrls";

/** Authored plate is 113×63; keep the plane in that ratio. */
export const AURA_EYE_ASPECT = 113 / 63;

const EYE_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const EYE_FS = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float glow = max(max(tex.r, tex.g), tex.b);
  if (glow < 0.04) discard;
  float core = smoothstep(0.38, 0.9, glow);
  vec3 col = mix(uColor, vec3(1.0), core * 0.8);
  gl_FragColor = vec4(col * glow * uOpacity, 1.0);
}
`;

const eyesTex = new Map<string, THREE.Texture>();

function finishTex(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function paintFallbackMask(): HTMLCanvasElement {
  const w = 1024;
  const h = Math.round(w / AURA_EYE_ASPECT);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const blob = (x: number, y: number, rx: number, ry: number, rot = 0, a = 1) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha *= a;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.32, "rgba(255,255,255,0.62)");
    g.addColorStop(0.68, "rgba(255,255,255,0.18)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.scale(rx, ry);
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const eye = (x: number, y: number, outer: 1 | -1) => {
    const tilt = outer * -0.34;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    blob(0, 0, 118, 36, 0, 0.55);
    blob(0, 2, 86, 22, 0, 0.85);
    blob(0, 0, 58, 12, 0, 1);
    blob(outer * -6, 0, 28, 6, 0, 1);
    blob(0, 0, 14, 4, 0, 1);
    ctx.restore();
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const ang = outer * (Math.PI * 0.92 - t * 0.72);
      const dist = 54 + t * 168;
      blob(
        x + Math.cos(ang) * dist,
        y - 6 + Math.sin(ang) * dist * 0.72 - t * 36,
        34 - t * 18,
        16 + t * 22,
        ang + outer * 0.15,
        0.72 - t * 0.45,
      );
    }
  };

  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
  blob(w * 0.5, h * 0.52, 210, 16, 0, 0.45);
  blob(w * 0.5, h * 0.52, 120, 8, 0, 0.7);
  eye(w * 0.34, h * 0.525, -1);
  eye(w * 0.66, h * 0.525, 1);
  return canvas;
}

function eyeKey(id: CosmeticAuraId): Exclude<CosmeticAuraId, "plain"> {
  return id === "plain" ? "ember" : id;
}

function makePlaceholder(): THREE.Texture {
  if (typeof document === "undefined") return finishTex(new THREE.Texture());
  return finishTex(new THREE.CanvasTexture(paintFallbackMask()));
}

export function getAuraEyesTexture(id: CosmeticAuraId = "ember"): THREE.Texture {
  const key = eyeKey(id);
  const hit = eyesTex.get(key);
  if (hit) return hit;
  const tex = makePlaceholder();
  eyesTex.set(key, tex);
  const url = VFX_AURA_EYES_URLS[key] ?? VFX_AURA_EYES_URL;
  if (typeof document !== "undefined") {
    new THREE.TextureLoader().load(url, (loaded) => {
      setAuraEyesTexture(key, loaded);
    });
  }
  return tex;
}

export function setAuraEyesTexture(id: CosmeticAuraId, tex: THREE.Texture): void {
  const key = eyeKey(id);
  let dest = eyesTex.get(key);
  if (!dest) {
    dest = makePlaceholder();
    eyesTex.set(key, dest);
  }
  if (tex.image) dest.image = tex.image;
  finishTex(dest);
}

export function createAuraEyeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: getAuraEyesTexture("ember") },
      uColor: { value: new THREE.Color("#ffffff") },
      uOpacity: { value: 0 },
    },
    vertexShader: EYE_VS,
    fragmentShader: EYE_FS,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    transparent: true,
    toneMapped: false,
    side: THREE.FrontSide,
    fog: false,
  });
}
