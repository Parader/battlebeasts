import { DefaultLoadingManager } from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "./assetUrl";

const KINGDOM_TEXTURE_DIR = assetUrl("assets/props/kingdom/textures/");

/**
 * Polygon kit atlases ship once under `kingdom/textures/`, but GLBs in other
 * biomes still reference `textures/PolygonFantasyKingdom_*.png` beside themselves.
 */
export function resolveSharedPropTextureUrl(url: string): string {
  if (/^(blob:|data:)/.test(url)) return url;
  const name = url.split(/[/\\?#]/).pop() ?? url;
  if (/^(PolygonFantasy|PolygonFantasyKingdon|PFK_Texture)/.test(name)) {
    return `${KINGDOM_TEXTURE_DIR}${name}`;
  }
  return url;
}

let installed = false;

/** Wire once at app boot — affects every GLTFLoader using Three's default manager. */
export function installSharedPropTextureResolver(): void {
  if (installed) return;
  installed = true;
  DefaultLoadingManager.setURLModifier((url) => resolveSharedPropTextureUrl(url));
}

export function extendPropGltfLoader(loader: GLTFLoader): void {
  loader.manager.setURLModifier((url) => resolveSharedPropTextureUrl(url));
}
