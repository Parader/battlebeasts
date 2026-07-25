import * as THREE from "three";
import {
  normalizeCosmeticPattern,
  normalizeCosmeticPatternColor,
  type CosmeticPatternId,
} from "@battlebeasts/shared";

const SIZE = 512;
const cache = new Map<string, THREE.CanvasTexture>();

type Rgb = { r: number; g: number; b: number };

function parseHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(c: Rgb, a = 1): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function shade(c: Rgb, factor: number): Rgb {
  // factor < 1 darkens, > 1 lightens toward white
  if (factor >= 1) {
    const t = Math.min(1, factor - 1);
    return mix(c, { r: 255, g: 255, b: 255 }, t);
  }
  return { r: Math.round(c.r * factor), g: Math.round(c.g * factor), b: Math.round(c.b * factor) };
}

/** Shared albedo for creature hide patterns (UV-mapped on Beta_Surface). */
export function getCreaturePatternTexture(
  patternId: string | undefined | null,
  patternColor?: string | null,
  hideColor?: string | null,
): THREE.CanvasTexture | null {
  const id = normalizeCosmeticPattern(patternId);
  if (id === "plain") return null;

  const ink = normalizeCosmeticPatternColor(patternColor);
  // Hide tint is baked into the base so material.color can stay white.
  const hide = typeof hideColor === "string" && /^#[0-9a-fA-F]{6}$/.test(hideColor)
    ? hideColor
    : "#e5e7eb";
  const key = `${id}|${ink}|${hide}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  paintPattern(ctx, id, parseHex(ink), parseHex(hide));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  const repeat = patternRepeat(id);
  tex.repeat.set(repeat, repeat);

  cache.set(key, tex);
  return tex;
}

function patternRepeat(id: CosmeticPatternId): number {
  switch (id) {
    case "scales":
    case "plates":
      return 3.2;
    case "stripes":
      return 2.4;
    case "spots":
      return 2.8;
    case "mottle":
      return 2.2;
    case "serpent":
      return 2.6;
    default:
      return 1;
  }
}

function paintPattern(
  ctx: CanvasRenderingContext2D,
  id: CosmeticPatternId,
  ink: Rgb,
  hide: Rgb,
) {
  const w = SIZE;
  const h = SIZE;
  // Bake hide tint as the base so pattern ink stays true (no material multiply).
  ctx.fillStyle = rgba(mix(hide, { r: 255, g: 255, b: 255 }, 0.18));
  ctx.fillRect(0, 0, w, h);

  switch (id) {
    case "scales":
      paintScales(ctx, w, h, ink, hide);
      break;
    case "stripes":
      paintStripes(ctx, w, h, ink, hide);
      break;
    case "spots":
      paintSpots(ctx, w, h, ink, hide);
      break;
    case "plates":
      paintPlates(ctx, w, h, ink, hide);
      break;
    case "mottle":
      paintMottle(ctx, w, h, ink, hide);
      break;
    case "serpent":
      paintSerpent(ctx, w, h, ink, hide);
      break;
    default:
      break;
  }
}

function paintScales(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ink: Rgb,
  hide: Rgb,
) {
  const rowH = 28;
  const colW = 32;
  const light = mix(ink, hide, 0.35);
  const mid = mix(ink, hide, 0.12);
  const dark = shade(ink, 0.55);
  for (let row = -1; row < h / rowH + 2; row++) {
    const y = row * rowH;
    const offset = row % 2 === 0 ? 0 : colW * 0.5;
    for (let col = -1; col < w / colW + 2; col++) {
      const x = col * colW + offset;
      ctx.beginPath();
      ctx.ellipse(x + colW * 0.5, y + rowH * 0.55, colW * 0.42, rowH * 0.55, 0, 0, Math.PI * 2);
      ctx.fillStyle = rgba(row % 2 === 0 ? mid : ink);
      ctx.fill();
      ctx.strokeStyle = rgba(dark);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x + colW * 0.42, y + rowH * 0.4, colW * 0.18, rowH * 0.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = rgba(light, 0.5);
      ctx.fill();
    }
  }
}

function paintStripes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ink: Rgb,
  hide: Rgb,
) {
  const band = 36;
  const soft = mix(ink, hide, 0.55);
  for (let x = -band; x < w + band; x += band) {
    ctx.fillStyle = Math.floor(x / band) % 2 === 0 ? rgba(ink) : rgba(soft, 0.55);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + band * 0.62, 0);
    ctx.lineTo(x + band * 0.42, h);
    ctx.lineTo(x - band * 0.2, h);
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.fillStyle = rgba(ink, 0.14);
    ctx.fillRect(x, y, 3, 8);
  }
}

function paintSpots(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ink: Rgb,
  hide: Rgb,
) {
  ctx.fillStyle = rgba(mix(hide, { r: 255, g: 255, b: 255 }, 0.12));
  ctx.fillRect(0, 0, w, h);
  const core = shade(ink, 0.65);
  const fill = mix(hide, { r: 255, g: 255, b: 255 }, 0.25);
  const spots = 55;
  for (let i = 0; i < spots; i++) {
    const x = (i * 97) % w;
    const y = (i * 53) % h;
    const r = 10 + (i % 7) * 2.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(ink);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.15, y - r * 0.1, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = rgba(fill);
    ctx.fill();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + i * 0.2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 1.15, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = rgba(core);
      ctx.fill();
    }
  }
}

function paintPlates(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ink: Rgb,
  hide: Rgb,
) {
  const size = 36;
  const hHex = size * Math.sqrt(3);
  const light = mix(ink, hide, 0.4);
  const mid = mix(ink, hide, 0.15);
  const edge = shade(ink, 0.5);
  for (let row = -1; row < h / (hHex * 0.75) + 2; row++) {
    for (let col = -1; col < w / size + 2; col++) {
      const x = col * size * 1.5 + (row % 2 === 0 ? 0 : size * 0.75);
      const y = row * hHex * 0.75;
      drawHex(ctx, x, y, size * 0.48, rgba(row % 2 === 0 ? light : mid), rgba(edge));
    }
  }
}

function drawHex(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string,
  stroke: string,
) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function paintMottle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ink: Rgb,
  hide: Rgb,
) {
  ctx.fillStyle = rgba(mix(hide, { r: 255, g: 255, b: 255 }, 0.12));
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 1.5 + Math.random() * 6;
    const t = 0.35 + Math.random() * 0.55;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(mix(ink, hide, 1 - t), 0.35 + Math.random() * 0.4);
    ctx.fill();
  }
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 12 + Math.random() * 28;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(ink, 0.5));
    g.addColorStop(1, rgba(ink, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintSerpent(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ink: Rgb,
  hide: Rgb,
) {
  ctx.fillStyle = rgba(mix(hide, { r: 255, g: 255, b: 255 }, 0.1));
  ctx.fillRect(0, 0, w, h);
  const amp = 28;
  const step = 18;
  const soft = mix(ink, hide, 0.45);
  for (let y = -40; y < h + 40; y += step) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const yy = y + Math.sin((x / w) * Math.PI * 4 + y * 0.08) * amp;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = Math.floor(y / step) % 2 === 0 ? rgba(ink) : rgba(soft, 0.65);
    ctx.lineWidth = step * 0.55;
    ctx.stroke();
  }
  const core = shade(ink, 0.55);
  for (let i = 0; i < 24; i++) {
    const x = ((i * 137) % (w - 40)) + 20;
    const y = ((i * 89) % (h - 40)) + 20;
    ctx.beginPath();
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x + 10, y);
    ctx.lineTo(x, y + 14);
    ctx.lineTo(x - 10, y);
    ctx.closePath();
    ctx.fillStyle = rgba(core, 0.75);
    ctx.fill();
  }
}
