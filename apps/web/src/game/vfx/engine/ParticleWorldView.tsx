import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { isOverlayOn, setPerfExtraLine } from "../../perfHudRuntime";
import { MAX_PARTICLES, MAX_PARTICLE_DRAWS, SIM_BUDGET_MS } from "./budgets";
import {
  bindParticleWorld,
  getParticleWorld,
  ParticleWorld,
} from "./particleWorld";
import {
  bindLightningArcWorld,
  LightningArcWorld,
} from "./lightningArcs";

/**
 * Stable scene node + world created in layout (not useMemo).
 * React StrictMode disposes effects twice; creating the SoA world in render
 * left getParticleWorld() pointing at a disposed simulator that never ticks.
 */
export function ParticleWorldView() {
  const holder = useMemo(() => {
    const g = new THREE.Group();
    g.name = "VfxParticleWorldHolder";
    return g;
  }, []);
  const worldRef = useRef<ParticleWorld | null>(null);
  const arcsRef = useRef<LightningArcWorld | null>(null);

  useLayoutEffect(() => {
    const world = new ParticleWorld();
    worldRef.current = world;
    holder.add(world.group);
    bindParticleWorld(world);

    const arcs = new LightningArcWorld();
    arcsRef.current = arcs;
    holder.add(arcs.group);
    bindLightningArcWorld(arcs);

    return () => {
      if (getParticleWorld() === world) bindParticleWorld(null);
      world.dispose();
      worldRef.current = null;
      bindLightningArcWorld(null);
      arcs.dispose();
      arcsRef.current = null;
    };
  }, [holder]);

  useFrame((state, dt) => {
    const world = worldRef.current;
    if (world) world.tick(dt);
    const arcs = arcsRef.current;
    if (arcs) {
      arcs.setCamera(state.camera);
      arcs.tick(dt);
    }
    if (!isOverlayOn() || !world) return;
    const s = world.stats;
    setPerfExtraLine({
      label: "particles",
      value: `${s.living}/${MAX_PARTICLES} e=${s.emitters} ${s.simMs.toFixed(2)}ms draws=${s.draws}${s.lodActive ? " LOD" : ""}`,
      warn: s.simMs > SIM_BUDGET_MS || s.draws > MAX_PARTICLE_DRAWS,
    });
  });

  return <primitive object={holder} />;
}
