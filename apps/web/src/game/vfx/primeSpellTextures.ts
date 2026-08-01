import * as THREE from "three";
import { setFireTexture } from "./components/FireParticleField";
import { setLavaTexture } from "./components/LavaGroundStrip";
import { setChainTexture } from "./materials/chainTexture";
import { setCircleTexture } from "./materials/circlePoint";
import { setSmokeTexture } from "./smokeTexture";
import {
  SPELL_VFX_TEXTURE_URLS,
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
 * Decode every spell/ground VFX texture into the same TextureLoader caches
 * the effects use at runtime (not drei's useTexture cache).
 */
export async function preloadSpellVfxTextures(): Promise<void> {
  try {
    const [fire, smoke, lava, circle, chain] = await Promise.all([
      loadTexture(VFX_FIRE_URL),
      loadTexture(VFX_SMOKE_URL),
      loadTexture(VFX_LAVA_URL),
      loadTexture(VFX_CIRCLE_URL),
      loadTexture(VFX_CHAIN_URL),
    ]);

    setFireTexture(VFX_FIRE_URL, fire);
    setSmokeTexture(smoke);
    setLavaTexture(lava);
    setCircleTexture(circle);
    setChainTexture(chain);

    // Keep list authoritative — fail loudly if a URL was added without a setter.
    if (SPELL_VFX_TEXTURE_URLS.length !== 5) {
      console.warn(
        `[vfx] SPELL_VFX_TEXTURE_URLS length ${SPELL_VFX_TEXTURE_URLS.length} — update primeSpellTextures`,
      );
    }
  } finally {
    // Always unblock GPU warmup (even on fetch failure).
    markPrimed();
  }
}
