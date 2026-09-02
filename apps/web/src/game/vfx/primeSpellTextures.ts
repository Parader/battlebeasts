import * as THREE from "three";
import { setFireTexture } from "./components/FireParticleField";
import { setLavaTexture } from "./components/LavaGroundStrip";
import { setChainTexture } from "./materials/chainTexture";
import { setCircleTexture } from "./materials/circlePoint";
import { setSmokeTexture } from "./smokeTexture";
import { collectSpellVfxAssets } from "./spellVfxAssets";
import {
  VFX_CHAIN_URL,
  VFX_CIRCLE_URL,
  VFX_FIRE_URL,
  VFX_LAVA_URL,
  VFX_SMOKE_URL,
} from "./vfxUrls";

let primed = false;
const waiters: Array<() => void> = [];

export function areSpellTexturesPrimed(): boolean {
  return primed;
}

/** Resolves once preloadSpellVfxTextures finishes (or immediately if already primed). */
export function whenSpellTexturesPrimed(): Promise<void> {
  if (primed) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

function markPrimed(): void {
  if (primed) return;
  primed = true;
  for (const w of waiters.splice(0)) w();
}

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

/**
 * Decode every spell/ground VFX texture into TextureLoader caches before play.
 * Core atlases also bind into shared material setters; profile-only textures
 * are still decoded so first cast does not hitch-fetch.
 */
export async function preloadSpellVfxTextures(): Promise<void> {
  try {
    const { textures } = collectSpellVfxAssets();
    const loaded = await Promise.all(
      textures.map(async (url) => [url, await loadTexture(url)] as const),
    );
    const byUrl = new Map(loaded);

    const fire = byUrl.get(VFX_FIRE_URL);
    const smoke = byUrl.get(VFX_SMOKE_URL);
    const lava = byUrl.get(VFX_LAVA_URL);
    const circle = byUrl.get(VFX_CIRCLE_URL);
    const chain = byUrl.get(VFX_CHAIN_URL);

    if (fire) setFireTexture(VFX_FIRE_URL, fire);
    if (smoke) setSmokeTexture(smoke);
    if (lava) setLavaTexture(lava);
    if (circle) setCircleTexture(circle);
    if (chain) setChainTexture(chain);
  } finally {
    // Always unblock GPU warmup (even on fetch failure).
    markPrimed();
  }
}
