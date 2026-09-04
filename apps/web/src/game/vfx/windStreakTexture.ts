import * as THREE from "three";
import { VFX_WIND_STREAK_URL } from "./vfxUrls";

let windTex: THREE.Texture | null = null;

/** Shared wind-streak map for Slipstream. Do not use useLoader — it suspends the canvas. */
export function getWindStreakTexture(): THREE.Texture {
  if (!windTex) {
    windTex = new THREE.TextureLoader().load(VFX_WIND_STREAK_URL);
    windTex.colorSpace = THREE.SRGBColorSpace;
    windTex.wrapS = THREE.RepeatWrapping;
    windTex.wrapT = THREE.RepeatWrapping;
    windTex.needsUpdate = true;
  }
  return windTex;
}

/** Install a fully-decoded texture from the loading gate. */
export function setWindStreakTexture(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  windTex = tex;
}
