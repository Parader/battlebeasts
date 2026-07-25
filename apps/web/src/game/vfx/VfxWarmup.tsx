import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { warmSpellMaterials } from "./preloadVfx";

/**
 * One-shot compile of spell VFX shaders after the Canvas / lights exist.
 * Prevents first-cast hitch from WebGL program compile.
 */
export function VfxWarmup() {
  const { gl, scene, camera } = useThree();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    // Wait a couple frames so lights/shadows are in the scene graph.
    let frames = 0;
    let raf = 0;
    const tick = () => {
      frames += 1;
      if (frames < 2) {
        raf = requestAnimationFrame(tick);
        return;
      }
      try {
        warmSpellMaterials(gl, scene, camera);
      } catch {
        // Warmup is best-effort; first cast still works without it.
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gl, scene, camera]);

  return null;
}
