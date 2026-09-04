import * as THREE from "three";
import { VFX_SHADOW_SPELL_URL } from "./vfxUrls";
import {
  applyAtlasFrame,
  cloneAtlasFrameMaterial,
  type AtlasFrame,
} from "./atlasFrame";

/** `shadow_spell_effects.png` — 1536×1024 shadow/psychic atlas. */
export const SHADOW_SPELL_ATLAS = { width: 1536, height: 1024 } as const;

export type ShadowSpellFrame = AtlasFrame;

/** Ground sigils — grow with Soul Mark stacks (left → right). */
export const SHADOW_SIGIL_FRAMES: readonly ShadowSpellFrame[] = [
  { x: 568, y: 436, w: 234, h: 183 },
  { x: 802, y: 436, w: 234, h: 183 },
  { x: 1036, y: 436, w: 234, h: 183 },
  { x: 1270, y: 436, w: 234, h: 183 },
] as const;

/** Compact shadow bolt (top row). */
export const SHADOW_PROJECTILE_FRAME: ShadowSpellFrame = {
  x: 430,
  y: 42,
  w: 269,
  h: 237,
};

/** Large shadow comet (top-left) — primary projectile read. */
export const SHADOW_PROJECTILE_LARGE_FRAME: ShadowSpellFrame = {
  x: 34,
  y: 34,
  w: 385,
  h: 245,
};

/** Radial soul burst (middle-left). */
export const SHADOW_BURST_FRAME: ShadowSpellFrame = {
  x: 180,
  y: 280,
  w: 299,
  h: 239,
};

/** Soft dissipating cloud (middle-left). */
export const SHADOW_MIST_FRAME: ShadowSpellFrame = {
  x: 480,
  y: 356,
  w: 70,
  h: 163,
};

let atlasTex: THREE.Texture | null = null;

export function getShadowSpellTexture(): THREE.Texture {
  if (!atlasTex) {
    atlasTex = new THREE.TextureLoader().load(VFX_SHADOW_SPELL_URL);
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    atlasTex.needsUpdate = true;
  }
  return atlasTex;
}

export function setShadowSpellTexture(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  atlasTex = tex;
}

/** Crop one atlas cell onto `tex` (top-left pixel coords). */
export function applyShadowSpellFrame(tex: THREE.Texture, frame: ShadowSpellFrame): void {
  applyAtlasFrame(tex, SHADOW_SPELL_ATLAS, frame);
}

/** Stack index 1–3 → sigil frame; returns null when stacks <= 0. */
export function sigilFrameForStacks(stacks: number): ShadowSpellFrame | null {
  const s = Math.floor(stacks);
  if (s <= 0) return null;
  const idx = Math.min(SHADOW_SIGIL_FRAMES.length - 1, s - 1);
  return SHADOW_SIGIL_FRAMES[idx]!;
}

export function cloneShadowFrameMaterial(
  frame: ShadowSpellFrame,
  opts?: { opacity?: number; color?: string; blending?: THREE.Blending },
): THREE.MeshBasicMaterial {
  return cloneAtlasFrameMaterial(getShadowSpellTexture, SHADOW_SPELL_ATLAS, frame, opts);
}
