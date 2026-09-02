import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { warmSpellMaterials } from "./preloadVfx";
import { whenSpellTexturesPrimed } from "./primeSpellTextures";
import { clearVfxGpuReady, markVfxGpuReady } from "./vfxGpuReady";

type Props = {
  /**
   * Changes on hub ↔ content (and dungeon) remounts so shaders re-compile
   * under the new lights/fog. Parent should clear ready when this flips.
   */
  warmKey?: string;
};

/**
 * Compile spell VFX shaders after Canvas / scene lights exist.
 * Waits for texture prime so programs compile with real maps.
 * Keeps a persistent hidden warm group (see warmSpellMaterials).
 * Re-runs when `warmKey` changes (map transfer).
 */
export function VfxWarmup({ warmKey = "default" }: Props) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    clearVfxGpuReady();

    let cancelled = false;
    let raf = 0;

    const run = async () => {
      await Promise.race([
        whenSpellTexturesPrimed(),
        new Promise<void>((r) => window.setTimeout(r, 4000)),
      ]);
      if (cancelled) return;

      await new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => {
          frames += 1;
          if (frames < 3) {
            raf = requestAnimationFrame(tick);
            return;
          }
          resolve();
        };
        raf = requestAnimationFrame(tick);
      });
      if (cancelled) return;

      try {
        warmSpellMaterials(gl, scene, camera);
      } catch {
        // Warmup is best-effort; first cast still works without it.
      } finally {
        if (!cancelled) markVfxGpuReady();
      }
    };

    void run();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [gl, scene, camera, warmKey]);

  return null;
}
