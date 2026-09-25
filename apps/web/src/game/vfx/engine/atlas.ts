import * as THREE from "three";
import { VFX_CIRCLE_URL, VFX_FIRE_URL, VFX_SMOKE_URL, VFX_WIND_STREAK_URL } from "../vfxUrls";
import { setAllBatchMaps } from "./billboardMaterial";
import type { AtlasUv } from "./types";

/**
 * 4×2 atlas (WebGL UV, origin bottom-left).
 * Top row: fire · spark · ice · leaf
 * Bottom: smoke · wind · void · glint
 */
const COL = 0.25;
const ROW = 0.5;

export const ATLAS_UV = {
  fire: [0, ROW, COL, ROW],
  spark: [COL, ROW, COL, ROW],
  ice: [COL * 2, ROW, COL, ROW],
  leaf: [COL * 3, ROW, COL, ROW],
  /** @deprecated lightning uses ribbons; kept as leaf alias */
  bolt: [COL * 3, ROW, COL, ROW],
  smoke: [0, 0, COL, ROW],
  wind: [COL, 0, COL, ROW],
  void: [COL * 2, 0, COL, ROW],
  glint: [COL * 3, 0, COL, ROW],
} as const satisfies Record<string, AtlasUv>;

let atlasTex: THREE.CanvasTexture | null = null;
let loading = false;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`atlas image failed: ${url}`));
    img.src = url;
  });
}

function cellOrigin(col: number, rowFromTop: number, cellW: number, cellH: number) {
  return { x: col * cellW, y: rowFromTop * cellH, w: cellW, h: cellH };
}

function drawImageCell(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  col: number,
  rowFromTop: number,
  cellW: number,
  cellH: number,
): void {
  const { x, y, w, h } = cellOrigin(col, rowFromTop, cellW, cellH);
  ctx.drawImage(img, x, y, w, h);
}

/** Hexagonal snowflake — sharp arms, not a bubble. */
function drawSnowflake(
  ctx: CanvasRenderingContext2D,
  col: number,
  rowFromTop: number,
  cellW: number,
  cellH: number,
): void {
  const { x, y, w, h } = cellOrigin(col, rowFromTop, cellW, cellH);
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  const r = Math.min(w, h) * 0.42;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let arm = 0; arm < 6; arm++) {
    ctx.save();
    ctx.rotate((arm * Math.PI) / 3);
    ctx.lineWidth = Math.max(2, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r);
    ctx.stroke();
    // side branches
    ctx.lineWidth = Math.max(1.5, r * 0.045);
    for (const t of [0.35, 0.58, 0.78]) {
      const yy = -r * t;
      const br = r * (0.22 - t * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(-br, yy - br * 0.35);
      ctx.moveTo(0, yy);
      ctx.lineTo(br, yy - br * 0.35);
      ctx.stroke();
    }
    ctx.restore();
  }
  // bright core
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.18);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Soft leaf silhouette (elemental-sandbox LEAF shape) — tip up, stem down. */
function drawLeaf(
  ctx: CanvasRenderingContext2D,
  col: number,
  rowFromTop: number,
  cellW: number,
  cellH: number,
): void {
  const { x, y, w, h } = cellOrigin(col, rowFromTop, cellW, cellH);
  const cx = x + w * 0.5;
  const cy = y + h * 0.52;
  const hh = h * 0.4;
  const hw = w * 0.22;
  ctx.save();
  ctx.translate(cx, cy);
  // Soft body: two mirrored beziers (pointy tip, rounded base).
  ctx.beginPath();
  ctx.moveTo(0, -hh);
  ctx.bezierCurveTo(hw * 1.15, -hh * 0.55, hw * 1.25, hh * 0.15, 0, hh);
  ctx.bezierCurveTo(-hw * 1.25, hh * 0.15, -hw * 1.15, -hh * 0.55, 0, -hh);
  ctx.closePath();
  const fill = ctx.createRadialGradient(0, -hh * 0.2, 0, 0, 0, hh * 1.1);
  fill.addColorStop(0, "rgba(255,255,255,1)");
  fill.addColorStop(0.55, "rgba(255,255,255,0.92)");
  fill.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = fill;
  ctx.fill();
  // Center vein (slightly darker cut so it reads under additive tint).
  ctx.globalCompositeOperation = "destination-out";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(1.5, w * 0.012);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, -hh * 0.85);
  ctx.lineTo(0, hh * 0.75);
  ctx.stroke();
  // Side veins
  ctx.lineWidth = Math.max(1, w * 0.008);
  for (const t of [-0.35, 0.05, 0.4]) {
    const yy = t * hh;
    const spread = hw * (0.55 - Math.abs(t) * 0.2);
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.quadraticCurveTo(spread * 0.4, yy - hh * 0.08, spread, yy - hh * 0.12);
    ctx.moveTo(0, yy);
    ctx.quadraticCurveTo(-spread * 0.4, yy - hh * 0.08, -spread, yy - hh * 0.12);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  // Soft stem tip
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = Math.max(1.5, w * 0.01);
  ctx.beginPath();
  ctx.moveTo(0, hh * 0.85);
  ctx.lineTo(0, hh * 1.05);
  ctx.stroke();
  ctx.restore();
}

/** Soft elongated wind wisp — no hard scratch lines. */
function drawWindRibbon(
  ctx: CanvasRenderingContext2D,
  col: number,
  rowFromTop: number,
  cellW: number,
  cellH: number,
  streakImg?: HTMLImageElement | null,
): void {
  const { x, y, w, h } = cellOrigin(col, rowFromTop, cellW, cellH);
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  ctx.save();
  // Soft horizontal oval body
  for (let i = 0; i < 3; i++) {
    const yy = cy + (i - 1) * h * 0.1;
    const rx = w * (0.42 - i * 0.04);
    const ry = h * (0.1 - i * 0.015);
    const g = ctx.createRadialGradient(cx, yy, 0, cx, yy, rx);
    g.addColorStop(0, `rgba(255,255,255,${0.55 - i * 0.12})`);
    g.addColorStop(0.45, `rgba(255,255,255,${0.28 - i * 0.06})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, yy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Optional soft wash from streak sheet (low opacity)
  if (streakImg) {
    ctx.globalAlpha = 0.35;
    const sy = streakImg.height * 0.3;
    const sh = streakImg.height * 0.4;
    ctx.drawImage(streakImg, 0, sy, streakImg.width, sh, x, y + h * 0.28, w, h * 0.44);
    ctx.globalAlpha = 1;
  }
  // Soft taper tips
  const tip = ctx.createLinearGradient(x, cy, x + w, cy);
  tip.addColorStop(0, "rgba(255,255,255,0)");
  tip.addColorStop(0.2, "rgba(255,255,255,0.2)");
  tip.addColorStop(0.5, "rgba(255,255,255,0.35)");
  tip.addColorStop(0.8, "rgba(255,255,255,0.2)");
  tip.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = tip;
  ctx.fillRect(x, cy - h * 0.04, w, h * 0.08);
  ctx.restore();
}

/**
 * Void rift: dark core + bright torn rim.
 * Reads as a hole in space under alpha; rim pops under additive.
 */
function drawVoidRift(
  ctx: CanvasRenderingContext2D,
  col: number,
  rowFromTop: number,
  cellW: number,
  cellH: number,
): void {
  const { x, y, w, h } = cellOrigin(col, rowFromTop, cellW, cellH);
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  const rx = w * 0.38;
  const ry = h * 0.28;
  ctx.save();
  // outer corona
  const corona = ctx.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.2, cx, cy, Math.max(rx, ry) * 1.15);
  corona.addColorStop(0, "rgba(255,255,255,0)");
  corona.addColorStop(0.45, "rgba(255,255,255,0)");
  corona.addColorStop(0.72, "rgba(255,255,255,0.95)");
  corona.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = corona;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 1.15, ry * 1.25, 0.35, 0, Math.PI * 2);
  ctx.fill();
  // black hole core (alpha batches use this as dark mass)
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(rx, ry));
  core.addColorStop(0, "rgba(0,0,0,1)");
  core.addColorStop(0.55, "rgba(0,0,0,0.92)");
  core.addColorStop(0.85, "rgba(40,0,60,0.5)");
  core.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.85, ry * 0.9, 0.35, 0, Math.PI * 2);
  ctx.fill();
  // tear slash
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = Math.max(2, w * 0.02);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.95, cy + ry * 0.15);
  ctx.quadraticCurveTo(cx, cy - ry * 0.35, cx + rx * 0.95, cy - ry * 0.1);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = Math.max(1, w * 0.012);
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.7, cy + ry * 0.45);
  ctx.quadraticCurveTo(cx + rx * 0.1, cy + ry * 0.1, cx + rx * 0.75, cy + ry * 0.35);
  ctx.stroke();
  ctx.restore();
}

/** Tiny star glint for ice/lightning accents. */
function drawGlint(
  ctx: CanvasRenderingContext2D,
  col: number,
  rowFromTop: number,
  cellW: number,
  cellH: number,
): void {
  const { x, y, w, h } = cellOrigin(col, rowFromTop, cellW, cellH);
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  const r = Math.min(w, h) * 0.4;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineCap = "round";
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 4);
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.45, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = i % 2 === 0 ? Math.max(2, r * 0.08) : Math.max(1, r * 0.04);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.stroke();
    ctx.restore();
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.2);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Pack fire / spark / smoke + procedural ice · leaf · wind · void · glint. */
export function primeParticleAtlas(): void {
  if (atlasTex || loading) return;
  loading = true;
  void (async () => {
    try {
      const [fire, circle, smoke, windStreak] = await Promise.all([
        loadImage(VFX_FIRE_URL),
        loadImage(VFX_CIRCLE_URL),
        loadImage(VFX_SMOKE_URL),
        loadImage(VFX_WIND_STREAK_URL).catch(() => null),
      ]);
      const sizeW = 2048;
      const sizeH = 1024;
      const cellW = sizeW / 4;
      const cellH = sizeH / 2;
      const canvas = document.createElement("canvas");
      canvas.width = sizeW;
      canvas.height = sizeH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, sizeW, sizeH);
      // Top row (canvas Y top → UV bottom-left row 1)
      drawImageCell(ctx, fire, 0, 0, cellW, cellH);
      drawImageCell(ctx, circle, 1, 0, cellW, cellH);
      drawSnowflake(ctx, 2, 0, cellW, cellH);
      drawLeaf(ctx, 3, 0, cellW, cellH);
      // Bottom row
      drawImageCell(ctx, smoke, 0, 1, cellW, cellH);
      drawWindRibbon(ctx, 1, 1, cellW, cellH, windStreak);
      drawVoidRift(ctx, 2, 1, cellW, cellH);
      drawGlint(ctx, 3, 1, cellW, cellH);

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      atlasTex = tex;
      setAllBatchMaps(tex);
    } catch {
      // Placeholder maps stay white; particles still simulate.
    } finally {
      loading = false;
    }
  })();
}

/** Force rebuild (lab hot-reload / recipe iteration). */
export function resetParticleAtlas(): void {
  if (atlasTex) {
    atlasTex.dispose();
    atlasTex = null;
  }
  loading = false;
}

export function getParticleAtlas(): THREE.Texture | null {
  return atlasTex;
}
