import { useEffect, useState } from "react";
import {
  preloadAssetBundle,
  type AssetBundle,
  type AssetProgress,
} from "./prepareGameAssets";

/**
 * Preload hub or arena critical assets and report progress.
 * Failures still mark ready so a bad asset doesn't soft-lock play.
 */
export function useAssetPreload(bundle: AssetBundle, enabled = true) {
  const [progress, setProgress] = useState<AssetProgress>({
    done: 0,
    total: 1,
    percent: 0,
  });
  const [assetsReady, setAssetsReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setAssetsReady(false);
      return;
    }
    let cancelled = false;
    setAssetsReady(false);
    setProgress({ done: 0, total: 1, percent: 0 });

    void preloadAssetBundle(bundle, (p) => {
      if (!cancelled) setProgress(p);
    })
      .catch((err) => {
        console.warn(`[assets] ${bundle} preload failed`, err);
      })
      .finally(() => {
        if (!cancelled) {
          setProgress((prev) => ({ ...prev, percent: 100 }));
          setAssetsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bundle, enabled]);

  return { progress, assetsReady };
}
