import { useEffect, useState } from "react";
import {
  isPropShaderReady,
  skipPropShaderReady,
  subscribePropShaderReady,
} from "./propShaderReady";

/**
 * True after hub prop materials are shader-compiled on the loading gate.
 * Does not reset on mount — {@link HubPropShaderWarmup} / play-screen own
 * that lifecycle (same pattern as {@link useVfxGpuReady}).
 */
export function usePropShaderReady(hubWarmup: boolean): boolean {
  const [shaderReady, setShaderReady] = useState(() =>
    hubWarmup ? isPropShaderReady() : true,
  );

  useEffect(() => {
    if (!hubWarmup) {
      skipPropShaderReady();
      setShaderReady(true);
      return;
    }
    setShaderReady(isPropShaderReady());
    return subscribePropShaderReady(setShaderReady);
  }, [hubWarmup]);

  return hubWarmup ? shaderReady : true;
}
