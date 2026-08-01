import { useGLTF, useTexture } from "@react-three/drei";
import { ARENA_SCENE_URL, HUB_SCENE_URL } from "@battlebeasts/shared";
import { assetUrl } from "./assetUrl";
import { CHARACTER_URL } from "./characterVisual";
import { preloadArenaMusic, preloadVillageMusic } from "./gameMusic";
import { preloadArenaAmbiance, preloadVillageAmbiance } from "./gameAmbiance";
import { preloadCombatSfx } from "./gameSfx";
import { GROUND_TEXTURE_URLS } from "./TexturedGround";
import { VOLCANO_GLB_URL } from "./vfx/volcanoAsset";
import { SHROOM_GREEN_GLB_URL, SHROOM_RED_GLB_URL } from "./vfx/shroomAsset";
import { CHEST_GLB_URL } from "./vfx/vfxUrls";
import { preloadSpellVfxTextures } from "./vfx/primeSpellTextures";

export type AssetBundle = "hub" | "arena";

export type AssetProgress = {
  done: number;
  total: number;
  /** 0–100 */
  percent: number;
};

function hubSceneUrl(): string {
  return assetUrl(HUB_SCENE_URL.replace(/^\//, ""));
}

function arenaSceneUrl(): string {
  return assetUrl(ARENA_SCENE_URL.replace(/^\//, ""));
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

async function preloadTextures(urls: readonly string[]): Promise<void> {
  const list = [...urls];
  const pending = useTexture.preload(list);
  await Promise.all([awaitPreload(pending), ...list.map((u) => ensureFetched(u))]);
  await awaitPreload(useTexture.preload(list));
}

/** Spell VFX GLBs used on first cast / spawn (volcano rocks, shrooms, chest). */
async function preloadSpellGlbs(): Promise<void> {
  await Promise.all([
    preloadGltf(VOLCANO_GLB_URL),
    preloadGltf(SHROOM_GREEN_GLB_URL),
    preloadGltf(SHROOM_RED_GLB_URL),
    preloadGltf(CHEST_GLB_URL),
  ]);
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
      () => preloadGltf(hubSceneUrl()),
      () => preloadSpellGlbs(),
      () => preloadTextures(GROUND_TEXTURE_URLS),
      () => preloadSpellVfxTextures(),
      () => preloadVillageMusic(),
      () => preloadVillageAmbiance(),
      () => preloadCombatSfx(),
    ],
    onProgress,
  );
}

/** Warm desert arena + full spell/combat bundle (safe if hub already cached). */
export async function preloadArenaAssets(
  onProgress?: (p: AssetProgress) => void,
): Promise<void> {
  await runTracked(
    [
      () => preloadGltf(CHARACTER_URL),
      () => preloadGltf(arenaSceneUrl()),
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
