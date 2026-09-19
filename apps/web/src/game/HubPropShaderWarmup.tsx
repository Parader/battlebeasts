import { getMapSource } from "@battlebeasts/shared";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { getCharacterRoot } from "./characterRoots";
import { compileLiveScene, settleLiveScene } from "./compileLiveScene";
import {
  countMountedMapProps,
  subscribeMapPropMounts,
} from "./mapPropMountGate";
import { markPropShaderReady } from "./propShaderReady";

/** Safety only — real warm waits for live InstancedProps then compile + settle. */
const FAIL_OPEN_MS = 14_000;
const CHARACTER_WAIT_MS = 2_500;

function frames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let left = n;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Compile the *live* map (instanced doc props or a baked GLB) while the
 * loading gate is up, then hold the overlay until first present frames
 * stop linking programs.
 *
 * MapScene draws InstancedMesh — `USE_INSTANCING` is part of the program
 * cache key — so warming plain Meshes never prevented walk-around hitches.
 * Baked desert/cemetery were skipped entirely, which is why PvE paid every
 * terrain program on the first look. We wait until the map is in the graph,
 * then compile under the Bloom colour-space probe and upload textures.
 */
export function HubPropShaderWarmup({
  mapId,
  localSessionId = null,
}: {
  mapId: string;
  localSessionId?: string | null;
}) {
  const { gl, scene, camera } = useThree();
  const source = getMapSource(mapId);
  const expected = useMemo(() => {
    if (!source) return 0;
    if (source.kind === "baked") return 1;
    return new Set(source.doc.props.map((p) => p.prop)).size;
  }, [source]);

  useEffect(() => {
    let cancelled = false;
    let finished = false;
    let inflight = false;

    const finish = () => {
      if (cancelled || finished) return;
      finished = true;
      markPropShaderReady();
    };

    const failOpen = window.setTimeout(finish, FAIL_OPEN_MS);

    const tryWarm = async () => {
      if (cancelled || finished || inflight) return;
      if (expected > 0 && countMountedMapProps(mapId) < expected) return;

      inflight = true;
      try {
        // Let InstancedPart primitives commit into the scene graph.
        await frames(2);
        if (cancelled || finished) return;

        if (localSessionId) {
          const deadline = performance.now() + CHARACTER_WAIT_MS;
          while (!getCharacterRoot(localSessionId) && performance.now() < deadline) {
            if (cancelled || finished) return;
            await frames(2);
          }
          // Cosmetics / bone skins attach a few frames after the body root.
          await frames(8);
        }

        if (cancelled || finished) return;
        await compileLiveScene(gl, scene, camera);
        if (cancelled || finished) return;
        await settleLiveScene(gl);
      } finally {
        inflight = false;
        finish();
        window.clearTimeout(failOpen);
      }
    };

    const unsub = subscribeMapPropMounts(() => {
      void tryWarm();
    });
    void tryWarm();
    const retry = window.setInterval(() => {
      void tryWarm();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(failOpen);
      window.clearInterval(retry);
      unsub();
    };
  }, [gl, scene, camera, expected, mapId, localSessionId]);

  return null;
}
