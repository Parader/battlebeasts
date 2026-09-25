import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createLabGroundMarkMaterial,
  tickLabGroundMark,
} from "./vfx/engine/labShapeMaterials";
import { spawnElementRole, type ElementHandle } from "./vfx/engine";
import { GEO_PLANE_1 } from "./vfx/sharedGeo";

const TOX_COLORS = { hot: "#ecfccb", mid: "#84cc16", edge: "#3f6212" };
const MARK_Y = 0.032;
const MARK_SIZE = 1.15;
const FEET_Y = 0.07;
const MARK_OPACITY = [0, 0.5, 0.72, 0.92] as const;
const MARK_SCALE = [0, 0.82, 0.98, 1.16] as const;
const WAKE_RATE = [0, 0.7, 1.0, 1.28] as const;

/**
 * Persistent poison on a body — toxic spiral at the feet + rising mist.
 *
 * Body bubbles stay in StatusAuraFx. This is the ground well that reads the DoT.
 */
export function PoisonOrnament({ getStacks }: { getStacks: () => number }) {
  const root = useRef<THREE.Group>(null);
  const mark = useRef<THREE.Mesh>(null);
  const wake = useRef<ElementHandle | null>(null);
  const world = useRef(new THREE.Vector3());

  const groundMat = useMemo(
    () =>
      createLabGroundMarkMaterial("spiral", TOX_COLORS, {
        opacity: 0.88,
        additive: false,
      }),
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
      return;
    }

    g.visible = true;
    g.getWorldPosition(world.current);
    tickLabGroundMark(groundMat, safeDt);

    const wx = world.current.x;
    const wy = world.current.y;
    const wz = world.current.z;

    if (!wake.current) {
      wake.current = spawnElementRole("poison", "ground", wx, wy + FEET_Y, wz, {
        dirY: 0.48,
        spread: 0.24,
        gravity: -0.1,
        drag: 1.15,
        size: 0.24,
        sizeEnd: 0.58,
        life: 0.9,
        rate: 14,
        opacity: 0.26,
      });
    }
    wake.current.setPose(wx, wy + FEET_Y, wz);
    wake.current.setRateScale(WAKE_RATE[stacks]!);

    const pulse = stacks >= 3 ? 0.9 + 0.1 * Math.sin(performance.now() * 0.005) : 1;
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
