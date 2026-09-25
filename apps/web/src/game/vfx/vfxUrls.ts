import { assetUrl } from "../assetUrl";

/** Shared spell VFX texture URLs (Electron-safe via assetUrl). */
export const VFX_FIRE_URL = assetUrl("assets/vfx/fire.png");
export const VFX_SMOKE_URL = assetUrl("assets/vfx/smoke.png");
export const VFX_LAVA_URL = assetUrl("assets/vfx/lava.png");
export const VFX_CIRCLE_URL = assetUrl("assets/vfx/circle.png");
export const VFX_FLARE_SOFT_URL = assetUrl("assets/vfx/flare-soft.png");
export const VFX_FLARE_DISTORT_URL = assetUrl("assets/vfx/flare-distort.png");
export {
  VFX_PATTERN_URLS,
  PATTERN_IDS,
  type PatternId,
} from "./shaders/patternUrls";
export const VFX_CHAIN_URL = assetUrl("assets/vfx/chain-strip.png");
export const VFX_SHADOW_SPELL_URL = assetUrl("assets/vfx/shadow_spell_effects.png");
export const VFX_SPELL_EFFECTS_URL = assetUrl("assets/vfx/spell_effects.png");
export const VFX_WIND_STREAK_URL = assetUrl("textures/wind-streak.png");
export const VFX_BLOOMING_VINE_STREAK_URL = assetUrl("textures/blooming-vine-streak.png");
export const VFX_CRUSHING_SIGIL_FLARE_URL = assetUrl(
  "assets/vfx/crushing-sigil-flare.png",
);
export const VFX_AURA_EYES_URL = assetUrl("assets/vfx/aura-eyes.png");
export const VFX_AURA_EYES_URLS = {
  ember: VFX_AURA_EYES_URL,
  frost: assetUrl("assets/vfx/aura-eyes-frost.png"),
  venom: assetUrl("assets/vfx/aura-eyes-venom.png"),
  void: assetUrl("assets/vfx/aura-eyes-void.png"),
  gold: assetUrl("assets/vfx/aura-eyes-gold.png"),
} as const;

/** Ground sigils under Wave Assault pickup orbs. */
export const PICKUP_SIGIL_URLS: Record<string, string> = {
  heal: assetUrl("assets/vfx/orbs/sigil-heal.png"),
  energy: assetUrl("assets/vfx/orbs/sigil-energy.png"),
  speed: assetUrl("assets/vfx/orbs/sigil-speed.png"),
  power: assetUrl("assets/vfx/orbs/sigil-power.png"),
  absorb: assetUrl("assets/vfx/orbs/sigil-absorb.png"),
};

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
