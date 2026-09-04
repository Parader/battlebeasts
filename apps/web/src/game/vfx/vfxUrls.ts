import { assetUrl } from "../assetUrl";

/** Shared spell VFX texture URLs (Electron-safe via assetUrl). */
export const VFX_FIRE_URL = assetUrl("assets/vfx/fire.png");
export const VFX_SMOKE_URL = assetUrl("assets/vfx/smoke.png");
export const VFX_LAVA_URL = assetUrl("assets/vfx/lava.png");
export const VFX_CIRCLE_URL = assetUrl("assets/vfx/circle.png");
export const VFX_CHAIN_URL = assetUrl("assets/vfx/chain-strip.png");
export const VFX_SHADOW_SPELL_URL = assetUrl("assets/vfx/shadow_spell_effects.png");
export const VFX_SPELL_EFFECTS_URL = assetUrl("assets/vfx/spell_effects.png");
export const VFX_WIND_STREAK_URL = assetUrl("textures/wind-streak.png");
export const VFX_BLOOMING_VINE_STREAK_URL = assetUrl("textures/blooming-vine-streak.png");
export const VFX_CRUSHING_SIGIL_FLARE_URL = assetUrl(
  "assets/vfx/crushing-sigil-flare.png",
);

/** Chest reveal mesh (match end / hub rewards). */
export const CHEST_GLB_URL = assetUrl("assets/vfx/chest.glb");

/**
 * @deprecated Prefer `collectSpellVfxAssets().textures` from `spellVfxAssets.ts`
 * — kept for call sites that still import the constant list.
 */
export const SPELL_VFX_TEXTURE_URLS = [
  VFX_FIRE_URL,
  VFX_SMOKE_URL,
  VFX_LAVA_URL,
  VFX_CIRCLE_URL,
  VFX_CHAIN_URL,
] as const;
