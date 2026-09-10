import * as THREE from "three";
import { DefaultLoadingManager } from "three";
import { GLTFLoader as ThreeGLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLoader as StdlibGLTFLoader } from "three-stdlib";
import { assetUrl } from "./assetUrl";

const KINGDOM_TEXTURE_DIR = assetUrl("assets/props/kingdom/textures/");

/**
 * Polygon kit atlases ship once under `kingdom/textures/`, but GLBs in other
 * biomes still reference `textures/PolygonFantasyKingdom_*.png` beside themselves.
 */
export function resolveSharedPropTextureUrl(url: string): string {
  if (!url || /^(blob:|data:)/.test(url)) return url;
  const name = url.split(/[/\\?#]/).pop() ?? url;
  if (/^(PolygonFantasy|PolygonFantasyKingdon|PFK_Texture)/i.test(name)) {
    return `${KINGDOM_TEXTURE_DIR}${name}`;
  }
  return url;
}

let installed = false;

/**
 * Global cache of in-flight and loaded master textures keyed by normalized asset URL.
 * All subsequent loads for the same URL return clones sharing `master.source`.
 *
 * This ensures that when 100+ map props reference the same 4096×4096 kit texture atlases
 * (e.g. PolygonFantasyKingdom_Texture_01_A.png), the image is decoded only ONCE in CPU
 * memory and uploaded only ONCE to WebGL VRAM instead of 100+ duplicate 64MB allocations.
 */
const globalTexturePromiseCache = new Map<string, Promise<THREE.Texture>>();

function patchGLTFLoaderClass(LoaderClass: any): void {
  let parserPatched = false;
  const dummyGltf = JSON.stringify({ asset: { version: "2.0" } });

  function applyParserPatch(parser: unknown): void {
    if (parserPatched) return;
    parserPatched = true;
    const proto = Object.getPrototypeOf(parser) as {
      loadImageSource: (sourceIndex: number, loader: unknown) => Promise<THREE.Texture>;
    };
    if (!proto || typeof proto.loadImageSource !== "function") return;
    const origLoadImageSource = proto.loadImageSource;

    proto.loadImageSource = function (
      this: {
        json: { images?: Array<{ uri?: string; bufferView?: number }> };
        options: { path?: string };
        sourceCache: Record<number, Promise<THREE.Texture>>;
      },
      sourceIndex: number,
      loader: unknown,
    ): Promise<THREE.Texture> {
      const sourceDef = this.json.images?.[sourceIndex];

      // Only deduplicate external URI references (not embedded binary bufferViews)
      if (sourceDef && typeof sourceDef.uri === "string" && sourceDef.bufferView === undefined) {
        const rawUrl = sourceDef.uri;
        const resolvedUrl = THREE.LoaderUtils.resolveURL(rawUrl, this.options.path || "");
        const key = resolveSharedPropTextureUrl(resolvedUrl);

        if (key !== resolvedUrl) {
          sourceDef.uri = key;
        }

        const hit = globalTexturePromiseCache.get(key);
        if (hit) {
          // Re-use existing loaded texture by cloning it (shares texture.source!)
          const clonedPromise = hit.then((tex) => tex.clone());
          if (this.sourceCache) {
            this.sourceCache[sourceIndex] = clonedPromise;
          }
          return clonedPromise;
        }

        const loadPromise = origLoadImageSource.call(this, sourceIndex, loader).catch((err: unknown) => {
          globalTexturePromiseCache.delete(key);
          throw err;
        });

        globalTexturePromiseCache.set(key, loadPromise);
        if (this.sourceCache) {
          this.sourceCache[sourceIndex] = loadPromise;
        }
        return loadPromise;
      }

      return origLoadImageSource.call(this, sourceIndex, loader);
    };
  }

  const origParse = LoaderClass.prototype.parse;
  LoaderClass.prototype.parse = function (this: any, ...args: any[]) {
    this.register((parser: unknown) => {
      applyParserPatch(parser);
      return { name: "TextureDeduplicator" };
    });
    return origParse.apply(this, args);
  };

  // Instantly force-patch the parser prototype at boot time via a lightweight dummy parse
  try {
    const dummyLoader = new LoaderClass();
    dummyLoader.register((parser: unknown) => {
      applyParserPatch(parser);
      return { name: "TextureDeduplicatorBoot" };
    });
    dummyLoader.parse(dummyGltf, "", () => {}, () => {});
  } catch (err) {
    console.warn("[assets] GLTFLoader boot patch warning:", err);
  }
}

function patchTextureLoader(): void {
  const originalLoad = THREE.TextureLoader.prototype.load;

  THREE.TextureLoader.prototype.load = function (
    this: THREE.TextureLoader,
    url: string,
    onLoad?: (texture: THREE.Texture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ): THREE.Texture {
    if (!url || /^(blob:|data:)/.test(url)) {
      return originalLoad.call(this, url, onLoad, onProgress, onError);
    }

    const manager = this.manager || DefaultLoadingManager;
    const full = this.path ? this.path + url : url;
    const key = resolveSharedPropTextureUrl(manager.resolveURL(full));

    const hit = globalTexturePromiseCache.get(key);
    if (hit) {
      const clone = new THREE.Texture();
      hit
        .then((master) => {
          clone.source = master.source;
          clone.colorSpace = master.colorSpace;
          clone.needsUpdate = true;
          if (onLoad) {
            queueMicrotask(() => onLoad(clone));
          }
        })
        .catch((err) => {
          onError?.(err);
        });
      return clone;
    }

    let resolveMaster: (tex: THREE.Texture) => void;
    let rejectMaster: (err: unknown) => void;
    const masterPromise = new Promise<THREE.Texture>((resolve, reject) => {
      resolveMaster = resolve;
      rejectMaster = reject;
    });
    globalTexturePromiseCache.set(key, masterPromise);

    const master = originalLoad.call(
      this,
      url,
      (loadedTex) => {
        resolveMaster(loadedTex);
        onLoad?.(loadedTex);
      },
      onProgress,
      (err) => {
        globalTexturePromiseCache.delete(key);
        rejectMaster(err);
        onError?.(err);
      },
    );

    return master;
  };
}

/** Wire once at app boot — affects every GLTFLoader using Three's default manager. */
export function installSharedPropTextureResolver(): void {
  if (installed) return;
  installed = true;
  DefaultLoadingManager.setURLModifier((url) => resolveSharedPropTextureUrl(url));
  patchGLTFLoaderClass(StdlibGLTFLoader);
  patchGLTFLoaderClass(ThreeGLTFLoader);
  patchTextureLoader();
}

export function extendPropGltfLoader(loader: ThreeGLTFLoader | StdlibGLTFLoader): void {
  loader.manager.setURLModifier((url) => resolveSharedPropTextureUrl(url));
}
