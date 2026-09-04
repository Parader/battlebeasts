import * as THREE from "three";
import { VFX_SPELL_EFFECTS_URL } from "./vfxUrls";
import {
  applyAtlasFrame,
  atlasTile,
  cloneAtlasFrameMaterial,
  type AtlasFrame,
  type AtlasSize,
} from "./atlasFrame";

/**
 * General-purpose spell VFX atlas (`spell_effects.png`).
 * 3×5 labeled grid — impact, trails, orbs, ground decals, cast flashes, etc.
 */
export const SPELL_EFFECTS_ATLAS: AtlasSize = { width: 1536, height: 1024 };

/** Grid gutters — matches the labeled sheet layout. */
const COL_X = [16, 528, 1040] as const;
const COL_W = 512;
const ROW_Y = [24, 228, 432, 636, 840] as const;
const ROW_H = ROW_Y[1]! - ROW_Y[0]!;

export type SpellEffectsFrame = AtlasFrame;

/** Full grid cell (`col` 0–2, `row` 0–4). Row labels on the PNG:
 * 0 impact · slash · rings
 * 1 beams · trails · ground decals
 * 2 smoke · orbs · portals
 * 3 shields · runes · particles
 * 4 crystals · distortion · cast flashes
 */
export function spellEffectsCell(col: 0 | 1 | 2, row: 0 | 1 | 2 | 3 | 4): SpellEffectsFrame {
  return {
    x: COL_X[col],
    y: ROW_Y[row],
    w: COL_W,
    h: ROW_H,
  };
}

/** Horizontal tile inside a cell (most rows ship 4 variants). */
export function spellEffectsTile(
  col: 0 | 1 | 2,
  row: 0 | 1 | 2 | 3 | 4,
  index: number,
  count = 4,
): SpellEffectsFrame {
  return atlasTile(spellEffectsCell(col, row), index, count);
}

/** Curated picks — tweak indices after art passes. */
export const SPELL_FX = {
  impact: {
    burst: spellEffectsTile(0, 0, 0),
    burstAlt: spellEffectsTile(0, 0, 1),
    ring: spellEffectsTile(2, 0, 1),
  },
  slash: {
    arc: spellEffectsTile(1, 0, 0),
    sweep: spellEffectsTile(1, 0, 2),
  },
  beam: {
    bolt: spellEffectsTile(0, 1, 0),
    tether: spellEffectsTile(0, 1, 2),
    lightning: spellEffectsTile(0, 1, 3),
  },
  trail: {
    streak: spellEffectsTile(1, 1, 0),
    comet: spellEffectsTile(1, 1, 1),
    wisp: spellEffectsTile(1, 1, 3),
  },
  ground: {
    circle: spellEffectsTile(2, 1, 0),
    rune: spellEffectsTile(2, 1, 1),
    pillar: spellEffectsTile(2, 1, 3),
  },
  smoke: {
    puff: spellEffectsTile(0, 2, 0),
    cloud: spellEffectsTile(0, 2, 2),
  },
  orb: {
    core: spellEffectsTile(1, 2, 1),
    bubble: spellEffectsTile(1, 2, 2),
    charged: spellEffectsTile(1, 2, 3),
  },
  portal: {
    vortex: spellEffectsTile(2, 2, 1),
    spiral: spellEffectsTile(2, 2, 3),
  },
  shield: {
    dome: spellEffectsTile(0, 3, 0),
    hex: spellEffectsTile(0, 3, 2),
  },
  rune: {
    glyph: spellEffectsTile(1, 3, 0),
    diamond: spellEffectsTile(1, 3, 2),
  },
  particle: {
    star: spellEffectsTile(2, 3, 0),
    glint: spellEffectsTile(2, 3, 3),
  },
  crystal: {
    shard: spellEffectsTile(0, 4, 1),
  },
  cast: {
    flash: spellEffectsTile(2, 4, 0),
    handFocus: spellEffectsTile(2, 4, 2),
  },
} as const;

/** Soul Mark stack glyphs — rune row, growing symbol per stack (1–3). */
export const SOUL_MARK_GLYPH_FRAMES: readonly SpellEffectsFrame[] = [
  spellEffectsTile(1, 3, 0),
  spellEffectsTile(1, 3, 1),
  spellEffectsTile(1, 3, 2),
] as const;

export function soulMarkGlyphForStacks(stacks: number): SpellEffectsFrame | null {
  const s = Math.floor(stacks);
  if (s <= 0) return null;
  return SOUL_MARK_GLYPH_FRAMES[Math.min(SOUL_MARK_GLYPH_FRAMES.length - 1, s - 1)]!;
}

let atlasTex: THREE.Texture | null = null;

export function getSpellEffectsTexture(): THREE.Texture {
  if (!atlasTex) {
    atlasTex = new THREE.TextureLoader().load(VFX_SPELL_EFFECTS_URL);
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    atlasTex.needsUpdate = true;
  }
  return atlasTex;
}

export function setSpellEffectsTexture(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  atlasTex = tex;
}

export function applySpellEffectsFrame(tex: THREE.Texture, frame: SpellEffectsFrame): void {
  applyAtlasFrame(tex, SPELL_EFFECTS_ATLAS, frame);
}

export function cloneSpellEffectsMaterial(
  frame: SpellEffectsFrame,
  opts?: Parameters<typeof cloneAtlasFrameMaterial>[3],
): THREE.MeshBasicMaterial {
  return cloneAtlasFrameMaterial(
    getSpellEffectsTexture,
    SPELL_EFFECTS_ATLAS,
    frame,
    opts,
  );
}
