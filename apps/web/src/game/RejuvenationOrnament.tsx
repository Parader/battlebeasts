import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createLabGroundMarkMaterial,
  tickLabGroundMark,
} from "./vfx/engine/labShapeMaterials";
import { burstElementRole, spawnElementRole, type ElementHandle } from "./vfx/engine";
import { GEO_PLANE_1 } from "./vfx/sharedGeo";

const HEAL_COLORS = { hot: "#a7f3d0", mid: "#6ee7b7", edge: "#14532d" };
const MARK_Y = 0.035;
const MARK_SIZE = 1.2;
const FEET_Y = 0.06;
const MARK_OPACITY = [0, 0.42, 0.7, 0.95] as const;
const MARK_SCALE = [0, 0.8, 0.96, 1.14] as const;
const WAKE_RATE = [0, 0.5, 0.82, 1.15] as const;

/**
 * Persistent rejuvenation on a body — lab heal spiral at the feet + leaf mist.
 *
 * Body leaves stay in StatusAuraFx. This is the ground well that reads stacks.
 */
export function RejuvenationOrnament({ getStacks }: { getStacks: () => number }) {
  const root = useRef<THREE.Group>(null);
  const mark = useRef<THREE.Mesh>(null);
  const wake = useRef<ElementHandle | null>(null);
  const world = useRef(new THREE.Vector3());
  const prevStacks = useRef(0);

  const groundMat = useMemo(
    () => createLabGroundMarkMaterial("spiral", HEAL_COLORS, { opacity: 0.9, additive: false }),
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
      wake.current = spawnElementRole("heal", "ground", wx, wy + FEET_Y, wz, {
        dirY: 0.55,
        spread: 0.22,
        gravity: -0.12,
        drag: 1.2,
        size: 0.22,
        sizeEnd: 0.52,
        life: 0.85,
        rate: 12,
        opacity: 0.28,
      });
    }
    wake.current.setPose(wx, wy + FEET_Y, wz);
    wake.current.setRateScale(WAKE_RATE[stacks]!);

    if (stacks > prevStacks.current) {
      burstElementRole("heal", "ground", wx, wy + FEET_Y, wz, {
        duration: 0.05,
        burst: 4 + stacks * 3,
        rate: 0,
        dirY: 0.45,
        spread: 0.18 + stacks * 0.06,
        size: 0.2,
        sizeEnd: 0.46,
      });
    }
    prevStacks.current = stacks;

    const pulse = stacks >= 3 ? 0.92 + 0.08 * Math.sin(performance.now() * 0.006) : 1;
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
