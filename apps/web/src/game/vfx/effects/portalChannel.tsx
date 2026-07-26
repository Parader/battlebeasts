import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ABILITIES, channelChargeDistance, COLLISION, sampleTravel, sweepTravel } from "@battlebeasts/shared";
import { GroundMagicCircle } from "../components/GroundMagicCircle";
import { abilityVfxColor } from "../colors";
import { createCirclePointMaterial } from "../materials/circlePoint";
import { getWorldStaticColliders } from "../../worldCollidersRuntime";
import {
  clearPortalChannelBubbleScale,
  setPortalChannelBubbleScale,
} from "../portalChannelRuntime";

const WISP_COUNT = 14;
/** World radius of a fully charged channel bubble. */
export const PORTAL_BUBBLE_RADIUS = 0.85;

type CastLite = {
  castAbilityId?: string;
  castPhase?: string;
  x?: number;
  z?: number;
  yaw?: number;
};

/**
 * Caster-only landing marker — expands with portal charge along aim yaw.
 */
export function PortalLandingTelegraph({
  room,
  sessionId,
  getPos,
  getYaw,
}: {
  room: Room;
  sessionId: string;
  /** Predicted local feet when available. */
  getPos: () => { x: number; z: number };
  getYaw: () => number;
}) {
  const group = useRef<THREE.Group>(null);
  const color = abilityVfxColor("portal", "#a78bfa");
  const channelStart = useRef(0);
  const wasChanneling = useRef(false);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const p = room.state?.players?.get(sessionId) as CastLite | undefined;
    const channeling =
      p?.castAbilityId === "portal" &&
      (p.castPhase === "anticipation" || p.castPhase === "cast" || p.castPhase === "impact");
    if (!channeling) {
      g.visible = false;
      wasChanneling.current = false;
      channelStart.current = 0;
      return;
    }

    const inImpact = p?.castPhase === "impact";
    if (inImpact) {
      if (!wasChanneling.current || channelStart.current === 0) {
        channelStart.current = performance.now();
      }
      wasChanneling.current = true;
    } else {
      // Windup: show marker at min range
      channelStart.current = 0;
      wasChanneling.current = false;
    }

    const def = ABILITIES.portal;
    const elapsed = inImpact && channelStart.current > 0 ? performance.now() - channelStart.current : 0;
    const dist = def ? channelChargeDistance(def, elapsed) : 1;
    const yaw = getYaw();
    const pos = getPos();
    const ideal = sampleTravel(pos, yaw, dist, 1);
    const clamped = sweepTravel(pos, ideal, COLLISION.playerRadius, getWorldStaticColliders());
    // World-space group (not parented under the avatar).
    g.position.set(clamped.x, 0.04, clamped.z);
    g.visible = true;
  });

  return (
    <group ref={group} visible={false}>
      <GroundMagicCircle color={color} radius={0.95} spin={1.6} showRune y={0} />
    </group>
  );
}

/**
 * Growing transparent bubble + wisps while Portal channels.
 */
export function PortalChannelAura({
  room,
  sessionId,
}: {
  room: Room;
  sessionId: string;
}) {
  const root = useRef<THREE.Group>(null);
  const bubble = useRef<THREE.Mesh>(null);
  const rim = useRef<THREE.Mesh>(null);
  const channelStart = useRef(0);
  const wasImpact = useRef(false);
  const positions = useMemo(() => new Float32Array(WISP_COUNT * 3), []);
  const sizes = useMemo(() => new Float32Array(WISP_COUNT), []);
  const alphas = useMemo(() => new Float32Array(WISP_COUNT), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return g;
  }, [positions, sizes, alphas]);
  const mat = useMemo(() => createCirclePointMaterial(abilityVfxColor("portal", "#a78bfa")), []);
  const bubbleMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#2e1065",
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );
  const rimMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: abilityVfxColor("portal", "#a78bfa"),
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  const specs = useMemo(
    () =>
      Array.from({ length: WISP_COUNT }, (_, i) => ({
        ang: (i / WISP_COUNT) * Math.PI * 2,
        radius: 0.18 + (i % 4) * 0.05,
        baseY: 0.05,
        rise: 0.7 + (i % 5) * 0.12,
        size: 0.04 + (i % 3) * 0.02,
        speed: 0.55 + (i % 4) * 0.12,
        phase: i * 0.61,
      })),
    [],
  );

  useFrame(({ clock }) => {
    const g = root.current;
    if (!g) return;
    const p = room.state?.players?.get(sessionId) as CastLite | undefined;
    const channeling =
      p?.castAbilityId === "portal" &&
      (p.castPhase === "anticipation" || p.castPhase === "cast" || p.castPhase === "impact");
    if (!channeling) {
      g.visible = false;
      wasImpact.current = false;
      channelStart.current = 0;
      clearPortalChannelBubbleScale(sessionId);
      return;
    }
    g.visible = true;
    g.position.set(0, 0.95, 0);

    const inImpact = p?.castPhase === "impact";
    if (inImpact) {
      if (!wasImpact.current || channelStart.current === 0) {
        channelStart.current = performance.now();
      }
      wasImpact.current = true;
    } else {
      channelStart.current = 0;
      wasImpact.current = false;
    }

    const def = ABILITIES.portal;
    const chargeMs = Math.max(1, def?.channelChargeMs ?? 1000);
    const elapsed = inImpact && channelStart.current > 0 ? performance.now() - channelStart.current : 0;
    const charge01 = Math.max(0, Math.min(1, elapsed / chargeMs));
    // Soft appear in windup, then grow with charge
    const windupScale = inImpact ? 0.28 + charge01 * 0.72 : 0.18;
    setPortalChannelBubbleScale(sessionId, windupScale);

    if (bubble.current) bubble.current.scale.setScalar(windupScale);
    if (rim.current) rim.current.scale.setScalar(windupScale * 1.03);
    bubbleMat.opacity = 0.1 + charge01 * 0.08;
    rimMat.opacity = 0.12 + charge01 * 0.1;

    const t = clock.elapsedTime;
    for (let i = 0; i < WISP_COUNT; i++) {
      const spec = specs[i]!;
      const cycle = (t * spec.speed + spec.phase) % 1;
      const ang = spec.ang + t * 0.4;
      const rMul = 0.7 + windupScale * 0.9;
      positions[i * 3] = Math.cos(ang) * spec.radius * (0.85 + cycle * 0.35) * rMul;
      positions[i * 3 + 1] = spec.baseY + cycle * spec.rise * (0.6 + windupScale * 0.5) - 0.55;
      positions[i * 3 + 2] = Math.sin(ang) * spec.radius * (0.85 + cycle * 0.35) * rMul;
      const fade = cycle < 0.12 ? cycle / 0.12 : cycle > 0.55 ? 1 - (cycle - 0.55) / 0.45 : 1;
      sizes[i] = spec.size * (0.75 + cycle * 1.1) * 36;
      alphas[i] = Math.max(0, fade) * (0.28 + windupScale * 0.2);
    }
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.aSize!.needsUpdate = true;
    geo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={bubble} material={bubbleMat}>
        <sphereGeometry args={[PORTAL_BUBBLE_RADIUS, 20, 14]} />
      </mesh>
      <mesh ref={rim} material={rimMat}>
        <sphereGeometry args={[PORTAL_BUBBLE_RADIUS, 20, 14]} />
      </mesh>
      <points geometry={geo} material={mat} frustumCulled={false} />
    </group>
  );
}
