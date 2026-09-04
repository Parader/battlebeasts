import * as THREE from "three";
import { getVfxCircleTexture } from "./materials/circlePoint";

/** Pixel crop rect in a texture atlas (top-left origin). */
export type AtlasFrame = { x: number; y: number; w: number; h: number };

export type AtlasSize = { readonly width: number; readonly height: number };

/** Crop one atlas cell onto a texture clone (Three.js UV space). */
export function applyAtlasFrame(
  tex: THREE.Texture,
  atlas: AtlasSize,
  frame: AtlasFrame,
): void {
  tex.repeat.set(frame.w / atlas.width, frame.h / atlas.height);
  tex.offset.set(frame.x / atlas.width, 1 - (frame.y + frame.h) / atlas.height);
}

/** Shrink crop a few px to avoid hard atlas gutter / neighbour bleed. */
export function applyAtlasFrameInset(
  tex: THREE.Texture,
  atlas: AtlasSize,
  frame: AtlasFrame,
  insetPx = 3,
): void {
  const inset = Math.max(0, insetPx);
  applyAtlasFrame(tex, atlas, {
    x: frame.x + inset,
    y: frame.y + inset,
    w: Math.max(1, frame.w - inset * 2),
    h: Math.max(1, frame.h - inset * 2),
  });
}

/** Mirror crop horizontally (flip sprite facing). */
export function applyAtlasFrameFlipH(
  tex: THREE.Texture,
  atlas: AtlasSize,
  frame: AtlasFrame,
): void {
  applyAtlasFrame(tex, atlas, frame);
  tex.repeat.x *= -1;
  tex.offset.x += frame.w / atlas.width;
}

/** Pick one of `count` horizontal tiles inside a grid cell. */
export function atlasTile(
  cell: AtlasFrame,
  index: number,
  count: number,
): AtlasFrame {
  const i = Math.max(0, Math.min(count - 1, Math.floor(index)));
  const tw = Math.floor(cell.w / count);
  return {
    x: cell.x + i * tw,
    y: cell.y,
    w: tw,
    h: cell.h,
  };
}

export type AtlasSpriteMaterialOpts = {
  opacity?: number;
  color?: string;
  blending?: THREE.Blending;
  toneMapped?: boolean;
  /** Radial alphaMap fade — hides square atlas crop edges. */
  softEdge?: boolean;
  insetPx?: number;
  flipH?: boolean;
};

export function cloneAtlasFrameMaterial(
  getTexture: () => THREE.Texture,
  atlas: AtlasSize,
  frame: AtlasFrame,
  opts?: AtlasSpriteMaterialOpts,
): THREE.MeshBasicMaterial {
  const tex = getTexture().clone();
  const crop =
    opts?.insetPx != null && opts.insetPx > 0
      ? {
          x: frame.x + opts.insetPx,
          y: frame.y + opts.insetPx,
          w: Math.max(1, frame.w - opts.insetPx * 2),
          h: Math.max(1, frame.h - opts.insetPx * 2),
        }
      : frame;
  if (opts?.flipH) applyAtlasFrameFlipH(tex, atlas, crop);
  else applyAtlasFrame(tex, atlas, crop);

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: opts?.color ?? "#ffffff",
    transparent: true,
    opacity: opts?.opacity ?? 1,
    depthWrite: false,
    toneMapped: opts?.toneMapped ?? false,
    blending: opts?.blending ?? THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  if (opts?.softEdge) {
    mat.alphaMap = getVfxCircleTexture();
  }
  return mat;
}
