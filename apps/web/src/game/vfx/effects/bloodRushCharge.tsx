import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BLOOD_RUSH_CAST } from "@battlebeasts/shared";
import { spawnElementRole, type ElementHandle } from "../engine";
import { isStealthedStatus } from "../../statusBadgeUtils";

const BLOOD = "#9f1239";

type CastLite = {
  castAbilityId?: string;
  castPhase?: string;
};

/**
 * Blood Rush charge meshes with a ParticleWorld blood cast emitter.
 */
export function BloodRushChargeAura({
  room,
  sessionId,
}: {
  room: Room;
  sessionId: string;
}) {
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const haze = useRef<THREE.Mesh>(null);
  const chargeStart = useRef(0);
  const castFx = useRef<ElementHandle | null>(null);
  const worldPos = useRef(new THREE.Vector3());
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BLOOD,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const hazeMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BLOOD,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => {
    const handle = spawnElementRole("blood", "cast", 0, 0.15, 0);
    handle.setRateScale(0);
    castFx.current = handle;
    return () => {
      handle.kill();
      if (castFx.current === handle) castFx.current = null;
    };
  }, []);

  useFrame(({ clock }) => {
    const g = root.current;
    if (!g) return;
    const p = room.state?.players?.get(sessionId) as CastLite | undefined;
    const charging =
      p?.castAbilityId === "bloodRush" &&
      (p.castPhase === "anticipation" || p.castPhase === "cast");
    if (!charging) {
      g.visible = false;
      chargeStart.current = 0;
      ringMat.opacity = 0;
      hazeMat.opacity = 0;
      castFx.current?.setRateScale(0);
      return;
    }
    const stealthed = isStealthedStatus(
      (p as { statuses?: Parameters<typeof isStealthedStatus>[0] } | undefined)?.statuses,
    );
    if (stealthed) {
      g.visible = false;
      castFx.current?.setRateScale(0);
      return;
    }

    if (chargeStart.current === 0) {
      chargeStart.current = performance.now();
    }

    const chargeMs = Math.max(1, BLOOD_RUSH_CAST.chargeMs);
    const elapsed = performance.now() - chargeStart.current;
    const charge01 = Math.max(0, Math.min(1, elapsed / chargeMs));
    // Ease in so early crouch stays subtle, then ramps hard near release.
    const intensity = charge01 * charge01 * (0.35 + 0.65 * charge01);

    g.visible = true;
    g.position.set(0, 0, 0);
    g.getWorldPosition(worldPos.current);
    castFx.current?.setPose(worldPos.current.x, worldPos.current.y + 0.15, worldPos.current.z);
    castFx.current?.setRateScale(0.25 + intensity * 0.9);

    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * (3.2 + charge01 * 4));
    if (ring.current) {
      const r = 0.42 + intensity * 0.38 + pulse * 0.04;
      ring.current.scale.set(r, r, 1);
      ringMat.opacity = 0.12 + intensity * 0.38 * pulse;
    }
    if (haze.current) {
      const h = 0.55 + intensity * 0.35;
      haze.current.scale.set(h, 1, h);
      hazeMat.opacity = 0.06 + intensity * 0.16;
    }

  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} material={ringMat} renderOrder={2}>
        <ringGeometry args={[0.72, 1, 40]} />
      </mesh>
      <mesh ref={haze} position={[0, 0.55, 0]} material={hazeMat} renderOrder={2}>
        <sphereGeometry args={[0.55, 16, 12]} />
      </mesh>
    </group>
  );
}
