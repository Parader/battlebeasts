import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  killLightningCluster,
  setLightningSegment,
  spawnLightningSegment,
  type LightningClusterOpts,
} from "../engine/lightningArcs";

/** Lab lightning palette — cyan core, no white tip / spheres. */
const BOLT_ARC: LightningClusterOpts = {
  strands: 2,
  spreadMul: 0.22,
  jitterMul: 0.45,
  sag: 0.04,
  tipGlow: 0,
  colorCore: "#67e8f9",
  colorInner: "#38bdf8",
  colorOuter: "#0ea5e9",
  colorHalo: "#0b3fc8",
};

/** World Y for the flying filament. */
const FLIGHT_Y = 1.05;
/** Filament length along travel (m). */
const BOLT_LEN = 0.72;

/**
 * Electric Bolt projectile — traveling lightning segment (no spheres / ovals).
 */
export function BoltProjectileEffect({ room, id }: { room: Room; id: string }) {
  const segmentId = useRef(-1);
  const renderPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const lastDir = useRef({ x: 0, z: 1 });

  useEffect(() => {
    return () => {
      if (segmentId.current >= 0) killLightningCluster(segmentId.current);
      segmentId.current = -1;
    };
  }, []);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | { x: number; z: number; vx?: number; vz?: number }
      | undefined;
    if (!p) {
      if (segmentId.current >= 0) {
        killLightningCluster(segmentId.current);
        segmentId.current = -1;
      }
      seeded.current = false;
      return;
    }

    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;
    const safeDt = Math.min(0.05, Math.max(0, dt));

    if (!seeded.current) {
      renderPos.current.set(p.x, FLIGHT_Y, p.z);
      lastServer.current = { x: p.x, z: p.z, vx, vz };
      seeded.current = true;
    } else {
      renderPos.current.x += vx * safeDt;
      renderPos.current.z += vz * safeDt;

      const serverMoved =
        p.x !== lastServer.current.x ||
        p.z !== lastServer.current.z ||
        vx !== lastServer.current.vx ||
        vz !== lastServer.current.vz;

      if (serverMoved) {
        lastServer.current = { x: p.x, z: p.z, vx, vz };
        const err = Math.hypot(renderPos.current.x - p.x, renderPos.current.z - p.z);
        if (err > 1.25) {
          renderPos.current.x = p.x;
          renderPos.current.z = p.z;
        } else {
          const blend = 1 - Math.exp(-14 * safeDt);
          renderPos.current.x = THREE.MathUtils.lerp(renderPos.current.x, p.x, blend);
          renderPos.current.z = THREE.MathUtils.lerp(renderPos.current.z, p.z, blend);
        }
      }
    }

    const speed = Math.hypot(vx, vz);
    let dx = lastDir.current.x;
    let dz = lastDir.current.z;
    if (speed > 1e-3) {
      dx = vx / speed;
      dz = vz / speed;
      lastDir.current.x = dx;
      lastDir.current.z = dz;
    }

    const tipX = renderPos.current.x;
    const tipZ = renderPos.current.z;
    const tailX = tipX - dx * BOLT_LEN;
    const tailZ = tipZ - dz * BOLT_LEN;
    const y = FLIGHT_Y;

    if (segmentId.current < 0 || !setLightningSegment(segmentId.current, tailX, y, tailZ, tipX, y, tipZ)) {
      segmentId.current = spawnLightningSegment(tailX, y, tailZ, tipX, y, tipZ, BOLT_ARC);
    }
  });

  return null;
}
