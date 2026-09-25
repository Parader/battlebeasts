import { useEffect } from "react";
import type { OneShotEffect } from "../types";
import { burstElementRole } from "../engine";

/**
 * Runic Shard hit / shatter — frost ParticleWorld burst, not lightning.
 *
 * Caster/travel: owned by the projectile (frost blow + trail/fog).
 * Impact: ice shards + frost fog at the contact point.
 * Ground: shatter also pours a short frost mist toward the floor.
 * Particles: frost impact/ground presets; no THREE.Points or bolt flash.
 * Light: none.
 * Status: frostChill is applied in combat.
 */
export function RunicShardShatterEffect({ shot }: { shot: OneShotEffect }) {
  useEffect(() => {
    const shatter = (shot.variant ?? 0) === 1;
    burstElementRole(
      "frost",
      "impact",
      shot.x,
      shot.y,
      shot.z,
      shatter ? undefined : { burst: 12 },
    );
    if (shatter) {
      burstElementRole("frost", "ground", shot.x, Math.max(0.06, shot.y - 0.35), shot.z, {
        duration: 0.06,
        burst: 8,
        rate: 0,
      });
    }
  }, [shot.key, shot.x, shot.y, shot.z, shot.variant]);

  return null;
}
