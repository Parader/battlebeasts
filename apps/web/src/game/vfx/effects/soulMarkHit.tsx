import { useEffect } from "react";
import type { OneShotEffect } from "../types";
import { burstElementRole } from "../engine";

/**
 * Soul Mark body hit — a tiny spark confirmation, not a rupture.
 *
 * The stack consume owns the boom. This is only "the dart landed."
 */
export function SoulMarkHitEffect({ shot }: { shot: OneShotEffect }) {
  useEffect(() => {
    burstElementRole("void", "trail", shot.x, shot.y, shot.z, {
      duration: 0.05,
      rate: 0,
      burst: 8,
      spread: 0.22,
      size: 0.14,
      sizeEnd: 0.03,
      life: 0.32,
      dirY: 0.18,
      dirX: 0,
      dirZ: 0,
    });
  }, [shot.key, shot.x, shot.y, shot.z]);

  return null;
}
