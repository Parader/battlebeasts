import { useEffect } from "react";
import { playVillageMusic, stopVillageMusic } from "./gameMusic";

/**
 * Loop the hub soundtrack while playable in village; fade out in arena / on unmount.
 */
export function useVillageMusic(enabled: boolean) {
  useEffect(() => {
    if (enabled) playVillageMusic();
    else stopVillageMusic();
    return () => stopVillageMusic();
  }, [enabled]);
}
