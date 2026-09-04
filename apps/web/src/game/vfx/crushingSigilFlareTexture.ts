import * as THREE from "three";
import { VFX_CRUSHING_SIGIL_FLARE_URL } from "./vfxUrls";

let flareTex: THREE.Texture | null = null;

/** Soft violet energy flare for Crushing Sigil burst sprites. */
export function getCrushingSigilFlareTexture(): THREE.Texture {
  if (!flareTex) {
    flareTex = new THREE.TextureLoader().load(VFX_CRUSHING_SIGIL_FLARE_URL);
    flareTex.colorSpace = THREE.SRGBColorSpace;
    flareTex.needsUpdate = true;
  }
  return flareTex;
}

/** Install a fully-decoded texture from the loading gate. */
export function setCrushingSigilFlareTexture(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  flareTex = tex;
}
