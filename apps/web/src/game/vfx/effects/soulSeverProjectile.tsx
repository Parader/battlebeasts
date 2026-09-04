import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const RED_CORE = new THREE.Color("#B91C1C");
const RED_HOT = new THREE.Color("#EF4444");
const RED_TRAIL = new THREE.Color("#F97316");

const TRAIL_COUNT = 8;
const SAMPLE_DISTANCE = 0.16;

type TrailPoint = { x: number; y: number; z: number; yaw: number };

/**
 * Open arced triangle in the local YZ plane: tip at +Z (travel), open rear.
 * `lookAt` alone aims tip along flight — do not tip with rotateX.
 */
function buildArcedChevronGeo(scale = 1): THREE.BufferGeometry {
  const tip = new THREE.Vector3(0, 0, 0.48 * scale);
  const topWing = new THREE.Vector3(0, 0.3 * scale, -0.26 * scale);
  const botWing = new THREE.Vector3(0, -0.3 * scale, -0.26 * scale);
  const topArc = new THREE.Vector3(0, 0.36 * scale, 0.1 * scale);
  const botArc = new THREE.Vector3(0, -0.36 * scale, 0.1 * scale);

  const segs = 7;
  const bezier = (a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number) => {
    const u = 1 - t;
    return new THREE.Vector3(
      0,
      u * u * a.y + 2 * u * t * c.y + t * t * b.y,
      u * u * a.z + 2 * u * t * c.z + t * t * b.z,
    );
  };

  const top: THREE.Vector3[] = [];
  const bot: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    top.push(bezier(tip, topArc, topWing, t));
    bot.push(bezier(tip, botArc, botWing, t));
  }

  const half = 0.02 * scale;
  const positions: number[] = [];
  const indices: number[] = [];

  const addArm = (pts: THREE.Vector3[]) => {
    const base = positions.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      positions.push(half, p.y, p.z);
      positions.push(-half, p.y, p.z);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };

  addArm(top);
  addArm(bot);

  // Soft fill near the tip only (rear stays open).
  const tipFillStart = positions.length / 3;
  const mid = Math.floor(segs * 0.55);
  positions.push(tip.x, tip.y, tip.z);
  positions.push(0, top[mid]!.y, top[mid]!.z);
  positions.push(0, bot[mid]!.y, bot[mid]!.z);
  indices.push(tipFillStart, tipFillStart + 1, tipFillStart + 2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function aimAlongYaw(obj: THREE.Object3D, x: number, y: number, z: number, yaw: number, lookTarget: THREE.Vector3) {
  obj.position.set(x, y, z);
  lookTarget.set(x + Math.sin(yaw), y, z + Math.cos(yaw));
  obj.lookAt(lookTarget);
  // Geometry is vertical in YZ; quarter-turn around travel axis lays it flat.
  obj.rotateZ(Math.PI / 2);
}

export function SoulSeverProjectileEffect({ room, id }: { room: Room; id: string }) {
  const headGroup = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const trailMeshes = useRef<(THREE.Mesh | null)[]>([]);

  const headGeo = useMemo(() => buildArcedChevronGeo(1), []);
  const trailGeo = useMemo(() => buildArcedChevronGeo(0.7), []);

  const mats = useMemo(() => {
    const mk = (color: THREE.Color, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
    return {
      body: mk(RED_HOT, 0.92),
      glow: mk(RED_CORE, 0.45),
      trails: Array.from({ length: TRAIL_COUNT }, () => mk(RED_TRAIL, 0.35)),
    };
  }, []);

  const renderPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const trail = useRef<TrailPoint[]>([]);
  const distAcc = useRef(0);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | { x: number; z: number; vx?: number; vz?: number }
      | undefined;
    const g = headGroup.current;
    if (!p || !g) {
      if (g) g.visible = false;
      for (const mesh of trailMeshes.current) {
        if (mesh) mesh.visible = false;
      }
      seeded.current = false;
      trail.current = [];
      distAcc.current = 0;
      return;
    }
    g.visible = true;
    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;
    const safeDt = Math.min(0.05, Math.max(0, dt));
    const prevX = renderPos.current.x;
    const prevZ = renderPos.current.z;
    const yaw = Math.atan2(vx, vz);

    if (!seeded.current) {
      renderPos.current.set(p.x, 1.15, p.z);
      lastServer.current = { x: p.x, z: p.z, vx, vz };
      seeded.current = true;
      trail.current = [];
      distAcc.current = 0;
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
          const blend = 1 - Math.exp(-15 * safeDt);
          renderPos.current.x = THREE.MathUtils.lerp(renderPos.current.x, p.x, blend);
          renderPos.current.z = THREE.MathUtils.lerp(renderPos.current.z, p.z, blend);
        }
      }
      const step = Math.hypot(renderPos.current.x - prevX, renderPos.current.z - prevZ);
      distAcc.current += step;
      while (distAcc.current >= SAMPLE_DISTANCE) {
        distAcc.current -= SAMPLE_DISTANCE;
        trail.current.unshift({
          x: renderPos.current.x,
          y: renderPos.current.y,
          z: renderPos.current.z,
          yaw,
        });
        if (trail.current.length > TRAIL_COUNT) trail.current.length = TRAIL_COUNT;
      }
    }

    const spd = Math.hypot(vx, vz);
    if (spd > 0.05) {
      aimAlongYaw(
        g,
        renderPos.current.x,
        renderPos.current.y,
        renderPos.current.z,
        yaw,
        lookTarget,
      );
    } else {
      g.position.copy(renderPos.current);
    }

    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.02);
    if (body.current) mats.body.opacity = 0.82 + pulse * 0.12;
    if (glow.current) {
      glow.current.scale.setScalar(1.12 + pulse * 0.04);
      mats.glow.opacity = 0.35 + pulse * 0.12;
    }

    for (let i = 0; i < TRAIL_COUNT; i++) {
      const mesh = trailMeshes.current[i];
      const pt = trail.current[i];
      if (!mesh) continue;
      if (!pt) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      aimAlongYaw(mesh, pt.x, pt.y, pt.z, pt.yaw, lookTarget);
      const fade = 1 - i / TRAIL_COUNT;
      const stretch = 1 + (1 - fade) * 0.55;
      mesh.scale.set(1, 0.7 + fade * 0.35, stretch);
      mats.trails[i]!.color.copy(RED_HOT).lerp(RED_TRAIL, 1 - fade);
      mats.trails[i]!.opacity = 0.42 * fade * fade;
    }
  });

  return (
    <>
      <group ref={headGroup} visible={false}>
        <mesh ref={glow} geometry={headGeo} renderOrder={29}>
          <primitive object={mats.glow} attach="material" />
        </mesh>
        <mesh ref={body} geometry={headGeo} renderOrder={30}>
          <primitive object={mats.body} attach="material" />
        </mesh>
      </group>
      {mats.trails.map((mat, i) => (
        <mesh
          key={`trail-${i}`}
          ref={(el) => {
            trailMeshes.current[i] = el;
          }}
          geometry={trailGeo}
          renderOrder={28}
          visible={false}
        >
          <primitive object={mat} attach="material" />
        </mesh>
      ))}
    </>
  );
}
