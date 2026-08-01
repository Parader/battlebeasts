import { assetUrl } from "../assetUrl";

/** Shared spell VFX texture URLs (Electron-safe via assetUrl). */
export const VFX_FIRE_URL = assetUrl("assets/vfx/fire.png");
export const VFX_SMOKE_URL = assetUrl("assets/vfx/smoke.png");
export const VFX_LAVA_URL = assetUrl("assets/vfx/lava.png");
export const VFX_CIRCLE_URL = assetUrl("assets/vfx/circle.png");
export const VFX_CHAIN_URL = assetUrl("assets/vfx/chain-strip.png");

/** Chest reveal mesh (match end / hub rewards). */
export const CHEST_GLB_URL = assetUrl("assets/vfx/chest.glb");

/** Every spell/ground VFX texture that must be decoded before play. */
export const SPELL_VFX_TEXTURE_URLS = [
  VFX_FIRE_URL,
  VFX_SMOKE_URL,
  VFX_LAVA_URL,
  VFX_CIRCLE_URL,
  VFX_CHAIN_URL,
] as const;
