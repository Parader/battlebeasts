import { useEffect, useState } from "react";
import { isVfxGpuReady, subscribeVfxGpuReady } from "./vfx/vfxGpuReady";

/** True after VfxWarmup compiles spell shader programs. */
export function useVfxGpuReady(): boolean {
  const [ready, setReady] = useState(isVfxGpuReady);
  useEffect(() => subscribeVfxGpuReady(setReady), []);
  return ready;
}
