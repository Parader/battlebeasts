import { useEffect } from "react";
import type { OneShotEffect } from "../types";
import { burstElementRole } from "../engine";

/**
 * Crescent hit — mid-air wind gust at the contact point.
 *
 * Caster blow: none, the cast swoop owns the tell (lab slash material).
 * Travel: none, this is the landing beat only.
 * Impact: one outward wind burst on the body plus a lateral spray along the swing.
 * Ground: none — crescent connects in the air, a scorch would lie about it.
 * Particles: wind wisps; ambiance is the preset's thin smoke layer.
 * Light: none, additive wisps carry it.
 * Status: none.
 *
 * Fires once on mount and self-expires, so a hit costs no per-frame work.
 */
export function CrescentImpactEffect({ shot }: { shot: OneShotEffect }) {
  useEffect(() => {
    const fx = Math.sin(shot.yaw);
    const fz = Math.cos(shot.yaw);
    const flip = (shot.variant ?? 0) % 2 === 1 ? -1 : 1;

    burstElementRole("wind", "impact", shot.x, shot.y + 0.08, shot.z, {
      burst: 8,
      spread: 0.55,
      size: 0.32,
      sizeEnd: 0.1,
      life: 0.28,
    });

    // Lateral spray thrown along the swing arc — reads the direction of the cut.
    burstElementRole(
      "wind",
      "trail",
      shot.x + fx * 0.15,
      shot.y + 0.15,
      shot.z + fz * 0.15,
      {
        rate: 0,
        burst: 5,
        size: 0.22,
        sizeEnd: 0.06,
        dirX: (fx * 0.55 + fz * 1.4) * flip,
        dirY: 0.35,
        dirZ: (fz * 0.55 - fx * 1.4) * flip,
        spread: 0.28,
        life: 0.22,
      },
    );
  }, [shot.key, shot.x, shot.y, shot.z, shot.yaw, shot.variant]);

  return null;
}
