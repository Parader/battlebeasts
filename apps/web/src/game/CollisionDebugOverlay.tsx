import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import {
  baseCityStaticColliders,
  localToWorldXZ,
  type MeshCollider,
  type StaticCollider,
} from "@battlebeasts/shared";

const Y = 0.08;

function isMesh(c: StaticCollider): c is MeshCollider {
  return c.shape === "mesh";
}

function buildLineGeometry(colliders: readonly StaticCollider[]): THREE.BufferGeometry {
  const positions: number[] = [];

  for (const c of colliders) {
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
  return geo;
}

function buildFillGeometry(colliders: readonly StaticCollider[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const fy = Y * 0.5;

  for (const c of colliders) {
    if (!isMesh(c)) continue;
    const s = c.scale;
    const cell = c.cell * s;
    for (let row = 0; row < c.rows; row++) {
      for (let col = 0; col < c.cols; col++) {
        const bit = row * c.cols + col;
        if ((c.mask[bit >> 3]! & (1 << (bit & 7))) === 0) continue;
        const lx0 = (c.ox + col * c.cell) * s;
        const lz0 = (c.oz + row * c.cell) * s;
        const lx1 = lx0 + cell;
        const lz1 = lz0 + cell;
        const q = [
          localToWorldXZ(c.x, c.z, c.yaw, lx0, lz0),
          localToWorldXZ(c.x, c.z, c.yaw, lx1, lz0),
          localToWorldXZ(c.x, c.z, c.yaw, lx1, lz1),
          localToWorldXZ(c.x, c.z, c.yaw, lx0, lz1),
        ];
        positions.push(
          q[0]!.x, fy, q[0]!.z,
          q[1]!.x, fy, q[1]!.z,
          q[2]!.x, fy, q[2]!.z,
          q[0]!.x, fy, q[0]!.z,
          q[2]!.x, fy, q[2]!.z,
          q[3]!.x, fy, q[3]!.z,
        );
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

/**
 * Draws hub collision footprints (mesh edges + solid fill + circles).
 * Toggle with F3, or `window.__bbToggleCollision()`.
 */
export function CollisionDebugOverlay() {
  const [visible, setVisible] = useState(false);
  const colliders = useMemo(() => baseCityStaticColliders(), []);

  useEffect(() => {
    const toggle = () => setVisible((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "F3") {
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
  }, []);

  const lineGeo = useMemo(() => buildLineGeometry(colliders), [colliders]);
  const fillGeo = useMemo(() => buildFillGeometry(colliders), [colliders]);

  useEffect(() => {
    return () => {
      lineGeo.dispose();
      fillGeo.dispose();
    };
  }, [lineGeo, fillGeo]);

  if (!visible) return null;

  return (
    <group>
      <mesh geometry={fillGeo} frustumCulled={false}>
        <meshBasicMaterial
          color="#f97316"
          transparent
          opacity={0.28}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments geometry={lineGeo} frustumCulled={false}>
        <lineBasicMaterial color="#fb923c" depthTest={false} />
      </lineSegments>
    </group>
  );
}
