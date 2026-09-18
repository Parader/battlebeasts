import { useLayoutEffect, type RefObject } from "react";
import type { Object3D } from "three";
import { registerOccluder, unregisterOccluder } from "./occlusionRegistry";

/** Register a map / wall object as something that can hide characters. */
export function useOccluder(obj: Object3D | null | undefined) {
  useLayoutEffect(() => {
    if (!obj) return;
    registerOccluder(obj);
    return () => unregisterOccluder(obj);
  }, [obj]);
}

export function useOccluderRef(ref: RefObject<Object3D | null>) {
  useLayoutEffect(() => {
    const obj = ref.current;
    if (!obj) return;
    registerOccluder(obj);
    return () => unregisterOccluder(obj);
  }, [ref]);
}
