import { useGLTF, useTexture } from "@react-three/drei";
import {
  ARENA_SCENE_URL,
  CEMETERY_SCENE_URL,
  getMapSource,
  groundLayerUrls,
  HUB_MAP_ID,
  mapNpcs,
  propUrlForKey,
  type MapDoc,
} from "@battlebeasts/shared";
import { assetUrl } from "./assetUrl";
import { CHARACTER_URL } from "./characterVisual";
import { ZOMBIE_URL } from "./zombieAsset";
import { preloadArenaMusic, preloadVillageMusic } from "./gameMusic";
import { preloadArenaAmbiance, preloadVillageAmbiance } from "./gameAmbiance";
import { preloadCombatSfx } from "./gameSfx";
import { collectSpellVfxAssets } from "./vfx/spellVfxAssets";
import { preloadSpellVfxTextures } from "./vfx/primeSpellTextures";

export type AssetBundle = "hub" | "arena";

export type AssetProgress = {
  done: number;
  total: number;
  /** 0–100 */
  percent: number;
};

function arenaSceneUrl(): string {
  return assetUrl(ARENA_SCENE_URL.replace(/^\//, ""));
}

function cemeterySceneUrl(): string {
  return assetUrl(CEMETERY_SCENE_URL.replace(/^\//, ""));
}

async function ensureFetched(url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  await res.arrayBuffer();
}

async function awaitPreload(value: unknown): Promise<void> {
  if (value != null && typeof (value as Promise<unknown>).then === "function") {
    await value;
  }
}

/** Warm drei/R3F cache for a GLB and wait until bytes (and parse, when promised) are ready. */
async function preloadGltf(url: string): Promise<void> {
  const pending = useGLTF.preload(url);
  await Promise.all([awaitPreload(pending), ensureFetched(url)]);
  // If preload was fire-and-forget, kick it again after HTTP cache is warm.
  await awaitPreload(useGLTF.preload(url));
}

async function preloadGltfsBatched(urls: readonly string[], batchSize = 8): Promise<void> {
  const unique = [...new Set(urls)];
  for (let i = 0; i < unique.length; i += batchSize) {
    await Promise.all(unique.slice(i, i + batchSize).map((url) => preloadGltf(url)));
  }
}

/** Painted-ground layer maps plus sidecar PNGs for one document map. */
function groundUrlsForDoc(doc: MapDoc): string[] {
  if (doc.ground.kind !== "painted") return [];
  const urls = groundLayerUrls(doc.ground.layers).map(assetUrl);
  if (doc.ground.splatUrl) urls.push(assetUrl(doc.ground.splatUrl));
  if (doc.ground.heightUrl) urls.push(assetUrl(doc.ground.heightUrl));
  return urls;
}

/**
 * Warm every GLB and ground texture a document map needs before play starts.
 *
 * Without this, MapScene mounts ~100 unique prop types under Suspense while the
 * player can already move — each completion hitches the main thread.
 */
export async function preloadMapDocAssets(doc: MapDoc): Promise<void> {
  const glbUrls = [
    ...new Set(doc.props.map((p) => assetUrl(propUrlForKey(p.prop)))),
    ...mapNpcs(doc).map((n) => assetUrl(n.model.file)),
  ];
  const texUrls = groundUrlsForDoc(doc);
  await Promise.all([
    preloadGltfsBatched(glbUrls, 4),
    texUrls.length ? preloadTextures(texUrls) : Promise.resolve(),
  ]);
}

export async function preloadMapAssets(mapId: string): Promise<void> {
  const source = getMapSource(mapId);
  if (!source || source.kind !== "doc") return;
  await preloadMapDocAssets(source.doc);
}

async function preloadTextures(urls: readonly string[]): Promise<void> {
  const list = [...urls];
  const pending = useTexture.preload(list);
  await Promise.all([awaitPreload(pending), ...list.map((u) => ensureFetched(u))]);
  await awaitPreload(useTexture.preload(list));
}

/** Spell VFX GLBs from the declarative asset manifest (core + profile.assets). */
async function preloadSpellGlbs(): Promise<void> {
  const { glbs } = collectSpellVfxAssets();
  await Promise.all(glbs.map((url) => preloadGltf(url)));
}

async function runTracked(
  tasks: Array<() => Promise<unknown>>,
  onProgress?: (p: AssetProgress) => void,
): Promise<void> {
  const total = Math.max(1, tasks.length);
  let done = 0;
  onProgress?.({ done: 0, total, percent: 0 });
  await Promise.all(
    tasks.map(async (task) => {
      await task();
      done += 1;
      onProgress?.({
        done,
        total,
        percent: Math.round((done / total) * 100),
      });
    }),
  );
}

/**
 * Warm caches for the hub critical path (character, village, ground, all spell VFX).
 * Safe to call multiple times — subsequent runs hit HTTP/drei cache.
 */
export async function preloadHubAssets(
  onProgress?: (p: AssetProgress) => void,
): Promise<void> {
  await runTracked(
    [
      () => preloadGltf(CHARACTER_URL),
      () => preloadMapAssets(HUB_MAP_ID),
      () => preloadSpellGlbs(),
      () => preloadSpellVfxTextures(),
      () => preloadVillageMusic(),
      () => preloadVillageAmbiance(),
      () => preloadCombatSfx(),
    ],
    onProgress,
  );
}

/** Warm desert + cemetery + zombie + combat bundle (safe if hub already cached). */
export async function preloadArenaAssets(
  onProgress?: (p: AssetProgress) => void,
): Promise<void> {
  await runTracked(
    [
      () => preloadGltf(CHARACTER_URL),
      () => preloadGltf(arenaSceneUrl()),
      () => preloadGltf(cemeterySceneUrl()),
      () => preloadGltf(ZOMBIE_URL),
      () => preloadSpellGlbs(),
      () => preloadSpellVfxTextures(),
      () => preloadCombatSfx(),
      () => preloadArenaMusic(),
      () => preloadArenaAmbiance(),
    ],
    onProgress,
  );
}

export async function preloadAssetBundle(
  bundle: AssetBundle,
  onProgress?: (p: AssetProgress) => void,
): Promise<void> {
  if (bundle === "arena") return preloadArenaAssets(onProgress);
  return preloadHubAssets(onProgress);
}
