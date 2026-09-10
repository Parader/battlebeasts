import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BINDING_SIGIL_CAST, MASS_SILENCE_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { createRuneMaterial, tickRuneMaterial } from "../materials/rune";

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

const SIGIL_CORE = "#7c3aed";
const SIGIL_HOT = "#ddd6fe";
const SIGIL_DEEP = "#5b21b6";
const SILENCE_CORE = "#a78bfa";
const SILENCE_HOT = "#f5f3ff";
const SILENCE_DEEP = "#6d28d9";

/**
 * Ground rune that lives the full sigil lifetime.
 * Arms at 750ms (activation flash) so the bind kick-in matches the VFX.
 * Variant 3 = Distorted Wake trail puff (short).
 */
export function BindingSigilEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const outer = useRef<THREE.Mesh>(null);
  const mid = useRef<THREE.Mesh>(null);
  const hex = useRef<THREE.Mesh>(null);
  const shock = useRef<THREE.Mesh>(null);
  const runeMesh = useRef<THREE.Mesh>(null);
  const rimOpacity = useRef(0);
  const rimProgress = useRef(0.35);

  const isWake = (shot.variant ?? 0) === 3;
  const radius = Math.max(0.5, shot.radius ?? (isWake ? 0.7 : BINDING_SIGIL_CAST.radius));
  const lifeMs = Math.max(isWake ? 520 : BINDING_SIGIL_CAST.lifetimeMs, shot.life);
  const armMs = BINDING_SIGIL_CAST.armingMs;

  const outerMat = useBasicMat(SIGIL_CORE);
  const midMat = useBasicMat(SIGIL_HOT);
  const hexMat = useBasicMat(SIGIL_DEEP);
  const shockMat = useBasicMat(SIGIL_HOT);
  const runeMat = useMemo(
    () => createRuneMaterial(SIGIL_HOT, { opacity: 0, spokes: 8 }),
    [],
  );
  useEffect(() => () => { runeMat.dispose(); }, [runeMat]);

  const outerGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.985, radius, 64),
    [radius],
  );
  const midGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.62, radius * 0.638, 48),
    [radius],
  );
  const hexGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.34, radius * 0.38, 6),
    [radius],
  );
  const shockGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.96, radius * 1.02, 64),
    [radius],
  );

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(shot.x, 0.04, shot.z);

    if (isWake) {
      const u = age / lifeMs;
      const env = softEnvelope(u, 0.1, 0.45);
      const grow = 0.45 + u * 1.35;
      if (outer.current) outer.current.scale.setScalar(grow);
      if (mid.current) mid.current.scale.setScalar(grow * 0.72);
      outerMat.opacity = 0.7 * env;
      midMat.opacity = 0.45 * env;
      hexMat.opacity = 0;
      shockMat.opacity = 0;
      runeMat.uniforms.uOpacity!.value = 0;
      if (runeMesh.current) runeMesh.current.visible = false;
      if (hex.current) hex.current.visible = false;
      if (shock.current) shock.current.visible = false;
      rimOpacity.current = env * 0.55;
      rimProgress.current = Math.min(1, 0.4 + u);
      return;
    }

    const armU = Math.min(1, age / armMs);
    const holdU = age / lifeMs;
    const fade = softEnvelope(holdU, 0.06, 0.82);
    const charging = 0.35 + armU * 0.65;
    const pulse = 1 + 0.018 * Math.sin(age * 0.008);
    const sinceArm = age - armMs;
    const flash = sinceArm >= 0 && sinceArm < 320
      ? 1 - sinceArm / 320
      : 0;

    tickRuneMaterial(runeMat, dt);
    if (outer.current) outer.current.scale.setScalar(charging * pulse);
    if (mid.current) mid.current.scale.setScalar(charging * (0.96 + 0.04 * pulse));
    if (hex.current) {
      hex.current.visible = true;
      hex.current.rotation.z += dt * (age < armMs ? 1.15 : 0.35);
      hex.current.scale.setScalar(charging);
    }
    if (shock.current) {
      const show = flash > 0.02;
      shock.current.visible = show;
      if (show) shock.current.scale.setScalar(0.55 + (1 - flash) * 1.15);
    }
    outerMat.opacity = (0.55 + flash * 0.4) * fade;
    midMat.opacity = (0.4 + flash * 0.35) * fade;
    hexMat.opacity = (0.62 + flash * 0.35) * fade;
    shockMat.opacity = 0.85 * flash;
    runeMat.uniforms.uOpacity!.value = (0.55 * charging + flash * 0.4) * fade;
    const rune = runeMesh.current;
    if (rune) {
      rune.visible = fade > 0.02;
      rune.rotation.z += dt * (age < armMs ? 1.4 : 0.45);
      rune.scale.setScalar(radius * 1.55 * charging);
    }
    rimOpacity.current = (0.42 + flash * 0.35) * fade;
    rimProgress.current = charging;
  });

  return (
    <group ref={root} visible={false}>
      <AoeRimMarker
        x={0}
        z={0}
        radius={radius}
        color={SIGIL_CORE}
        hotColor={SIGIL_HOT}
        fill={0.08}
        rimWidth={0.018}
        glowWidth={0.04}
        noise={0.12}
        opacity={0.55}
        opacityMulRef={rimOpacity}
        progressRef={rimProgress}
      />
      <mesh ref={outer} rotation={[-Math.PI / 2, 0, 0]} geometry={outerGeo} renderOrder={22}>
        <primitive object={outerMat} attach="material" />
      </mesh>
      <mesh
        ref={mid}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.006, 0]}
        geometry={midGeo}
        renderOrder={21}
      >
        <primitive object={midMat} attach="material" />
      </mesh>
      <mesh
        ref={hex}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        geometry={hexGeo}
        renderOrder={23}
      >
        <primitive object={hexMat} attach="material" />
      </mesh>
      <mesh
        ref={shock}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.014, 0]}
        geometry={shockGeo}
        visible={false}
        renderOrder={24}
      >
        <primitive object={shockMat} attach="material" />
      </mesh>
      <mesh
        ref={runeMesh}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        material={runeMat}
        visible={false}
        renderOrder={20}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}

/** Thin-circle nova that lingers for the full silence window. */
export function MassSilenceEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const waveA = useRef<THREE.Mesh>(null);
  const waveB = useRef<THREE.Mesh>(null);
  const holdOuter = useRef<THREE.Mesh>(null);
  const holdMid = useRef<THREE.Mesh>(null);
  const holdInner = useRef<THREE.Mesh>(null);
  const runeMesh = useRef<THREE.Mesh>(null);
  const rimOpacity = useRef(0);
  const rimProgress = useRef(0.2);

  const radius = Math.max(4, shot.radius ?? MASS_SILENCE_CAST.radius);
  const lifeMs = Math.max(MASS_SILENCE_CAST.silenceDurationMs, shot.life);

  const waveMat = useBasicMat(SILENCE_HOT);
  const waveMatB = useBasicMat(SILENCE_CORE);
  const holdMat = useBasicMat(SILENCE_CORE);
  const midMat = useBasicMat(SILENCE_HOT);
  const innerMat = useBasicMat(SILENCE_DEEP);
  const runeMat = useMemo(
    () => createRuneMaterial(SILENCE_HOT, { opacity: 0, spokes: 12 }),
    [],
  );
  useEffect(() => () => { runeMat.dispose(); }, [runeMat]);

  const waveGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.97, radius, 64),
    [radius],
  );
  const holdOuterGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.985, radius, 64),
    [radius],
  );
  const holdMidGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.64, radius * 0.655, 48),
    [radius],
  );
  const holdInnerGeo = useMemo(
    () => new THREE.RingGeometry(radius * 0.28, radius * 0.295, 36),
    [radius],
  );

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(shot.x, 0.045, shot.z);

    const u = age / lifeMs;
    const fade = softEnvelope(u, 0.05, 0.86);
    const expandMs = 420;
    const expand = Math.min(1, age / expandMs);
    const eased = expand * expand * (3 - 2 * expand);
    const pulse = 1 + 0.012 * Math.sin(age * 0.006);

    if (waveA.current) {
      const t = Math.min(1, age / 520);
      waveA.current.scale.setScalar(0.12 + t * 1.05);
      waveMat.opacity = (1 - t) * 0.85 * fade;
    }
    if (waveB.current) {
      const t = Math.min(1, Math.max(0, (age - 90) / 560));
      waveB.current.scale.setScalar(0.1 + t * 1.08);
      waveMatB.opacity = (1 - t) * 0.55 * fade;
    }
    if (holdOuter.current) holdOuter.current.scale.setScalar(eased * pulse);
    if (holdMid.current) holdMid.current.scale.setScalar(eased * (0.98 + 0.02 * pulse));
    if (holdInner.current) {
      holdInner.current.rotation.z += dt * 0.22;
      holdInner.current.scale.setScalar(eased);
    }
    holdMat.opacity = 0.62 * fade;
    midMat.opacity = 0.4 * fade;
    innerMat.opacity = 0.5 * fade;

    tickRuneMaterial(runeMat, dt);
    runeMat.uniforms.uOpacity!.value = 0.38 * fade * eased;
    const rune = runeMesh.current;
    if (rune) {
      rune.visible = fade > 0.02;
      rune.rotation.z += dt * 0.28;
      rune.scale.setScalar(radius * 0.55 * eased);
    }
    rimOpacity.current = 0.48 * fade;
    rimProgress.current = eased;
  });

  return (
    <group ref={root} visible={false}>
      <AoeRimMarker
        x={0}
        z={0}
        radius={radius}
        color={SILENCE_CORE}
        hotColor={SILENCE_HOT}
        fill={0.05}
        rimWidth={0.014}
        glowWidth={0.035}
        noise={0.1}
        opacity={0.5}
        opacityMulRef={rimOpacity}
        progressRef={rimProgress}
      />
      <mesh ref={waveA} rotation={[-Math.PI / 2, 0, 0]} geometry={waveGeo} renderOrder={24}>
        <primitive object={waveMat} attach="material" />
      </mesh>
      <mesh
        ref={waveB}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.004, 0]}
        geometry={waveGeo}
        renderOrder={23}
      >
        <primitive object={waveMatB} attach="material" />
      </mesh>
      <mesh
        ref={holdOuter}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.008, 0]}
        geometry={holdOuterGeo}
        renderOrder={22}
      >
        <primitive object={holdMat} attach="material" />
      </mesh>
      <mesh
        ref={holdMid}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        geometry={holdMidGeo}
        renderOrder={21}
      >
        <primitive object={midMat} attach="material" />
      </mesh>
      <mesh
        ref={holdInner}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.012, 0]}
        geometry={holdInnerGeo}
        renderOrder={21}
      >
        <primitive object={innerMat} attach="material" />
      </mesh>
      <mesh
        ref={runeMesh}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.018, 0]}
        material={runeMat}
        visible={false}
        renderOrder={20}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}
