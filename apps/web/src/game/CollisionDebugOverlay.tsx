import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import {
  baseCityStaticColliders,
  localToWorldXZ,
  type MeshCollider,
  type StaticCollider,
  type WallCollider,
} from "@battlebeasts/shared";

/** Draw above meadow tiles so walls are obvious. */
const Y = 0.55;

function isMesh(c: StaticCollider): c is MeshCollider {
  return c.shape === "mesh";
}

function isWalls(c: StaticCollider): c is WallCollider {
  return c.shape === "walls";
}

function buildLineGeometry(colliders: readonly StaticCollider[]): THREE.BufferGeometry {
  const positions: number[] = [];

  for (const c of colliders) {
    if (isWalls(c)) {
      const segs = c.segs;
      for (let i = 0; i < segs.length; i += 4) {
        const ax = segs[i]!;
        const az = segs[i + 1]!;
        const bx = segs[i + 2]!;
        const bz = segs[i + 3]!;
        // Top edge
        positions.push(ax, Y, az, bx, Y, bz);
        // Vertical posts so walls read in a top-down camera
        positions.push(ax, 0.02, az, ax, Y, az);
      }
      continue;
    }

    if (isMesh(c)) {
      const s = c.scale;
      const segs = c.segs;
      for (let i = 0; i < segs.length; i += 4) {
        const a = localToWorldXZ(c.x, c.z, c.yaw, segs[i]! * s, segs[i + 1]! * s);
        const b = localToWorldXZ(c.x, c.z, c.yaw, segs[i + 2]! * s, segs[i + 3]! * s);
        positions.push(a.x, Y, a.z, b.x, Y, b.z);
      }
      continue;
    }

    if (c.shape === "box") {
      const corners = [
        [-c.halfX, -c.halfZ],
        [c.halfX, -c.halfZ],
        [c.halfX, c.halfZ],
        [-c.halfX, c.halfZ],
      ] as const;
      for (let i = 0; i < 4; i++) {
        const [lx0, lz0] = corners[i]!;
        const [lx1, lz1] = corners[(i + 1) % 4]!;
        const a = localToWorldXZ(c.x, c.z, c.yaw, lx0, lz0);
        const b = localToWorldXZ(c.x, c.z, c.yaw, lx1, lz1);
        positions.push(a.x, Y, a.z, b.x, Y, b.z);
      }
      continue;
    }

    const ring = 24;
    for (let i = 0; i < ring; i++) {
      const a0 = (i / ring) * Math.PI * 2;
      const a1 = ((i + 1) / ring) * Math.PI * 2;
      positions.push(
        c.x + Math.cos(a0) * c.radius,
        Y,
        c.z + Math.sin(a0) * c.radius,
        c.x + Math.cos(a1) * c.radius,
        Y,
        c.z + Math.sin(a1) * c.radius,
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Draws hub collision (Bezier walls + circles).
 * Toggle with F9 (F3 is often stolen by the browser), or `window.__bbToggleCollision()`.
 */
export function CollisionDebugOverlay() {
  const [visible, setVisible] = useState(false);
  const colliders = useMemo(() => baseCityStaticColliders(), []);
  const summary = useMemo(() => {
    let walls = 0;
    let wallSegs = 0;
    let circles = 0;
    let meshes = 0;
    for (const c of colliders) {
      if (isWalls(c)) {
        walls++;
        wallSegs += c.segs.length / 4;
      } else if (isMesh(c)) meshes++;
      else if (c.shape === "box") {
        /* skip */
      } else circles++;
    }
    return { total: colliders.length, walls, wallSegs, circles, meshes };
  }, [colliders]);

  useEffect(() => {
    const toggle = () =>
      setVisible((v) => {
        const next = !v;
        console.info("[collision debug]", next ? "ON" : "OFF", summary);
        return next;
      });
    const onKey = (e: KeyboardEvent) => {
      // F3 opens browser find; F9 is free. Keep F3 with preventDefault as backup.
      if (e.code === "F9" || e.code === "F3") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    (window as unknown as { __bbToggleCollision?: () => void }).__bbToggleCollision = toggle;
    return () => {
      window.removeEventListener("keydown", onKey);
      delete (window as unknown as { __bbToggleCollision?: () => void }).__bbToggleCollision;
    };
  }, [summary]);

  const lineGeo = useMemo(() => buildLineGeometry(colliders), [colliders]);

  useEffect(() => {
    return () => {
      lineGeo.dispose();
    };
  }, [lineGeo]);

  if (!visible) return null;

  return (
    <group>
      <lineSegments geometry={lineGeo} frustumCulled={false} renderOrder={10}>
        <lineBasicMaterial color="#ff2d6a" depthTest={false} toneMapped={false} />
      </lineSegments>
      <Html fullscreen style={{ pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            padding: "6px 10px",
            background: "rgba(0,0,0,0.65)",
            color: "#ff8fb3",
            font: "12px/1.35 ui-monospace, monospace",
            borderRadius: 6,
          }}
        >
          collision debug (F9)
          <br />
          walls {summary.walls} · segs {summary.wallSegs} · circles {summary.circles}
          {summary.meshes ? ` · meshes ${summary.meshes}` : ""}
        </div>
      </Html>
    </group>
  );
}
