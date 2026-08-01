import * as THREE from "three";
import { VFX_CHAIN_URL } from "../vfxUrls";

let chainTex: THREE.Texture | null = null;

function configureChainTex(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Shared tiled chain-strip texture for projectile + chained VFX. */
export function getChainTexture(): THREE.Texture {
  if (!chainTex) {
    chainTex = configureChainTex(new THREE.TextureLoader().load(VFX_CHAIN_URL));
  }
  return chainTex;
}

/** Install a fully-decoded texture from the loading gate. */
export function setChainTexture(tex: THREE.Texture): void {
  chainTex = configureChainTex(tex);
}
