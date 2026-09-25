import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { useSpellLight } from "../spellLights";
import {
  createLabMeleeSlashMaterial,
  tickLabMeleeSlash,
} from "../engine/labShapeMaterials";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { getWindStreakTexture } from "../windStreakTexture";
import { CRESCENT_SPELL_RANGE } from "../crescentSpawn";

/**
 * Bright outer of the slash band (shader soft-falls off by r1=0.88).
 * Size the disc so this visible edge lands at tipReach, not the faint rim.
 */
const BAND_VISUAL = 0.68;
/** Visual reach vs ability range (1 = match; <1 pulls tip in). */
const VFX_REACH_MUL = 0.88;

/**
 * Per-swing poses — true world-horizontal arcs (no tip/yawLean).
 * Tip pitch / lean foreshortens differently by facing vs camera; keep flat so
 * forward reach stays constant. Wipe is shader-driven (not disc roll) so the
 * tip stays on character-forward at full length.
 */
const SWING_POSES = [
  {
    flip: 1 as const,
    y: 1.05,
    hubFrac: 0.24,
    lateral: -0.02,
    /** Lateral vs forward after disc lay-flat (scaleY / scaleX). */
    widthMul: 0.84,
  },
  {
    flip: -1 as const,
    y: 1.15,
    hubFrac: 0.26,
    lateral: 0.02,
    widthMul: 0.86,
  },
  {
    flip: 1 as const,
    y: 0.98,
    hubFrac: 0.22,
    lateral: 0,
    widthMul: 0.82,
  },
] as const;

function resolvePose(shot: OneShotEffect) {
  const idx =
    typeof shot.variant === "number"
      ? ((shot.variant % SWING_POSES.length) + SWING_POSES.length) % SWING_POSES.length
      : shot.key % SWING_POSES.length;
  return SWING_POSES[idx]!;
}

/**
 * Crescent swoop — horizontal wind slash in front of the caster; tip at spell range.
 */
export function CrescentCastEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const blade = useRef<THREE.Group>(null);
  const slash = useRef<THREE.Mesh>(null);
  const ghost = useRef<THREE.Mesh>(null);
  const lightAt = useRef<THREE.Object3D>(null);
  const light = useSpellLight();
  const swing = useMemo(() => resolvePose(shot), [shot.variant, shot.key]);

  const slashMat = useMemo(
    () => createLabMeleeSlashMaterial("#ffffff", "#e2e8f0", "#64748b"),
    [],
  );
  const ghostMat = useMemo(
    () => createLabMeleeSlashMaterial("#f8fafc", "#cbd5e1", "#475569"),
    [],
  );
  const windMat = useMemo(() => {
    const map = getWindStreakTexture();
    return new THREE.MeshBasicMaterial({
      map,
      color: "#cbd5e1",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }, []);

  const discGeo = useMemo(() => new THREE.CircleGeometry(1, 56), []);

  useEffect(
    () => () => {
      slashMat.dispose();
      ghostMat.dispose();
      windMat.dispose();
      discGeo.dispose();
    },
    [slashMat, ghostMat, windMat, discGeo],
  );

  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw });

  useFrame((_, dt) => {
    const age = (performance.now() - shot.born) / shot.life;

    // Size = max range with a visual-only overshoot so the tip reads as contacting.
    // Close hits pull the hub hard toward the caster (same size, nearer the body).
    const sizeReach = CRESCENT_SPELL_RANGE * VFX_REACH_MUL;
    const aimDist = Math.max(
      0.7,
      Math.min(CRESCENT_SPELL_RANGE, shot.followSpawnOffset ?? CRESCENT_SPELL_RANGE),
    );
    const sizeHub = sizeReach * swing.hubFrac;
    // After Rz(±π/2)+Rx(-π/2): disc +X → forward, disc +Y → lateral.
    // Flat disc (no tip) → forward reach is orientation-stable.
    const radiusAlong = Math.max(0.95, (sizeReach - sizeHub) / BAND_VISUAL);
    const radiusAcross = radiusAlong * swing.widthMul;
    // Ease keeps the hub close until the target is near full range.
    const closeT = Math.pow(aimDist / CRESCENT_SPELL_RANGE, 1.75);
    const hubForward = THREE.MathUtils.lerp(
      Math.max(0.08, aimDist * 0.16),
      sizeHub,
      closeT,
    );
    const tipReach = sizeReach;

    if (shot.followOwnerId) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;

      if (local) {
        const yaw = local.yaw;
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);
        pose.current.yaw = yaw;
        pose.current.x =
          local.x + Math.sin(yaw) * hubForward + rightX * swing.lateral;
        pose.current.z =
          local.z + Math.cos(yaw) * hubForward + rightZ * swing.lateral;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (p) {
          const yaw = p.yaw ?? pose.current.yaw;
          const rightX = Math.cos(yaw);
          const rightZ = -Math.sin(yaw);
          pose.current.yaw = yaw;
          pose.current.x =
            (p.x ?? pose.current.x) + Math.sin(yaw) * hubForward + rightX * swing.lateral;
          pose.current.z =
            (p.z ?? pose.current.z) + Math.cos(yaw) * hubForward + rightZ * swing.lateral;
        }
      }
    } else {
      const yaw = shot.yaw;
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      pose.current.yaw = yaw;
      pose.current.x =
        shot.x + Math.sin(yaw) * hubForward + rightX * swing.lateral;
      pose.current.z =
        shot.z + Math.cos(yaw) * hubForward + rightZ * swing.lateral;
    }

    if (root.current) {
      root.current.position.set(pose.current.x, 0, pose.current.z);
      root.current.rotation.y = pose.current.yaw;
    }

    const g = blade.current;
    if (!g) return;
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const progress = age < 0.55 ? Math.pow(age / 0.55, 0.65) : 1;
    const fade = softEnvelope(age, 0.06, 0.52);
    tickLabMeleeSlash(slashMat, dt, progress);
    tickLabMeleeSlash(ghostMat, dt, Math.max(0, progress - 0.1));
    slashMat.uniforms.uOpacity!.value = 0.95 * fade;
    ghostMat.uniforms.uOpacity!.value = 0.42 * fade;
    windMat.opacity = fade * 0.26;

    // True flat horizontal: tip always on character-forward at full radiusAlong.
    // Shader uProgress draws the swipe — do not roll the disc (that skews length by facing).
    const arcRoll = swing.flip > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.position.set(0, swing.y, 0);
    g.rotation.set(-Math.PI / 2, 0, arcRoll);
    g.scale.set(swing.flip * radiusAlong, radiusAcross, 1);

    if (slash.current) slash.current.scale.setScalar(1 + progress * 0.04);
    if (ghost.current) {
      ghost.current.scale.setScalar(1.05 + progress * 0.03);
      ghost.current.rotation.z = -0.04 * swing.flip;
    }

    const wisp = g.children.find((c) => c.name === "windWisp") as THREE.Mesh | undefined;
    if (wisp) {
      const a = THREE.MathUtils.lerp(-0.95, 1.1, progress);
      wisp.position.set(Math.cos(a) * BAND_VISUAL, Math.sin(a) * BAND_VISUAL, 0.02);
      wisp.rotation.z = a + Math.PI * 0.5;
      wisp.scale.set(0.55 + progress * 0.25, 0.22 + fade * 0.12, 1);
    }

    if (lightAt.current) {
      lightAt.current.position.set(BAND_VISUAL, 0.05, 0.02);
    }
    light.emitAt(lightAt.current, "#e2e8f0", fade * 1.5 * progress, tipReach + 1.2);
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]} rotation={[0, shot.yaw, 0]}>
      <group ref={blade}>
        <mesh ref={ghost} geometry={discGeo} renderOrder={40}>
          <primitive object={ghostMat} attach="material" />
        </mesh>
        <mesh ref={slash} geometry={discGeo} renderOrder={41}>
          <primitive object={slashMat} attach="material" />
        </mesh>
        <mesh name="windWisp" renderOrder={39}>
          <planeGeometry args={[1, 1]} />
          <primitive object={windMat} attach="material" />
        </mesh>
        <object3D ref={lightAt} position={[0.7, 0.05, 0.02]} />
        <AdditiveParticleBurst
          color="#cbd5e1"
          origin={[0.7, 0.05, 0.04]}
          count={8}
          life={0.3}
          speed={1.6}
          speedSpread={0.9}
          size={0.22}
          sizeEnd={0.04}
          lift={0.55}
          upBias={0.25}
          gravity={0.05}
          fadeIn={0.1}
          stagger={0.28}
          map={getWindStreakTexture()}
          trigger={shot.key}
        />
      </group>
    </group>
  );
}
