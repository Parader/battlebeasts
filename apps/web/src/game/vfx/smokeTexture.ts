import * as THREE from "three";
import { VFX_SMOKE_URL } from "./vfxUrls";

let smokeTex: THREE.Texture | null = null;

/** Shared smoke.png for poison cloud / fireball burn ground discs. */
export function getSmokeTexture(): THREE.Texture {
  if (!smokeTex) {
    smokeTex = new THREE.TextureLoader().load(VFX_SMOKE_URL);
    smokeTex.colorSpace = THREE.SRGBColorSpace;
    smokeTex.needsUpdate = true;
  }
  return smokeTex;
}

/** Install a fully-decoded texture from the loading gate. */
export function setSmokeTexture(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  smokeTex = tex;
}
