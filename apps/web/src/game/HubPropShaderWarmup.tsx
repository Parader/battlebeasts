import { getMapSource, HUB_MAP_ID } from "@battlebeasts/shared";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { compileLiveScene } from "./compileLiveScene";
import {
  countMountedMapProps,
  subscribeMapPropMounts,
} from "./mapPropMountGate";
import { markPropShaderReady } from "./propShaderReady";

/** Safety only — real warm waits for live InstancedProps then compileAsync. */
const FAIL_OPEN_MS = 20_000;

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
 * Compile the *live* hub InstancedMeshes (not decoy Mesh boxes) while the
 * loading gate is up.
 *
 * MapScene draws InstancedMesh — `USE_INSTANCING` is part of the program
 * cache key — so warming plain Meshes never prevented walk-around hitches.
 * We wait until every unique hub prop type has mounted, then compileAsync
 * under the Bloom colour-space probe and upload textures.
 */
export function HubPropShaderWarmup() {
  const { gl, scene, camera } = useThree();
  const source = getMapSource(HUB_MAP_ID);
  const expected = useMemo(() => {
    if (!source || source.kind !== "doc") return 0;
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
      if (expected > 0 && countMountedMapProps(HUB_MAP_ID) < expected) return;

      inflight = true;
      try {
        // Let InstancedPart primitives commit into the scene graph.
        await frames(2);
        if (cancelled || finished) return;
        await compileLiveScene(gl, scene, camera);
      } finally {
        inflight = false;
        finish();
        window.clearTimeout(failOpen);
      }
    };

    const unsub = subscribeMapPropMounts(() => {
      void tryWarm();
    });

    return () => {
      cancelled = true;
      window.clearTimeout(failOpen);
      unsub();
    };
  }, [gl, scene, camera, expected]);

  return null;
}
