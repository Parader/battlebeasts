import { assetUrl } from "../assetUrl";
import { VOLCANO_GLB_URL } from "./volcanoAsset";
import { SHROOM_GREEN_GLB_URL, SHROOM_RED_GLB_URL } from "./shroomAsset";
import {
  CHEST_GLB_URL,
  VFX_CHAIN_URL,
  VFX_CIRCLE_URL,
  VFX_FIRE_URL,
  VFX_LAVA_URL,
  VFX_SMOKE_URL,
  VFX_SHADOW_SPELL_URL,
  VFX_SPELL_EFFECTS_URL,
  VFX_WIND_STREAK_URL,
} from "./vfxUrls";
import { getRegisteredSpellVfxAssets } from "./profiles/registry";

/**
 * Core spell VFX assets always decoded/preloaded before the loading gate lifts.
 *
 * When adding a spell with **new** textures or GLBs:
 * 1. Put URLs on that ability's `AbilityVfxProfile.assets`, **or**
 * 2. Append here if shared across many spells (like fire.png).
 *
 * `collectSpellVfxAssets()` merges both — `prepareGameAssets` / texture prime
 * consume that list so first cast never hitch-loads.
 */

export type SpellVfxAssets = {
  textures: readonly string[];
  glbs: readonly string[];
};

/** Shared atlases bound into material caches (see primeSpellTextures). */
export const CORE_SPELL_VFX_TEXTURES = [
  VFX_FIRE_URL,
  VFX_SMOKE_URL,
  VFX_LAVA_URL,
  VFX_CIRCLE_URL,
  VFX_CHAIN_URL,
  VFX_SHADOW_SPELL_URL,
  VFX_SPELL_EFFECTS_URL,
  VFX_WIND_STREAK_URL,
] as const;

/** Shared meshes used by multiple spells / UI. */
export const CORE_SPELL_VFX_GLBS = [
  VOLCANO_GLB_URL,
  SHROOM_GREEN_GLB_URL,
  SHROOM_RED_GLB_URL,
  CHEST_GLB_URL,
] as const;

/** Re-export helper so callers can resolve public paths consistently. */
export { assetUrl };

export function collectSpellVfxAssets(): SpellVfxAssets {
  const textures = new Set<string>(CORE_SPELL_VFX_TEXTURES);
  const glbs = new Set<string>(CORE_SPELL_VFX_GLBS);

  for (const extra of getRegisteredSpellVfxAssets()) {
    for (const url of extra.textures ?? []) textures.add(url);
    for (const url of extra.glbs ?? []) glbs.add(url);
  }

  return {
    textures: [...textures],
    glbs: [...glbs],
  };
}
