import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { abilityVfxColor } from "../colors";
import { createEnergyRingMaterial, tintEnergyMaterial } from "../materials/energyBall";
import { createCirclePointMaterial } from "../materials/circlePoint";

const SPIRAL_COUNT = 28;
const DISC_R = 0.48;
const DISC_Y = 0.95;

const VOID_CORE = "#120818";
const VOID_EDGE = "#8b2dce";
const VOID_BRIGHT = "#d68cff";
const VOID_DARK = "#2a0b38";

type SpiralMote = {
  alive: boolean;
  age: number;
  life: number;
  /** Angle on the horizontal disc plane at spawn. */
  ang: number;
  /** Radial distance from disc center (grows outward). */
  radius: number;
  spin: number;
  size: number;
};

type DiscPhase = "outbound" | "turning" | "returning" | "flight";

function readPhase(mode?: string): DiscPhase {
  if (mode === "outbound" || mode === "turning" || mode === "returning") return mode;
  return "flight";
}

/**
 * Void Disc — flat horizontal sawblade + spiraling rim motes (no world trail rings).
 */
export function VoidDiscProjectileEffect({ room, id }: { room: Room; id: string }) {
  const group = useRef<THREE.Group>(null);
  const discSpin = useRef<THREE.Group>(null);
  const disc = useRef<THREE.Mesh>(null);
  const rim = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const points = useRef<THREE.Points>(null);

  const colorHex = useRef(abilityVfxColor("voidDisc", VOID_EDGE));
  const discMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: VOID_CORE,
        emissive: VOID_DARK,
        emissiveIntensity: 1.1,
        metalness: 0.4,
        roughness: 0.35,
        transparent: true,
        opacity: 0.95,
        depthWrite: true,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const rimMat = useMemo(() => createEnergyRingMaterial(VOID_EDGE, 0.85), []);
  const coreMat = useMemo(() => createEnergyRingMaterial(VOID_BRIGHT, 0.45), []);

  const renderPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0, mode: "outbound" });
  const seeded = useRef(false);
  const spin = useRef(0);
  const emitAng = useRef(0);
  const turnPulse = useRef(0);
  const spawnAcc = useRef(0);

  const motePool = useRef<SpiralMote[]>(
    Array.from({ length: SPIRAL_COUNT }, () => ({
      alive: false,
      age: 0,
      life: 0.45,
      ang: 0,
      radius: DISC_R,
      spin: 10,
      size: 0.05,
    })),
  );

  const positions = useMemo(() => new Float32Array(SPIRAL_COUNT * 3), []);
  const sizes = useMemo(() => new Float32Array(SPIRAL_COUNT), []);
  const alphas = useMemo(() => new Float32Array(SPIRAL_COUNT), []);

  const particleGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return geo;
  }, [positions, sizes, alphas]);

  const particleMat = useMemo(() => createCirclePointMaterial(VOID_BRIGHT), []);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | { x: number; z: number; vx?: number; vz?: number; abilityId?: string; mode?: string }
      | undefined;
    const g = group.current;
    if (!p || !g) {
      if (g) g.visible = false;
      if (points.current) points.current.visible = false;
      seeded.current = false;
      for (const m of motePool.current) m.alive = false;
      return;
    }

    g.visible = true;
    if (points.current) points.current.visible = true;

    const phase = readPhase(p.mode);
    const returning = phase === "returning";
    const turning = phase === "turning";
    const safeDt = Math.min(0.05, Math.max(0, dt));
    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;

    if (p.abilityId) {
      colorHex.current = abilityVfxColor(p.abilityId, VOID_EDGE);
    }
    tintEnergyMaterial(rimMat, colorHex.current, returning ? 1 : turning ? 0.95 : 0.72);
    tintEnergyMaterial(coreMat, VOID_BRIGHT, returning ? 0.7 : 0.4);

    if (!seeded.current) {
      renderPos.current.set(p.x, DISC_Y, p.z);
      lastServer.current = { x: p.x, z: p.z, vx, vz, mode: p.mode ?? "outbound" };
      seeded.current = true;
    } else {
      // Predict locally, then soft-correct to server.
      renderPos.current.x += vx * safeDt;
      renderPos.current.z += vz * safeDt;
      const serverMoved =
        p.x !== lastServer.current.x ||
        p.z !== lastServer.current.z ||
        vx !== lastServer.current.vx ||
        vz !== lastServer.current.vz ||
        (p.mode ?? "outbound") !== lastServer.current.mode;
      if (serverMoved) {
        if (lastServer.current.mode === "outbound" && p.mode !== "outbound") {
          turnPulse.current = 1;
        }
        lastServer.current = { x: p.x, z: p.z, vx, vz, mode: p.mode ?? "outbound" };
        const err = Math.hypot(renderPos.current.x - p.x, renderPos.current.z - p.z);
        if (err > 0.02) {
          const blend = err > 1.5 ? 1 : 0.35;
          renderPos.current.x += (p.x - renderPos.current.x) * blend;
          renderPos.current.z += (p.z - renderPos.current.z) * blend;
        }
      }
    }

    g.position.copy(renderPos.current);
    // Stay flat on XZ — never lookAt travel direction (that flipped the rings).
    g.rotation.set(0, 0, 0);

    const spinRate = returning ? 18 : turning ? 6 : 14;
    spin.current += safeDt * spinRate;
    if (discSpin.current) {
      discSpin.current.rotation.y = spin.current;
    }

    turnPulse.current = Math.max(0, turnPulse.current - safeDt * 3.2);
    const pulse =
      (turning ? 0.88 + Math.sin(performance.now() * 0.025) * 0.06 : 1) *
      (1 + turnPulse.current * 0.18);
    if (discSpin.current) {
      discSpin.current.scale.setScalar(pulse);
    }

    // Spiral emit from rim, horizontal only.
    const emitRate = returning ? 0.018 : turning ? 0.04 : 0.026;
    spawnAcc.current += safeDt;
    while (spawnAcc.current >= emitRate) {
      spawnAcc.current -= emitRate;
      emitAng.current += returning ? 0.55 : 0.42;
      for (const m of motePool.current) {
        if (m.alive) continue;
        m.alive = true;
        m.age = 0;
        m.life = returning ? 0.55 : 0.42;
        m.ang = emitAng.current;
        m.radius = DISC_R * 0.92;
        m.spin = returning ? 14 : 10;
        m.size = returning ? 0.055 : 0.045;
        break;
      }
    }

    let mi = 0;
    for (const m of motePool.current) {
      if (!m.alive) continue;
      m.age += safeDt;
      if (m.age >= m.life) {
        m.alive = false;
        continue;
      }
      const u = m.age / m.life;
      m.ang += m.spin * safeDt;
      // Expand outward in a flat spiral, then fade.
      m.radius = DISC_R * 0.92 + u * (returning ? 0.85 : 0.55);
      const x = Math.cos(m.ang) * m.radius;
      const z = Math.sin(m.ang) * m.radius;
      positions[mi * 3] = x;
      positions[mi * 3 + 1] = (1 - u) * 0.02;
      positions[mi * 3 + 2] = z;
      sizes[mi] = m.size * 40 * (1 - u * 0.55);
      alphas[mi] = (1 - u) * (returning ? 0.9 : 0.7);
      mi += 1;
    }
    for (let i = mi; i < SPIRAL_COUNT; i++) {
      alphas[i] = 0;
      sizes[i] = 0;
    }
    particleGeo.attributes.position!.needsUpdate = true;
    particleGeo.attributes.aSize!.needsUpdate = true;
    particleGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <group ref={discSpin}>
        {/* Thin horizontal disc (cylinder default axis = Y). */}
        <mesh ref={disc} material={discMat} renderOrder={4}>
          <cylinderGeometry args={[DISC_R, DISC_R, 0.06, 40]} />
        </mesh>
        <mesh ref={rim} rotation={[-Math.PI / 2, 0, 0]} material={rimMat} renderOrder={5}>
          <ringGeometry args={[DISC_R * 0.88, DISC_R * 1.08, 48]} />
        </mesh>
        <mesh ref={core} rotation={[-Math.PI / 2, 0, 0]} material={coreMat} renderOrder={3}>
          <ringGeometry args={[DISC_R * 0.12, DISC_R * 0.38, 28]} />
        </mesh>
      </group>
      <points ref={points} geometry={particleGeo} material={particleMat} renderOrder={6} />
    </group>
  );
}
