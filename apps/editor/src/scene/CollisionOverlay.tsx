import {
  blocksProjectiles,
  COLLISION,
  mapStaticColliders,
  type MapDoc,
} from "@battlebeasts/shared";
import { useMemo } from "react";
import { useEditor } from "../state/docStore";

/**
 * Draws every active collider flat on the ground.
 *
 * Two layers, because the question you actually need answered is not "where
 * are the colliders" but "can a player get through there":
 *
 *   solid   -- the collider itself
 *   outline -- the same shape grown by the player radius, which is the real
 *              boundary a player's centre can reach
 *
 * Where two outlines touch, the gap is impassable, however open it looks from
 * an orbit camera. That is the failure this overlay exists to catch.
 *
 * Solids are red when they also stop projectiles and green when they are low
 * cover that only stops bodies.
 */

const SOLID_FULL = "#ff6b6b";
/**
 * Colour for solids that stop bodies but not shots. Distinct from `SOLID`
 * because "can I walk here" and "can I shoot here" are different questions,
 * and a map full of low cover is unreadable if both answer in the same red.
 */
const SOLID_LOW = "#5fd0a8";
const REACH = "#ffb454";
const Y_SOLID = 0.035;
const Y_REACH = 0.03;

function Circle({ x, z, r, color, y, opacity }: { x: number; z: number; r: number; color: string; y: number; opacity: number }) {
  if (!(r > 0.001)) return null;
  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[r, 32]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

function Box({
  x, z, halfX, halfZ, yaw, color, y, opacity,
}: {
  x: number; z: number; halfX: number; halfZ: number; yaw: number; color: string; y: number; opacity: number;
}) {
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[halfX * 2, halfZ * 2]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function CollisionOverlay({ doc }: { doc: MapDoc }) {
  const { showColliders } = useEditor();

  const colliders = useMemo(
    () => (showColliders ? mapStaticColliders(doc) : []),
    [doc, showColliders],
  );

  if (!showColliders) return null;
  const r = COLLISION.playerRadius;

  return (
    <group>
      {colliders.map((c) => {
        const SOLID = blocksProjectiles(c) ? SOLID_FULL : SOLID_LOW;

        if (c.shape === "walls") {
          const out = [];
          for (let i = 0; i + 3 < c.segs.length; i += 4) {
            const ax = c.segs[i]!, az = c.segs[i + 1]!, bx = c.segs[i + 2]!, bz = c.segs[i + 3]!;
            const dx = bx - ax, dz = bz - az;
            const len = Math.hypot(dx, dz);
            if (len < 1e-4) continue;
            const mid = { x: ax + dx / 2, z: az + dz / 2 };
            // rotation.y = t maps +X to (cos t, 0, -sin t), hence the negation.
            const yaw = -Math.atan2(dz, dx);
            out.push(
              <group key={`${c.id}:${i}`}>
                <Box x={mid.x} z={mid.z} halfX={len / 2} halfZ={0.05} yaw={yaw} color={SOLID} y={Y_SOLID} opacity={0.85} />
                <Box x={mid.x} z={mid.z} halfX={len / 2} halfZ={r} yaw={yaw} color={REACH} y={Y_REACH} opacity={0.22} />
              </group>,
            );
          }
          return <group key={c.id}>{out}</group>;
        }

        if (c.shape === "box") {
          return (
            <group key={c.id}>
              <Box x={c.x} z={c.z} halfX={c.halfX} halfZ={c.halfZ} yaw={c.yaw} color={SOLID} y={Y_SOLID} opacity={0.6} />
              <Box x={c.x} z={c.z} halfX={c.halfX + r} halfZ={c.halfZ + r} yaw={c.yaw} color={REACH} y={Y_REACH} opacity={0.2} />
            </group>
          );
        }

        // Map documents only ever emit walls, boxes and circles; mesh
        // colliders come from the older baked maps and have no flat footprint
        // to draw.
        if (c.shape === "mesh") return null;

        return (
          <group key={c.id}>
            <Circle x={c.x} z={c.z} r={c.radius} color={SOLID} y={Y_SOLID} opacity={0.6} />
            <Circle x={c.x} z={c.z} r={c.radius + r} color={REACH} y={Y_REACH} opacity={0.2} />
          </group>
        );
      })}
    </group>
  );
}
