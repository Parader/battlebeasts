import * as THREE from "three";
import { VFX_BLOOMING_VINE_STREAK_URL } from "./vfxUrls";

let vineTex: THREE.Texture | null = null;

/** Shared Blooming Path vine-streak map. Do not use useLoader — it suspends the canvas. */
export function getBloomingVineStreakTexture(): THREE.Texture {
  if (!vineTex) {
    vineTex = new THREE.TextureLoader().load(VFX_BLOOMING_VINE_STREAK_URL);
    vineTex.colorSpace = THREE.SRGBColorSpace;
    vineTex.wrapS = THREE.RepeatWrapping;
    vineTex.wrapT = THREE.RepeatWrapping;
    vineTex.needsUpdate = true;
  }
  return vineTex;
}

/** Install a fully-decoded texture from the loading gate. */
export function setBloomingVineStreakTexture(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  vineTex = tex;
}
