import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { ABILITIES } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { LavaGroundStrip } from "../components/LavaGroundStrip";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { spawnElementRole, type ElementHandle } from "../engine";

const GROW_MS = 620;

/**
 * Caster blow/travel/impact: none; ground: firewall strip.
 * Particles: ParticleWorld; light: none; status: StatusAuraFx handles burning.
 */
export function FirewallGroundEffect({ shot }: { shot: OneShotEffect }) {
  const def = ABILITIES.firewall;
  /** Server sends wall.halfLength as `radius` on the aoe FX. */
  const halfLength = Math.max(1.5, shot.radius ?? (def.range > 0 ? def.range * 0.5 : 6.5));
  const hitRadius = Math.max(0.4, def.radius ?? 0.9);
  /** Same inset as `firewallWallPoints` — sample centers stay inside the wall. */
  const hitHalf = Math.max(1.2, halfLength - hitRadius * 0.7);
  /** True hit envelope: stadium around the sample segment. */
  const capsuleLen = hitHalf * 2 + hitRadius * 2;
  const hitWidth = hitRadius * 2;
  const lifeMs = Math.max(1200, shot.life);
  const yaw = Number.isFinite(shot.yaw) ? (shot.yaw as number) : 0;
  const x = Number.isFinite(shot.x) ? shot.x : 0;
  const z = Number.isFinite(shot.z) ? shot.z : 0;

  const auraProgress = useRef(0);
  const auraOpacity = useRef(0);
  const groundFire = useRef<ElementHandle | null>(null);

  useEffect(() => {
    const handle = spawnElementRole("fire", "ground", x, 0.08, z);
    handle.setPoseYaw(x, 0.08, z, yaw);
    handle.setRateScale(0);
    groundFire.current = handle;
    return () => {
      handle.kill();
      if (groundFire.current === handle) groundFire.current = null;
    };
  }, [x, yaw, z]);

  useFrame(() => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    const grow = Math.max(0, Math.min(1, age / GROW_MS));
    auraProgress.current = 1 - (1 - grow) * (1 - grow);
    auraOpacity.current = softEnvelope(u, 0.04, 0.88);
    groundFire.current?.setRateScale(auraOpacity.current);
  });

  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <AoeRimMarker
        radius={hitRadius}
        length={capsuleLen}
        shape="capsule"
        color="#ef4444"
        hotColor="#fecaca"
        fill={0.06}
        noise={0.25}
        glowWidth={0.05}
        y={0.04}
        opacity={0.55}
        opacityMulRef={auraOpacity}
      />

      <LavaGroundStrip
        length={capsuleLen}
        width={hitWidth}
        y={0.036}
        sideFade={0.18}
        endFade={0.1}
        progressRef={auraProgress}
        opacityMulRef={auraOpacity}
      />

    </group>
  );
}
