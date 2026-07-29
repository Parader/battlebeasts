import type { OneShotEffect } from "../types";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";

/**
 * Projectile vs wall / shield disc — small spray that falls more than it explodes.
 */
export function WallFizzleEffect({ shot }: { shot: OneShotEffect }) {
  return (
    <group position={[shot.x, shot.y, shot.z]}>
      <AdditiveParticleBurst
        color={shot.color}
        count={11}
        life={0.38}
        speed={1.35}
        speedSpread={0.85}
        size={0.14}
        sizeEnd={0.03}
        lift={-0.35}
        downBias={0.85}
        gravity={7.5}
        fadeIn={0.12}
        stagger={0.18}
        origin={[0, 0, 0]}
      />
      <AdditiveParticleBurst
        color={shot.color}
        count={6}
        life={0.28}
        speed={0.65}
        speedSpread={0.4}
        size={0.1}
        sizeEnd={0.02}
        lift={-0.9}
        downBias={1}
        gravity={9}
        fadeIn={0.08}
        stagger={0.1}
        origin={[0, 0.04, 0]}
      />
    </group>
  );
}
