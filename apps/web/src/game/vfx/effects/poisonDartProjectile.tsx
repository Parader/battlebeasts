import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { abilityVfxColor } from "../colors";
import { createEnergyBallMaterial, tintEnergyMaterial } from "../materials/energyBall";
import { createCirclePointMaterial } from "../materials/circlePoint";

const TRAIL = 10;
const SAMPLE_DIST = 0.22;
const MOTE_COUNT = 18;

const POISON = "#4d7c0f";
const POISON_HOT = "#84cc16";
const POISON_DARK = "#14532d";

type TrailPoint = { x: number; y: number; z: number };

type Mote = {
  alive: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
};

/**
 * Fast venom dart — dark core + toxic particle wake.
 */
export function PoisonDartProjectileEffect({ room, id }: { room: Room; id: string }) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const points = useRef<THREE.Points>(null);
  const trailMeshes = useRef<(THREE.Mesh | null)[]>([]);

  const colorHex = useRef(abilityVfxColor("poisonDart", POISON));
  const coreMat = useMemo(() => createEnergyBallMaterial(POISON_HOT, 1), []);
  const glowMat = useMemo(() => createEnergyBallMaterial(POISON_DARK, 0.55), []);
  const trailMats = useMemo(
    () => Array.from({ length: TRAIL }, () => createEnergyBallMaterial(POISON, 0.65)),
    [],
  );

  const renderPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const trail = useRef<TrailPoint[]>([]);
  const distAcc = useRef(0);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const motePool = useRef<Mote[]>(
    Array.from({ length: MOTE_COUNT }, () => ({
      alive: false,
      age: 0,
      life: 1,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 0.06,
    })),
  );
  const spawnAcc = useRef(0);

  const positions = useMemo(() => new Float32Array(MOTE_COUNT * 3), []);
  const sizes = useMemo(() => new Float32Array(MOTE_COUNT), []);
  const alphas = useMemo(() => new Float32Array(MOTE_COUNT), []);

  const particleGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return geo;
  }, [positions, sizes, alphas]);

  const particleMat = useMemo(() => createCirclePointMaterial(POISON_HOT), []);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | { x: number; z: number; vx?: number; vz?: number; abilityId?: string }
      | undefined;
    const g = group.current;
    if (!p || !g) {
      if (g) g.visible = false;
      if (points.current) points.current.visible = false;
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

    if (!seeded.current) {
      renderPos.current.set(p.x, 0.95, p.z);
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
          const blend = 1 - Math.exp(-14 * safeDt);
          renderPos.current.x = THREE.MathUtils.lerp(renderPos.current.x, p.x, blend);
          renderPos.current.z = THREE.MathUtils.lerp(renderPos.current.z, p.z, blend);
        }
      }

      const step = Math.hypot(renderPos.current.x - prevX, renderPos.current.z - prevZ);
      distAcc.current += step;
      while (distAcc.current >= SAMPLE_DIST) {
        distAcc.current -= SAMPLE_DIST;
        trail.current.unshift({
          x: renderPos.current.x,
          y: renderPos.current.y,
          z: renderPos.current.z,
        });
        if (trail.current.length > TRAIL) trail.current.length = TRAIL;
      }
    }

    g.position.copy(renderPos.current);

    const speed = Math.hypot(vx, vz);
    if (speed > 1e-3) {
      lookTarget.set(renderPos.current.x + vx, renderPos.current.y, renderPos.current.z + vz);
      g.lookAt(lookTarget);
    }

    const nextColor = abilityVfxColor(p.abilityId ?? "poisonDart", POISON);
    if (nextColor !== colorHex.current) {
      colorHex.current = nextColor;
      tintEnergyMaterial(coreMat, nextColor);
      tintEnergyMaterial(glowMat, POISON_DARK, 0.55);
      for (const m of trailMats) tintEnergyMaterial(m, nextColor);
    }

    if (core.current) core.current.scale.set(0.35, 0.35, 1.35);
    if (glow.current) glow.current.scale.set(0.75, 0.75, 1.8);

    for (let i = 0; i < TRAIL; i++) {
      const mesh = trailMeshes.current[i];
      const pt = trail.current[i];
      const mat = trailMats[i];
      if (!mesh || !mat) continue;
      if (!pt) {
        mesh.visible = false;
        continue;
      }
      const fade = 1 - i / Math.max(1, trail.current.length);
      mesh.visible = true;
      mesh.position.set(pt.x, pt.y, pt.z);
      mesh.scale.setScalar(0.2 + fade * 0.4);
      mat.opacity = 0.15 + fade * 0.5;
    }

    // Toxic motes peeling off the dart.
    spawnAcc.current += safeDt;
    while (spawnAcc.current >= 0.03) {
      spawnAcc.current -= 0.03;
      const mote = motePool.current.find((m) => !m.alive);
      if (!mote) break;
      mote.alive = true;
      mote.age = 0;
      mote.life = 0.28 + Math.random() * 0.28;
      mote.x = renderPos.current.x + (Math.random() - 0.5) * 0.08;
      mote.y = renderPos.current.y + (Math.random() - 0.5) * 0.08;
      mote.z = renderPos.current.z + (Math.random() - 0.5) * 0.08;
      const back = speed > 1e-3 ? 1 / speed : 0;
      mote.vx = -vx * back * (1.2 + Math.random()) + (Math.random() - 0.5) * 0.6;
      mote.vy = 0.2 + Math.random() * 0.7;
      mote.vz = -vz * back * (1.2 + Math.random()) + (Math.random() - 0.5) * 0.6;
      mote.size = 0.05 + Math.random() * 0.06;
    }

    let living = 0;
    for (let i = 0; i < MOTE_COUNT; i++) {
      const m = motePool.current[i]!;
      if (!m.alive) {
        positions[i * 3 + 1] = -999;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      m.age += safeDt;
      if (m.age >= m.life) {
        m.alive = false;
        positions[i * 3 + 1] = -999;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      const u = m.age / m.life;
      m.x += m.vx * safeDt;
      m.y += m.vy * safeDt;
      m.z += m.vz * safeDt;
      m.vy += 0.2 * safeDt;
      positions[i * 3] = m.x;
      positions[i * 3 + 1] = m.y;
      positions[i * 3 + 2] = m.z;
      const appear = THREE.MathUtils.smoothstep(u, 0, 0.15);
      const fade = (1 - u) * (1 - u);
      sizes[i] = m.size * appear * 28;
      alphas[i] = appear * fade * 0.9;
      living++;
    }
    particleGeo.attributes.position!.needsUpdate = true;
    particleGeo.attributes.aSize!.needsUpdate = true;
    particleGeo.attributes.aAlpha!.needsUpdate = true;
    if (points.current) points.current.visible = living > 0;
  });

  return (
    <>
      <group ref={group}>
        <mesh ref={core}>
          <sphereGeometry args={[0.14, 10, 10]} />
          <primitive object={coreMat} attach="material" />
        </mesh>
        <mesh ref={glow}>
          <sphereGeometry args={[0.14, 8, 8]} />
          <primitive object={glowMat} attach="material" />
        </mesh>
      </group>
      {trailMats.map((mat, i) => (
        <mesh
          key={i}
          ref={(el) => {
            trailMeshes.current[i] = el;
          }}
          visible={false}
        >
          <sphereGeometry args={[0.1, 6, 6]} />
          <primitive object={mat} attach="material" />
        </mesh>
      ))}
      <points
        ref={points}
        geometry={particleGeo}
        material={particleMat}
        frustumCulled={false}
      />
    </>
  );
}
