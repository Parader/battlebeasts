/** ParticleWorld-backed dash particles; mesh silhouettes stay intact. */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  CYCLONE_KICK_CAST,
  ASCENDANT_FORM_CAST,
  DREAD_AURA_CAST,
} from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { createCirclePointMaterial, createSmokePointMaterial } from "../materials/circlePoint";
import { createLightningBoltMaterial, tickLightningBolt } from "../materials/lightningBolt";
import { createAscendantColumnMaterial } from "../materials/ascendantColumn";
import { burstElementRole, spawnElementRole, type ElementHandle } from "../engine";

function useBasicMat(color: string, additive = true) {
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => { mat.dispose(); }, [mat]);
  return mat;
}

// ============================================================================
// 1. Cyclone Kick Effect (4-second long spin, ultra-thin circles, vortex ribbons)
// ============================================================================
/** ParticleWorld owns the caster whirl; local meshes retain the kick silhouette. */
export function CycloneKickEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const slashArcA = useRef<THREE.Mesh>(null);
  const slashArcB = useRef<THREE.Mesh>(null);
  const outerBorder = useRef<THREE.Mesh>(null);
  const innerRing = useRef<THREE.Mesh>(null);
  const vortexCone = useRef<THREE.Mesh>(null);
  const castWind = useRef<ElementHandle | null>(null);

  const radius = Math.max(1.8, shot.radius ?? CYCLONE_KICK_CAST.radius);
  // Full 4s duration
  const lifeMs = Math.max(3800, shot.life);

  const cyanMat = useBasicMat("#38BDF8", true); // bright wind cyan
  const tealMat = useBasicMat("#2DD4BF", true); // mint-teal wind
  const whiteMat = useBasicMat("#F8FAFC", true); // razor slash core
  const coneMat = useBasicMat("#0284C7", true); // soft vortex body

  // Ultra-thin crisp borders
  const outerBorderGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.97, radius, 64),
    [radius],
  );
  const innerRingGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.58, radius * 0.595, 48),
    [radius],
  );
  // Two crescent slashes spinning at kick height
  const slashGeoA = useMemo(
    () => new THREE.RingGeometry(radius * 0.72, radius * 0.98, 48, 1, 0, Math.PI * 0.9),
    [radius],
  );
  const slashGeoB = useMemo(
    () => new THREE.RingGeometry(radius * 0.72, radius * 0.98, 48, 1, Math.PI, Math.PI * 0.9),
    [radius],
  );
  // Translucent vortex cone
  const coneGeo = useMemo(
    () => new THREE.CylinderGeometry(radius * 0.95, radius * 0.35, 1.4, 32, 1, true),
    [radius],
  );

  useEffect(() => {
    const handle = spawnElementRole("wind", "cast", shot.x, 0.45, shot.z);
    handle.setRateScale(0);
    castWind.current = handle;
    return () => {
      handle.kill();
      if (castWind.current === handle) castWind.current = null;
    };
  }, [shot.x, shot.z]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      castWind.current?.kill();
      castWind.current = null;
      return;
    }
    g.visible = true;

    // Follow caster for the full 4 seconds smoothly without client/server jitter
    const isLocal = Boolean(shot.followOwnerId && follow?.localSessionId && shot.followOwnerId === follow.localSessionId);
    const pred = isLocal ? follow?.predictedRef?.current : null;
    let px = pred?.x ?? shot.x;
    let pz = pred?.z ?? shot.z;
    if (!pred && shot.followOwnerId && follow?.room?.state?.players) {
      const owner = follow.room.state.players.get(shot.followOwnerId);
      if (owner) {
        px = owner.x;
        pz = owner.z;
      }
    }
    g.position.set(px, 0.05, pz);

    const u = age / lifeMs;
    // Fade in quickly, hold strong for 4s, fade out smoothly at end
    const fade = softEnvelope(u, 0.04, 0.92);
    castWind.current?.setPose(px, 0.45, pz);
    castWind.current?.setRateScale(fade);

    // Continuous high-speed spin (matches Hurricane Kick character animation spin direction)
    const spin = age * 0.016;

    if (slashArcA.current) {
      slashArcA.current.rotation.z = spin;
    }
    if (slashArcB.current) {
      slashArcB.current.rotation.z = spin;
    }
    whiteMat.opacity = 0.9 * fade;
    cyanMat.opacity = 0.85 * fade;

    // Thin ground border rings with gentle pulse
    if (outerBorder.current) {
      const pulse = 1.0 + 0.02 * Math.sin(age * 0.01);
      outerBorder.current.scale.setScalar(pulse);
    }
    tealMat.opacity = 0.75 * fade;

    if (vortexCone.current) {
      vortexCone.current.position.y = 0.75;
      vortexCone.current.rotation.y = spin * 0.5;
    }
    coneMat.opacity = 0.12 * fade;

  });

  return (
    <group ref={root} visible={false}>
      {/* Ultra-thin outer perimeter border */}
      <mesh ref={outerBorder} geometry={outerBorderGeo} rotation={[-Math.PI * 0.5, 0, 0]} renderOrder={31}>
        <primitive object={tealMat} attach="material" />
      </mesh>
      {/* Concentric inner thin ring */}
      <mesh ref={innerRing} geometry={innerRingGeo} rotation={[-Math.PI * 0.5, 0, 0]} renderOrder={31}>
        <primitive object={tealMat} attach="material" />
      </mesh>
      {/* Spinning crescent slashes at kick height */}
      <mesh ref={slashArcA} geometry={slashGeoA} position={[0, 0.65, 0]} rotation={[-Math.PI * 0.5, 0, 0]} renderOrder={34}>
        <primitive object={whiteMat} attach="material" />
      </mesh>
      <mesh ref={slashArcB} geometry={slashGeoB} position={[0, 0.65, 0]} rotation={[-Math.PI * 0.5, 0, 0]} renderOrder={34}>
        <primitive object={cyanMat} attach="material" />
      </mesh>
      {/* Soft translucent vortex funnel */}
      <mesh ref={vortexCone} geometry={coneGeo} renderOrder={32}>
        <primitive object={coneMat} attach="material" />
      </mesh>
    </group>
  );
}

// ============================================================================
// 2. Phantom Rush Effect (Chained hop, lands opposite side, motion streaks)
// ============================================================================
export function PhantomRushEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const ribbonVert = useRef<THREE.Mesh>(null);
  const ribbonHoriz = useRef<THREE.Mesh>(null);
  const sliceA = useRef<THREE.Mesh>(null);
  const sliceB = useRef<THREE.Mesh>(null);
  const trail = useRef<ElementHandle | null>(null);
  const lifeMs = Math.max(220, shot.life);

  const startX = shot.originX ?? shot.x;
  const startZ = shot.originZ ?? shot.z;
  const targetX = shot.x;
  const targetZ = shot.z;

  const dx = targetX - startX;
  const dz = targetZ - startZ;
  const dist = Math.hypot(dx, dz) || 0.01;

  const violetMat = useBasicMat("#8B5CF6", true); // electric violet
  const cyanMat = useBasicMat("#67E8F9", true); // ethereal cyan core
  const slashMat = useBasicMat("#F8FAFC", true); // razor white slice

  const ribbonGeo = useMemo(() => new THREE.PlaneGeometry(1, 0.55), []);
  const sliceGeo = useMemo(() => new THREE.BoxGeometry(0.08, 0.08, 1.6), []);
  const ribbonBases = useMemo(() => {
    const dirX = new THREE.Vector3(dx / dist, 0, dz / dist);
    const dirY = new THREE.Vector3(0, 1, 0);
    const dirZ = new THREE.Vector3().crossVectors(dirX, dirY).normalize();
    return {
      vertical: new THREE.Matrix4().makeBasis(dirX, dirY, dirZ),
      horizontal: new THREE.Matrix4().makeBasis(dirX, dirZ, dirY.clone().negate()),
    };
  }, [dist, dx, dz]);

  useEffect(() => {
    const handle = spawnElementRole("wind", "trail", startX, 0.7, startZ);
    handle.setRateScale(0);
    trail.current = handle;
    return () => {
      handle.kill();
      if (trail.current === handle) trail.current = null;
    };
  }, [shot.key, startX, startZ]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      trail.current?.kill();
      trail.current = null;
      return;
    }
    g.visible = true;

    const u = age / lifeMs;
    const fade = softEnvelope(u, 0.05, 0.45);

    const midX = (startX + targetX) * 0.5;
    const midY = 0.85;
    const midZ = (startZ + targetZ) * 0.5;

    // Vertical ribbon along travel path
    if (ribbonVert.current) {
      ribbonVert.current.position.set(midX, midY, midZ);
      ribbonVert.current.scale.set(dist, 1 - u * 0.4, 1);
      ribbonVert.current.quaternion.setFromRotationMatrix(ribbonBases.vertical);
    }

    // Horizontal ribbon along travel path
    if (ribbonHoriz.current) {
      ribbonHoriz.current.position.set(midX, 0.4, midZ);
      ribbonHoriz.current.scale.set(dist, 0.7 * (1 - u * 0.5), 1);
      ribbonHoriz.current.quaternion.setFromRotationMatrix(ribbonBases.horizontal);
    }

    violetMat.opacity = 0.85 * fade;
    cyanMat.opacity = 0.95 * fade;

    // Cross-slash spark burst at landing
    const slashU = Math.min(1, age / (lifeMs * 0.6));
    const slashFade = (1 - slashU) * fade;
    const baseAngle = Math.atan2(dx, dz);
    if (sliceA.current) {
      sliceA.current.position.set(targetX, 0.85, targetZ);
      sliceA.current.rotation.set(0.2, baseAngle + Math.PI * 0.25, Math.PI * 0.35);
      sliceA.current.scale.set(1, 1, 0.6 + slashU * 0.8);
    }
    if (sliceB.current) {
      sliceB.current.position.set(targetX, 0.85, targetZ);
      sliceB.current.rotation.set(-0.2, baseAngle - Math.PI * 0.25, -Math.PI * 0.35);
      sliceB.current.scale.set(1, 1, 0.6 + slashU * 0.8);
    }
    slashMat.opacity = 0.95 * slashFade;

    const travel = Math.min(1, u * 1.2);
    trail.current?.setPose(startX + dx * travel, 0.7, startZ + dz * travel);
    trail.current?.setRateScale(fade);
  });

  return (
    <group ref={root} visible={false}>
      {/* Electric motion streak ribbons */}
      <mesh ref={ribbonVert} geometry={ribbonGeo} renderOrder={34}>
        <primitive object={cyanMat} attach="material" />
      </mesh>
      <mesh ref={ribbonHoriz} geometry={ribbonGeo} renderOrder={33}>
        <primitive object={violetMat} attach="material" />
      </mesh>
      {/* Razor cross slashes at destination */}
      <mesh ref={sliceA} geometry={sliceGeo} renderOrder={36}>
        <primitive object={slashMat} attach="material" />
      </mesh>
      <mesh ref={sliceB} geometry={sliceGeo} renderOrder={36}>
        <primitive object={slashMat} attach="material" />
      </mesh>
    </group>
  );
}

// ============================================================================
// 3. Ascendant Form Effect (Thin elegant rings, subtle soft yellow glow)
// ============================================================================
export function AscendantFormEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const outerRing = useRef<THREE.Mesh>(null);
  const innerRing = useRef<THREE.Mesh>(null);
  const runeStar = useRef<THREE.Group>(null);
  const softPillar = useRef<THREE.Mesh>(null);

  const isPulse = (shot.variant ?? 0) === 1; // 1 = periodic damage pulse
  const lifeMs = isPulse ? 520 : Math.max(900, shot.life);
  const radius = Math.max(1.8, shot.radius ?? ASCENDANT_FORM_CAST.auraRadius);

  const goldMat = useBasicMat("#F59E0B", true); // solar gold
  const amberMat = useBasicMat("#FDE68A", true); // radiant amber

  const lightColumnMat = useMemo(() => createAscendantColumnMaterial(), []);
  useEffect(() => () => { lightColumnMat.dispose(); }, [lightColumnMat]);

  // Thin clean concentric rings
  const outerRingGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.98, radius, 64),
    [radius],
  );
  const innerRingGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.68, radius * 0.695, 48),
    [radius],
  );
  // Elegant light column tapering from base to top
  const pillarGeo = useMemo(
    () => new THREE.CylinderGeometry(0.55, 1.35, 4.2, 32, 8, true),
    [],
  );
  const spokeGeo = useMemo(
    () => new THREE.PlaneGeometry(radius * 1.36, 0.02),
    [radius],
  );

  const MOTES = 24;
  const motePos = useMemo(() => new Float32Array(MOTES * 3), []);
  const moteSize = useMemo(() => new Float32Array(MOTES), []);
  const moteAlpha = useMemo(() => new Float32Array(MOTES), []);
  const moteGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(moteSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(moteAlpha, 1));
    return g;
  }, [motePos, moteSize, moteAlpha]);
  const moteMat = useMemo(() => createSmokePointMaterial("#FDE68A"), []);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;

    // Smooth position following with predicted pose for local player
    const isLocal = Boolean(shot.followOwnerId && follow?.localSessionId && shot.followOwnerId === follow.localSessionId);
    const pred = isLocal ? follow?.predictedRef?.current : null;
    let px = pred?.x ?? shot.x;
    let pz = pred?.z ?? shot.z;
    if (!pred && shot.followOwnerId && follow?.room?.state?.players) {
      const owner = follow.room.state.players.get(shot.followOwnerId);
      if (owner) {
        px = owner.x;
        pz = owner.z;
      }
    }
    g.position.set(px, 0.055, pz);

    const u = age / lifeMs;
    const fade = softEnvelope(u, 0.08, 0.45);

    if (isPulse) {
      if (outerRing.current) {
        const ringProg = Math.sqrt(u);
        outerRing.current.scale.setScalar(0.4 + 0.65 * ringProg);
      }
      goldMat.opacity = 0.8 * fade;
      amberMat.opacity = 0.75 * fade;
    } else {
      // Soft radiant column fading seamlessly to 0% at the top
      if (softPillar.current) {
        softPillar.current.position.y = 2.1;
        softPillar.current.rotation.y = age * 0.0012;
        const pScale = Math.min(1, age / 200) * (1 - u * 0.35);
        softPillar.current.scale.set(pScale, 1, pScale);
      }
      lightColumnMat.uniforms.uTime.value = performance.now() * 0.001;
      lightColumnMat.uniforms.uOpacity.value = 0.22 * fade;

      if (runeStar.current) {
        runeStar.current.rotation.z = -age * 0.001;
      }
      goldMat.opacity = 0.85 * fade;
      amberMat.opacity = 0.75 * fade;

      // Soft ascending solar motes
      for (let i = 0; i < MOTES; i++) {
        const ang = (i / MOTES) * Math.PI * 2 + u * 1.5;
        const dist = 0.4 + (i % 4) * 0.35;
        motePos[i * 3] = Math.cos(ang) * dist;
        motePos[i * 3 + 1] = 0.2 + ((age * 0.002 + i * 0.25) % 2.5);
        motePos[i * 3 + 2] = Math.sin(ang) * dist;
        moteSize[i] = 0.12 * (1 - u * 0.3);
        moteAlpha[i] = fade * 0.7;
      }
      moteGeo.attributes.position.needsUpdate = true;
      moteGeo.attributes.aSize.needsUpdate = true;
      moteGeo.attributes.aAlpha.needsUpdate = true;
    }
  });

  return (
    <group ref={root} visible={false}>
      {/* Outer thin ring */}
      <mesh ref={outerRing} geometry={outerRingGeo} rotation={[-Math.PI * 0.5, 0, 0]} renderOrder={32}>
        <primitive object={goldMat} attach="material" />
      </mesh>
      {!isPulse ? (
        <>
          {/* Inner thin ring */}
          <mesh ref={innerRing} geometry={innerRingGeo} rotation={[-Math.PI * 0.5, 0, 0]} renderOrder={32}>
            <primitive object={amberMat} attach="material" />
          </mesh>
          {/* Inscribed 4-spoke solar rune */}
          <group ref={runeStar} rotation={[-Math.PI * 0.5, 0, 0]}>
            <mesh geometry={spokeGeo} renderOrder={31}>
              <primitive object={amberMat} attach="material" />
            </mesh>
            <mesh geometry={spokeGeo} rotation={[0, 0, Math.PI * 0.25]} renderOrder={31}>
              <primitive object={amberMat} attach="material" />
            </mesh>
            <mesh geometry={spokeGeo} rotation={[0, 0, Math.PI * 0.5]} renderOrder={31}>
              <primitive object={amberMat} attach="material" />
            </mesh>
            <mesh geometry={spokeGeo} rotation={[0, 0, Math.PI * 0.75]} renderOrder={31}>
              <primitive object={amberMat} attach="material" />
            </mesh>
          </group>
          {/* Soft radiant vertical ascension beam fading to 0% at the top */}
          <mesh ref={softPillar} geometry={pillarGeo} renderOrder={33}>
            <primitive object={lightColumnMat} attach="material" />
          </mesh>
          <points geometry={moteGeo} renderOrder={35}>
            <primitive object={moteMat} attach="material" />
          </points>
        </>
      ) : null}
    </group>
  );
}

// ============================================================================
// 4. Dread Aura Effect (Intricate purple sigil on caster)
// ============================================================================
export function DreadAuraEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const sigilGroup = useRef<THREE.Group>(null);
  const auraFx = useRef<ElementHandle | null>(null);

  const isTrigger = (shot.variant ?? 0) === 1; // 1 = reactive fear trigger burst
  const lifeMs = isTrigger ? 500 : Math.max(1200, shot.life);
  const radius = Math.max(2.5, shot.radius ?? DREAD_AURA_CAST.radius);

  const violetMat = useBasicMat("#9333EA", true); // mystic purple
  const fearMat = useBasicMat("#C084FC", true); // bright lavender edge
  const shadowMat = useBasicMat("#581C87", true); // deep void core

  // Occult concentric thin rings
  const outerRingGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.98, radius, 64),
    [radius],
  );
  const midRingGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.74, radius * 0.755, 48),
    [radius],
  );
  const innerRingGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.38, radius * 0.395, 36),
    [radius],
  );
  // Sigil geometric star spokes
  const spokeGeo = useMemo(
    () => new THREE.PlaneGeometry(radius * 1.48, 0.022),
    [radius],
  );

  /** ParticleWorld owns the Dread Aura shell and trigger sparks. */
  useEffect(() => {
    if (isTrigger) {
      burstElementRole("void", "impact", shot.x, shot.y + 0.8, shot.z);
      return;
    }
    const handle = spawnElementRole("void", "cast", shot.x, 0.12, shot.z);
    handle.setRateScale(0);
    auraFx.current = handle;
    return () => {
      handle.kill();
      if (auraFx.current === handle) auraFx.current = null;
    };
  }, [isTrigger, shot.key, shot.x, shot.y, shot.z]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      auraFx.current?.setRateScale(0);
      return;
    }
    g.visible = true;

    if (isTrigger) {
      g.position.set(shot.x, 0.8, shot.z);
    } else {
      // Persistent Dread Aura sigil follows caster
      let px = shot.x;
      let pz = shot.z;
      if (shot.followOwnerId && follow?.room?.state?.players) {
        const owner = follow.room.state.players.get(shot.followOwnerId);
        if (owner) {
          px = owner.x;
          pz = owner.z;
        }
      }
      g.position.set(px, 0.035, pz);

      const u = age / lifeMs;
      const fade = softEnvelope(u, 0.05, 0.8);
      auraFx.current?.setPose(px, 0.12, pz);
      auraFx.current?.setRateScale(fade);

      // Slow occult counter-clockwise rotation of the ground sigil
      if (sigilGroup.current) {
        sigilGroup.current.rotation.z = -age * 0.0006;
      }
      violetMat.opacity = 0.85 * fade;
      fearMat.opacity = 0.95 * fade;
      shadowMat.opacity = 0.65 * fade;

    }
  });

  return (
    <group ref={root} visible={false}>
      {isTrigger ? (
        null
      ) : (
        <>
          {/* Intricate rotating purple occult sigil */}
          <group ref={sigilGroup} rotation={[-Math.PI * 0.5, 0, 0]}>
            {/* Outer thin ring */}
            <mesh geometry={outerRingGeo} renderOrder={32}>
              <primitive object={fearMat} attach="material" />
            </mesh>
            {/* Mid thin ring */}
            <mesh geometry={midRingGeo} renderOrder={32}>
              <primitive object={violetMat} attach="material" />
            </mesh>
            {/* Inner core thin ring */}
            <mesh geometry={innerRingGeo} renderOrder={32}>
              <primitive object={fearMat} attach="material" />
            </mesh>
            {/* 8-pointed star geometry spokes */}
            <mesh geometry={spokeGeo} renderOrder={31}>
              <primitive object={shadowMat} attach="material" />
            </mesh>
            <mesh geometry={spokeGeo} rotation={[0, 0, Math.PI * 0.25]} renderOrder={31}>
              <primitive object={shadowMat} attach="material" />
            </mesh>
            <mesh geometry={spokeGeo} rotation={[0, 0, Math.PI * 0.5]} renderOrder={31}>
              <primitive object={shadowMat} attach="material" />
            </mesh>
            <mesh geometry={spokeGeo} rotation={[0, 0, Math.PI * 0.75]} renderOrder={31}>
              <primitive object={shadowMat} attach="material" />
            </mesh>
          </group>
        </>
      )}
    </group>
  );
}

// ============================================================================
// 5. World Tree Effect (Spawn roots, healing seed arrival, and healing fumes)
// ============================================================================
export function WorldTreeEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const seedMesh = useRef<THREE.Mesh>(null);
  const seedAuraMesh = useRef<THREE.Mesh>(null);

  const variant = shot.variant ?? 0;
  const isSeed = variant === 1; // Healing seed arriving at target
  const isBreak = variant === 2; // Despawn / break burst
  const lifeMs = isSeed ? 1600 : isBreak ? 550 : 1200;

  const startX = shot.originX ?? shot.x;
  const startZ = shot.originZ ?? shot.z;
  const targetX = shot.x;
  const targetZ = shot.z;

  const harmonyMat = useBasicMat("#4ADE80", true); // emerald green
  const mintMat = useBasicMat("#86EFAC", true); // light mint
  const goldMat = useBasicMat("#FDE68A", true); // gold-white

  const FUMES = 56;
  const fumePos = useMemo(() => new Float32Array(FUMES * 3), []);
  const fumeSize = useMemo(() => new Float32Array(FUMES), []);
  const fumeAlpha = useMemo(() => new Float32Array(FUMES), []);
  const fumeGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(fumePos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(fumeSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(fumeAlpha, 1));
    return g;
  }, [fumePos, fumeSize, fumeAlpha]);
  const fumeColor = shot.abilityId.startsWith("pickup_")
    ? shot.color || "#6EE7B7"
    : "#6EE7B7";
  const fumeMat = useMemo(() => createCirclePointMaterial(fumeColor), [fumeColor]);
  useEffect(() => () => { fumeMat.dispose(); }, [fumeMat]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const u = age / lifeMs;

    if (isSeed) {
      // Parabolic seed arc from tree (startX, startZ) to ally (targetX, targetZ)
      const flightDuration = 380;
      const inFlight = age < flightDuration;
      const arcProg = Math.min(1.0, age / flightDuration);
      const curX = startX + (targetX - startX) * arcProg;
      const curZ = startZ + (targetZ - startZ) * arcProg;
      const arcHeight = Math.sin(arcProg * Math.PI) * 2.2;
      const curY = 0.65 + arcHeight;

      if (inFlight) {
        if (seedMesh.current) {
          seedMesh.current.visible = true;
          seedMesh.current.position.set(curX, curY, curZ);
          seedMesh.current.scale.setScalar(1.0);
        }
        if (seedAuraMesh.current) {
          seedAuraMesh.current.visible = true;
          seedAuraMesh.current.position.set(curX, curY, curZ);
          seedAuraMesh.current.scale.setScalar(1.3);
        }
        harmonyMat.opacity = 0.95;
        goldMat.opacity = 0.85;

        // Sparkle motes trailing behind the flying seed
        for (let i = 0; i < FUMES; i++) {
          const frac = Math.max(0, arcProg - (i / FUMES) * 0.28);
          fumePos[i * 3] = startX + (targetX - startX) * frac;
          fumePos[i * 3 + 1] = 0.65 + Math.sin(frac * Math.PI) * 2.2 + Math.sin(i * 3) * 0.12;
          fumePos[i * 3 + 2] = startZ + (targetZ - startZ) * frac;
          fumeSize[i] = (1.2 + 0.5 * Math.sin(i * 1.5)) * (1.0 - (i / FUMES) * 0.4);
          fumeAlpha[i] = (1.0 - (i / FUMES) * 0.7) * 0.85;
        }
      } else {
        // Seed arrived: hide seed ball
        if (seedMesh.current) seedMesh.current.visible = false;
        if (seedAuraMesh.current) seedAuraMesh.current.visible = false;

        // Resolve live target position if target is moving
        let curTargetX = targetX;
        let curTargetZ = targetZ;
        if (shot.targetId && follow) {
          if (follow.localSessionId && shot.targetId === follow.localSessionId && follow.predictedRef?.current) {
            curTargetX = follow.predictedRef.current.x;
            curTargetZ = follow.predictedRef.current.z;
          } else {
            const p = follow.room?.state?.players?.get(shot.targetId) as { x?: number; z?: number } | undefined;
            if (p && typeof p.x === "number" && typeof p.z === "number") {
              curTargetX = p.x;
              curTargetZ = p.z;
            } else {
              const t = follow.room?.state?.targets?.get(shot.targetId) as { x?: number; z?: number } | undefined;
              if (t && typeof t.x === "number" && typeof t.z === "number") {
                curTargetX = t.x;
                curTargetZ = t.z;
              }
            }
          }
        }

        // Restorative healing fumes rising around the character's body
        const fumeAge = age - flightDuration;
        const fumeTotal = lifeMs - flightDuration;
        const overallFade = Math.min(1.0, fumeAge / 80) * Math.min(1.0, (fumeTotal - fumeAge) / 250);

        for (let i = 0; i < FUMES; i++) {
          const pOffset = i / FUMES;
          const pProg = (fumeAge * 0.0011 + pOffset) % 1.0;
          const ang = pOffset * Math.PI * 2 + pProg * 4.8;
          const r = 0.26 + 0.12 * Math.sin(i * 4.1 + pProg * 3.5);
          fumePos[i * 3] = curTargetX + Math.cos(ang) * r;
          fumePos[i * 3 + 1] = 0.12 + pProg * 2.25;
          fumePos[i * 3 + 2] = curTargetZ + Math.sin(ang) * r;
          const sz = Math.sin(pProg * Math.PI);
          fumeSize[i] = (1.4 + 0.8 * sz) * 1.6;
          fumeAlpha[i] = overallFade * sz * 0.95;
        }
      }

      fumeGeo.attributes.position.needsUpdate = true;
      fumeGeo.attributes.aSize.needsUpdate = true;
      fumeGeo.attributes.aAlpha.needsUpdate = true;
    } else if (isBreak) {
      // Tree despawn / break burst of motes
      const fade = softEnvelope(u, 0.06, 0.45);
      g.position.set(shot.x, 0.5, shot.z);
      harmonyMat.opacity = 0.85 * fade;
      mintMat.opacity = 0.9 * fade;
      goldMat.opacity = 0.75 * fade;

      for (let i = 0; i < FUMES; i++) {
        const ang = (i / FUMES) * Math.PI * 2;
        const spd = 1.2;
        fumePos[i * 3] = Math.cos(ang) * u * spd * 1.8;
        fumePos[i * 3 + 1] = 0.2 + u * 1.6;
        fumePos[i * 3 + 2] = Math.sin(ang) * u * spd * 1.8;
        fumeSize[i] = (1.2 + 0.4 * Math.sin(i)) * (1 - u * 0.5);
        fumeAlpha[i] = fade * 0.85;
      }
      fumeGeo.attributes.position.needsUpdate = true;
      fumeGeo.attributes.aSize.needsUpdate = true;
      fumeGeo.attributes.aAlpha.needsUpdate = true;
    } else {
      // Variant 0 (direct heal tick): restorative healing fumes rising from the character
      let curTargetX = shot.x;
      let curTargetZ = shot.z;
      if (shot.targetId && follow) {
        if (follow.localSessionId && shot.targetId === follow.localSessionId && follow.predictedRef?.current) {
          curTargetX = follow.predictedRef.current.x;
          curTargetZ = follow.predictedRef.current.z;
        } else {
          const p = follow.room?.state?.players?.get(shot.targetId) as { x?: number; z?: number } | undefined;
          if (p && typeof p.x === "number" && typeof p.z === "number") {
            curTargetX = p.x;
            curTargetZ = p.z;
          }
        }
      }
      const overallFade = softEnvelope(u, 0.08, 0.7);
      for (let i = 0; i < FUMES; i++) {
        const pOffset = i / FUMES;
        const pProg = (age * 0.0011 + pOffset) % 1.0;
        const ang = pOffset * Math.PI * 2 + pProg * 4.5;
        const r = 0.28 + 0.12 * Math.sin(i * 3.7 + pProg * 3.0);
        fumePos[i * 3] = curTargetX + Math.cos(ang) * r;
        fumePos[i * 3 + 1] = 0.12 + pProg * 2.15;
        fumePos[i * 3 + 2] = curTargetZ + Math.sin(ang) * r;
        const sz = Math.sin(pProg * Math.PI);
        fumeSize[i] = (1.4 + 0.8 * sz) * 1.6;
        fumeAlpha[i] = overallFade * sz * 0.95;
      }
      fumeGeo.attributes.position.needsUpdate = true;
      fumeGeo.attributes.aSize.needsUpdate = true;
      fumeGeo.attributes.aAlpha.needsUpdate = true;
    }
  });

  return (
    <group ref={root} visible={false}>
      {isSeed ? (
        <>
          {/* Flying delicate golden/emerald seed orb */}
          <mesh ref={seedMesh} renderOrder={37}>
            <sphereGeometry args={[0.09, 12, 12]} />
            <primitive object={harmonyMat} attach="material" />
          </mesh>
          {/* Luminous corona glow on the seed */}
          <mesh ref={seedAuraMesh} renderOrder={36}>
            <sphereGeometry args={[0.13, 12, 12]} />
            <primitive object={goldMat} attach="material" />
          </mesh>
          {/* Restorative healing fumes on the target */}
          <points geometry={fumeGeo} frustumCulled={false} renderOrder={38}>
            <primitive object={fumeMat} attach="material" />
          </points>
        </>
      ) : (
        /* Healing fumes or break motes */
        <points geometry={fumeGeo} frustumCulled={false} renderOrder={38}>
          <primitive object={fumeMat} attach="material" />
        </points>
      )}
    </group>
  );
}

// ============================================================================
// 6. Divine Beam Overflow Branch Effect (Green electric lightning)
// ============================================================================
export function DivineBeamOverflowEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const boltVert = useRef<THREE.Mesh>(null);
  const boltHoriz = useRef<THREE.Mesh>(null);
  const fromSpark = useRef<THREE.Mesh>(null);
  const toSpark = useRef<THREE.Mesh>(null);
  const lifeMs = Math.max(340, shot.life);

  const startX = shot.x;
  const startZ = shot.z;
  const endX = shot.originX ?? shot.x;
  const endZ = shot.originZ ?? shot.z;

  const dx = endX - startX;
  const dz = endZ - startZ;
  const dist = Math.hypot(dx, dz) || 0.01;

  // Authentic green electric lightning material with animated shader noise
  const boltMat = useMemo(
    () =>
      createLightningBoltMaterial("#22c55e", {
        hot: "#86efac",
        opacity: 0.95,
      }),
    [],
  );

  const sparkMat = useBasicMat("#4ade80", true);
  const ribbonGeo = useMemo(() => new THREE.PlaneGeometry(1, 0.45), []);
  const sparkGeo = useMemo(() => new THREE.RingGeometry(0.08, 0.45, 16), []);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;

    tickLightningBolt(boltMat, dt * 1.8);

    const u = age / lifeMs;
    const fade = softEnvelope(u, 0.05, 0.4);

    // Directional basis for green lightning ribbons
    const dirX = new THREE.Vector3(dx / dist, 0, dz / dist);
    const dirY = new THREE.Vector3(0, 1, 0);
    const dirZ = new THREE.Vector3().crossVectors(dirX, dirY).normalize();

    const midX = (startX + endX) * 0.5;
    const midY = 1.05;
    const midZ = (startZ + endZ) * 0.5;

    // Vertical ribbon
    const mVert = new THREE.Matrix4().makeBasis(dirX, dirY, dirZ);
    if (boltVert.current) {
      boltVert.current.position.set(midX, midY, midZ);
      boltVert.current.scale.set(dist, 1.0, 1);
      boltVert.current.quaternion.setFromRotationMatrix(mVert);
    }

    // Horizontal ribbon
    const mHoriz = new THREE.Matrix4().makeBasis(dirX, dirZ, dirY.clone().negate());
    if (boltHoriz.current) {
      boltHoriz.current.position.set(midX, midY, midZ);
      boltHoriz.current.scale.set(dist, 0.85, 1);
      boltHoriz.current.quaternion.setFromRotationMatrix(mHoriz);
    }

    if (boltMat.uniforms.uOpacity) {
      boltMat.uniforms.uOpacity.value = fade * 0.95;
    }

    // Green sparks at endpoints
    if (fromSpark.current) {
      fromSpark.current.position.set(startX, 1.05, startZ);
      fromSpark.current.scale.setScalar(0.7 + 0.5 * Math.sin(age * 0.02));
    }
    if (toSpark.current) {
      toSpark.current.position.set(endX, 1.05, endZ);
      toSpark.current.scale.setScalar(0.8 + 0.6 * Math.sin(age * 0.02 + 1));
    }
    sparkMat.opacity = fade * 0.9;
  });

  return (
    <group ref={root} visible={false}>
      {/* Crossing green lightning ribbons */}
      <mesh ref={boltVert} geometry={ribbonGeo} material={boltMat} renderOrder={36} />
      <mesh ref={boltHoriz} geometry={ribbonGeo} material={boltMat} renderOrder={36} />
      {/* Origin and destination electric spark rings */}
      <mesh ref={fromSpark} geometry={sparkGeo} rotation={[-Math.PI * 0.5, 0, 0]} renderOrder={37}>
        <primitive object={sparkMat} attach="material" />
      </mesh>
      <mesh ref={toSpark} geometry={sparkGeo} rotation={[-Math.PI * 0.5, 0, 0]} renderOrder={37}>
        <primitive object={sparkMat} attach="material" />
      </mesh>
    </group>
  );
}
