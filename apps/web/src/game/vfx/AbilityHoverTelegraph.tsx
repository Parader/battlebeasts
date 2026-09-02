import { useEffect, useState } from "react";
import { ABILITIES, abilityEffectKind, firewallWallPoints } from "@battlebeasts/shared";
import { abilityHoverRuntime } from "../abilityHoverRuntime";
import { castAimRuntime } from "../castAimRuntime";

/**
 * Ground range / AoE preview while hovering a spellbar slot.
 * Parent should be the local avatar root (feet at origin).
 */
export function AbilityHoverTelegraph() {
  const [abilityId, setAbilityId] = useState(() => abilityHoverRuntime.hoveredAbilityId);
  const [casting, setCasting] = useState(() => castAimRuntime.isAimPreviewActive());

  useEffect(() => {
    const unsubHover = abilityHoverRuntime.subscribe(() => {
      setAbilityId(abilityHoverRuntime.hoveredAbilityId);
    });
    const unsubCast = castAimRuntime.subscribe(() => {
      setCasting(castAimRuntime.isAimPreviewActive());
    });
    return () => {
      unsubHover();
      unsubCast();
    };
  }, []);

  const def = abilityId ? ABILITIES[abilityId] : undefined;
  if (!def || casting) return null;

  // Firewall: forward wall (length × thickness), not a huge range circle.
  if (abilityEffectKind(def) === "firewall") {
    const owner = { id: "hover", x: 0, z: 0, yaw: 0, hp: 1, maxHp: 1 };
    const wall = firewallWallPoints(owner, def);
    const length = wall.halfLength * 2;
    const thickness = Math.max(0.4, def.radius ?? 0.9);
    const midDist = Math.max(1.2, def.spikeStart ?? 3.4);
    return (
      <group position={[0, 0.03, 0]}>
        <mesh position={[0, 0, midDist]} renderOrder={2}>
          <boxGeometry args={[length, 0.04, thickness]} />
          <meshBasicMaterial
            color="#f97316"
            transparent
            opacity={0.28}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, 0, midDist]} renderOrder={3}>
          <boxGeometry args={[length + 0.08, 0.05, thickness + 0.08]} />
          <meshBasicMaterial
            color="#fdba74"
            transparent
            opacity={0.18}
            depthWrite={false}
            toneMapped={false}
            wireframe
          />
        </mesh>
      </group>
    );
  }

  const range =
    def.range > 0
      ? def.range
      : def.travel?.distance && def.travel.distance > 0
        ? def.travel.distance
        : 0;
  const aoe = def.radius != null && def.radius > 0 ? def.radius : 0;
  if (range <= 0 && aoe <= 0) return null;

  return (
    <group position={[0, 0.03, 0]}>
      {range > 0 ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
          <ringGeometry args={[Math.max(0.05, range - 0.06), range, 64]} />
          <meshBasicMaterial
            color="#c9b27a"
            transparent
            opacity={0.42}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ) : null}
      {aoe > 0 ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
          <circleGeometry args={[aoe, 48]} />
          <meshBasicMaterial
            color="#7a6aad"
            transparent
            opacity={0.18}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ) : null}
    </group>
  );
}
