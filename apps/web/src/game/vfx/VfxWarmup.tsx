import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { warmSpellMaterials } from "./preloadVfx";
import { whenSpellTexturesPrimed } from "./primeSpellTextures";
import { markVfxGpuReady } from "./vfxGpuReady";

/**
 * One-shot compile of spell VFX shaders after the Canvas / lights exist.
 * Waits for texture prime so programs compile with real maps.
 * Signals the play loading gate when done.
 */
export function VfxWarmup() {
  const { gl, scene, camera } = useThree();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    let cancelled = false;
    let raf = 0;

    const run = async () => {
      // Don't block forever if preload failed — warm with lazy TextureLoader fallbacks.
      await Promise.race([
        whenSpellTexturesPrimed(),
        new Promise<void>((r) => window.setTimeout(r, 4000)),
      ]);
      if (cancelled) return;

      // A couple frames so lights/shadows are in the scene graph.
      await new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => {
          frames += 1;
          if (frames < 2) {
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
        markVfxGpuReady();
      }
    };

    void run();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [gl, scene, camera]);

  return null;
}
