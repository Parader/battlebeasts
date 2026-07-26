import * as THREE from "three";

const CHAIN_URL = "/assets/vfx/chain-strip.png";

let chainTex: THREE.Texture | null = null;

/** Shared tiled chain-strip texture for projectile + rooted VFX. */
export function getChainTexture(): THREE.Texture {
  if (!chainTex) {
    chainTex = new THREE.TextureLoader().load(CHAIN_URL);
    chainTex.colorSpace = THREE.SRGBColorSpace;
    chainTex.wrapS = THREE.ClampToEdgeWrapping;
    chainTex.wrapT = THREE.RepeatWrapping;
    chainTex.needsUpdate = true;
  }
  return chainTex;
}
