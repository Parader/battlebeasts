import * as THREE from "three";
import type { CosmeticAuraId } from "@battlebeasts/shared";

/**
 * World-meter sprites. `aSize` is diameter in meters; `uPxPerWorld` is
 * drawingBufferHeight / (2 * tan(fov/2)) * zoom so the puff stays a
 * fixed fraction of the character across preview (close, FOV 32) and
 * the follow cam (distance 22, FOV 45).
 */
const AURA_VS = /* glsl */ `
uniform float uPxPerWorld;
attribute float aSize;
attribute float aAngle;
attribute vec4 aColor;
varying vec4 vColor;
varying vec2 vAngle;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float psz = aSize * uPxPerWorld / max(-mv.z, 0.2);
  gl_PointSize = clamp(psz, 4.0, 220.0);
  vAngle = vec2(cos(aAngle), sin(aAngle));
  vColor = aColor;
}
`;

const AURA_FS = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
varying vec2 vAngle;
void main() {
  vec2 coords = (gl_PointCoord - 0.5) * mat2(vAngle.x, vAngle.y, -vAngle.y, vAngle.x) + 0.5;
  vec4 tex = texture2D(uMap, coords);
  vec4 col = tex * vColor;
  if (col.a < 0.03) discard;
  gl_FragColor = col;
}
`;

const SIZE = 128;
const texCache = new Map<CosmeticAuraId, THREE.CanvasTexture>();
const matCache = new Map<CosmeticAuraId, THREE.ShaderMaterial>();

function canvas2d(): CanvasRenderingContext2D | null {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  return canvas.getContext("2d");
}

function softBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rot = 0,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.38, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.scale(rx, ry);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintEmber(ctx: CanvasRenderingContext2D): void {
  softBlob(ctx, 64, 78, 18, 28, 0);
  softBlob(ctx, 64, 52, 14, 34, 0);
  softBlob(ctx, 64, 36, 9, 22, 0);
}

function paintFrost(ctx: CanvasRenderingContext2D): void {
  softBlob(ctx, 64, 64, 22, 22);
  ctx.save();
  ctx.translate(64, 64);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 48, Math.sin(a) * 48);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 22, Math.sin(a) * 22);
    ctx.lineTo(Math.cos(a + 0.45) * 34, Math.sin(a + 0.45) * 34);
    ctx.stroke();
  }
  ctx.restore();
  softBlob(ctx, 64, 64, 10, 10);
}

function paintVenom(ctx: CanvasRenderingContext2D): void {
  softBlob(ctx, 58, 70, 26, 20, 0.4);
  softBlob(ctx, 74, 54, 18, 24, -0.5);
  softBlob(ctx, 50, 48, 16, 18, 0.2);
}

function paintVoid(ctx: CanvasRenderingContext2D): void {
  softBlob(ctx, 64, 64, 40, 40);
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(64, 64, 14, 0, Math.PI * 2);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  softBlob(ctx, 64, 64, 7, 7);
}

function paintGold(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(64, 64);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 52 : 14;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 56);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalCompositeOperation = "source-over";
  softBlob(ctx, 64, 64, 12, 12);
}

const PAINT: Record<Exclude<CosmeticAuraId, "plain">, (ctx: CanvasRenderingContext2D) => void> = {
  ember: paintEmber,
  frost: paintFrost,
  venom: paintVenom,
  void: paintVoid,
  gold: paintGold,
};

export function getAuraWispTexture(id: CosmeticAuraId): THREE.Texture {
  const cached = texCache.get(id);
  if (cached) return cached;
  const ctx = typeof document !== "undefined" ? canvas2d() : null;
  const canvas = ctx?.canvas ?? document.createElement("canvas");
  if (ctx && id !== "plain") {
    ctx.clearRect(0, 0, SIZE, SIZE);
    PAINT[id](ctx);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  texCache.set(id, tex);
  return tex;
}

/** One compiled program, unique map per aura. Do not dispose. */
export function getAuraWispMaterial(id: CosmeticAuraId): THREE.ShaderMaterial {
  let mat = matCache.get(id);
  if (!mat) {
    mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: getAuraWispTexture(id) },
        uPxPerWorld: { value: 400 },
      },
      vertexShader: AURA_VS,
      fragmentShader: AURA_FS,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
      fog: false,
    });
    matCache.set(id, mat);
  }
  return mat;
}

const _drawBuf = new THREE.Vector2();

/** Perspective meters → pixels for the current view. Shared by all aura users in this canvas. */
export function setAuraWispProjection(
  mat: THREE.ShaderMaterial,
  camera: THREE.Camera,
  gl: THREE.WebGLRenderer,
): void {
  const uni = mat.uniforms.uPxPerWorld;
  if (!uni) return;
  gl.getDrawingBufferSize(_drawBuf);
  const height = Math.max(_drawBuf.y, 1);
  if (!(camera instanceof THREE.PerspectiveCamera)) {
    uni.value = height;
    return;
  }
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
  const zoom = Math.max(camera.zoom, 1e-6);
  const px = (height * zoom) / (2 * Math.max(tanHalf, 1e-6));
  uni.value = Number.isFinite(px) && px > 1 ? px : 800;
}

export function warmAuraWispMaterials(): THREE.ShaderMaterial[] {
  return (["ember", "frost", "venom", "void", "gold"] as const).map(getAuraWispMaterial);
}
