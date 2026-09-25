import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createLabGroundMarkMaterial,
  tickLabGroundMark,
} from "./vfx/engine/labShapeMaterials";
import { burstElementRole, spawnElementRole, type ElementHandle } from "./vfx/engine";
import { GEO_PLANE_1 } from "./vfx/sharedGeo";
import { SOUL_MARK_COLORS } from "./vfx/effects/soulMarkPalette";

const MARK_Y = 0.035;
const MARK_SIZE = 1.12;
const FEET_Y = 0.05;
/** Ground-well opacity by stack — 1st is a whisper, 3rd is the full well. */
const MARK_OPACITY = [0, 0.26, 0.58, 0.95] as const;
const MARK_SCALE = [0, 0.82, 0.94, 1.08] as const;
const WAKE_RATE = [0, 0.22, 0.4, 0.62] as const;

/**
 * Persistent Soul Mark on a body — lab void ground well + ParticleWorld wisps.
 *
 * Caster/travel/rupture: owned by the projectile and rupture one-shot.
 * Ground: void-mode lab mark (same GroundFoot as the elemental sandbox).
 * Particles: void ground role, rate scaled by stacks; no THREE.Points.
 */
export function SoulMarkOrnament({ getStacks }: { getStacks: () => number }) {
  const root = useRef<THREE.Group>(null);
  const mark = useRef<THREE.Mesh>(null);
  const wake = useRef<ElementHandle | null>(null);
  const world = useRef(new THREE.Vector3());
  const prevStacks = useRef(0);

  const groundMat = useMemo(
    () =>
      createLabGroundMarkMaterial(
        "void",
        {
          hot: SOUL_MARK_COLORS.bright,
          mid: SOUL_MARK_COLORS.primary,
          edge: SOUL_MARK_COLORS.darkCore,
        },
        { opacity: 0.9, additive: false },
      ),
    [],
  );

  useEffect(
    () => () => {
      wake.current?.kill();
      wake.current = null;
      groundMat.dispose();
    },
    [groundMat],
  );

  useFrame((_, dt) => {
    const stacks = Math.max(0, Math.min(3, Math.floor(getStacks())));
    const g = root.current;
    if (!g) return;

    const safeDt = Math.min(0.05, Math.max(0, dt));

    if (stacks <= 0) {
      g.visible = false;
      wake.current?.setRateScale(0);
      groundMat.uniforms.uOpacity!.value = 0;
      prevStacks.current = 0;
      return;
    }

    g.visible = true;
    g.getWorldPosition(world.current);
    tickLabGroundMark(groundMat, safeDt);

    const wx = world.current.x;
    const wy = world.current.y;
    const wz = world.current.z;

    if (!wake.current) {
      wake.current = spawnElementRole("void", "ground", wx, wy + FEET_Y, wz, {
        dirY: 0.04,
        spread: 0.18,
        gravity: 0.35,
        drag: 1.6,
        size: 0.2,
        sizeEnd: 0.48,
        life: 0.7,
        rate: 7,
        opacity: 0.16,
      });
    }
    wake.current.setPose(wx, wy + FEET_Y, wz);
    wake.current.setRateScale(WAKE_RATE[stacks]!);

    if (stacks > prevStacks.current) {
      burstElementRole("void", "ground", wx, wy + FEET_Y, wz, {
        duration: 0.05,
        burst: 5,
        rate: 0,
        dirY: 0.05,
        spread: 0.16,
        size: 0.18,
        sizeEnd: 0.42,
      });
    }
    prevStacks.current = stacks;

    const pulse = stacks >= 3 ? 0.92 + 0.08 * Math.sin(performance.now() * 0.007) : 1;
    groundMat.uniforms.uOpacity!.value = MARK_OPACITY[stacks]! * pulse;
    const s = MARK_SIZE * MARK_SCALE[stacks]!;
    mark.current?.scale.set(s, s, s);
  });

  return (
    <group ref={root} visible={false}>
      <mesh
        ref={mark}
        geometry={GEO_PLANE_1}
        material={groundMat}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, MARK_Y, 0]}
        scale={MARK_SIZE}
        renderOrder={7}
        frustumCulled={false}
      />
    </group>
  );
}
