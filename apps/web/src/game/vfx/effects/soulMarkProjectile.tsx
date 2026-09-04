import { useFrame, useThree } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { createCirclePointMaterial, createSmokePointMaterial, getVfxCircleTexture } from "../materials/circlePoint";
import { createEnergyBallMaterial } from "../materials/energyBall";
import { GEO_SPHERE_HI } from "../sharedGeo";
import { SOUL_MARK_COLORS } from "./soulMarkPalette";

const TRAIL_COUNT = 12;
const MOTE_LIFE_MIN = 0.2;
const MOTE_LIFE_MAX = 0.4;

type TrailMote = {
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
  dark: boolean;
};

function spawnMote(m: TrailMote, x: number, y: number, z: number, vx: number, vz: number): void {
  m.alive = true;
  m.age = 0;
  m.life = MOTE_LIFE_MIN + Math.random() * (MOTE_LIFE_MAX - MOTE_LIFE_MIN);
  m.x = x + (Math.random() - 0.5) * 0.06;
  m.y = y + (Math.random() - 0.5) * 0.05;
  m.z = z + (Math.random() - 0.5) * 0.06;
  m.vx = -vx * 0.15 + (Math.random() - 0.5) * 0.6;
  m.vy = (Math.random() - 0.5) * 0.25;
  m.vz = -vz * 0.15 + (Math.random() - 0.5) * 0.6;
  m.size = 0.04 + Math.random() * 0.05;
  m.dark = Math.random() < 0.35;
}

/**
 * Soul Mark projectile — dark psychic orb, violet shell, glow billboard, smoky trail.
 */
export function SoulMarkProjectileEffect({ room, id }: { room: Room; id: string }) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const shell = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const brightPts = useRef<THREE.Points>(null);
  const smokePts = useRef<THREE.Points>(null);
  const { camera } = useThree();

  const coreMat = useMemo(() => createEnergyBallMaterial(SOUL_MARK_COLORS.darkCore, 1), []);
  const shellMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: SOUL_MARK_COLORS.primary,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const glowMat = useMemo(() => {
    const tex = getVfxCircleTexture();
    return new THREE.MeshBasicMaterial({
      map: tex,
      alphaMap: tex,
      color: SOUL_MARK_COLORS.bright,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  }, []);

  const brightMat = useMemo(() => createCirclePointMaterial(SOUL_MARK_COLORS.bright), []);
  const smokeMat = useMemo(() => createSmokePointMaterial(SOUL_MARK_COLORS.smoke), []);

  const motePool = useRef<TrailMote[]>(
    Array.from({ length: TRAIL_COUNT }, () => ({
      alive: false,
      age: 0,
      life: 1,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 0.05,
      dark: false,
    })),
  );
  const spawnAcc = useRef(0);

  const brightPos = useMemo(() => new Float32Array(TRAIL_COUNT * 3), []);
  const brightSize = useMemo(() => new Float32Array(TRAIL_COUNT), []);
  const brightAlpha = useMemo(() => new Float32Array(TRAIL_COUNT), []);
  const smokePos = useMemo(() => new Float32Array(TRAIL_COUNT * 3), []);
  const smokeSize = useMemo(() => new Float32Array(TRAIL_COUNT), []);
  const smokeAlpha = useMemo(() => new Float32Array(TRAIL_COUNT), []);

  const brightGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(brightPos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(brightSize, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(brightAlpha, 1));
    return geo;
  }, [brightPos, brightSize, brightAlpha]);

  const smokeGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(smokePos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(smokeSize, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(smokeAlpha, 1));
    return geo;
  }, [smokePos, smokeSize, smokeAlpha]);

  const renderPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const shellSpin = useRef(0);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | { x: number; z: number; vx?: number; vz?: number }
      | undefined;
    const g = group.current;
    if (!p || !g) {
      if (g) g.visible = false;
      if (brightPts.current) brightPts.current.visible = false;
      if (smokePts.current) smokePts.current.visible = false;
      seeded.current = false;
      return;
    }
    g.visible = true;
    if (brightPts.current) brightPts.current.visible = true;
    if (smokePts.current) smokePts.current.visible = true;

    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;
    const safeDt = Math.min(0.05, Math.max(0, dt));
    const tSec = performance.now() * 0.001;

    if (!seeded.current) {
      renderPos.current.set(p.x, 1.05, p.z);
      lastServer.current = { x: p.x, z: p.z, vx, vz };
      seeded.current = true;
    } else {
      renderPos.current.x += vx * safeDt;
      renderPos.current.z += vz * safeDt;

      const errX = p.x - renderPos.current.x;
      const errZ = p.z - renderPos.current.z;
      const err = Math.hypot(errX, errZ);
      if (err > 2.5) {
        renderPos.current.x = p.x;
        renderPos.current.z = p.z;
      } else if (err > 0.02) {
        const pull = Math.min(1, safeDt * 8);
        renderPos.current.x += errX * pull;
        renderPos.current.z += errZ * pull;
      }
      lastServer.current = { x: p.x, z: p.z, vx, vz };
    }

    g.position.copy(renderPos.current);

    const pulse = 1 + Math.sin(tSec * 16) * 0.08;
    if (core.current) core.current.scale.setScalar(0.16 * pulse);
    if (shell.current) {
      shellSpin.current += safeDt * 2.2;
      shell.current.rotation.y = shellSpin.current;
      shell.current.rotation.z = Math.sin(tSec * 5) * 0.15;
      const shellPulse = 0.24 * (1 + Math.sin(tSec * 8) * 0.06);
      shell.current.scale.setScalar(shellPulse);
      shellMat.opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(tSec * 11));
    }
    if (glow.current) {
      glow.current.quaternion.copy(camera.quaternion);
      glow.current.scale.setScalar(0.45);
      glowMat.opacity = 0.42 + 0.12 * (0.5 + 0.5 * Math.sin(tSec * 13));
    }

    spawnAcc.current += safeDt;
    while (spawnAcc.current >= 0.028) {
      spawnAcc.current -= 0.028;
      const mote = motePool.current.find((m) => !m.alive);
      if (mote) spawnMote(mote, renderPos.current.x, renderPos.current.y, renderPos.current.z, vx, vz);
    }

    let bi = 0;
    let si = 0;
    for (const m of motePool.current) {
      if (!m.alive) continue;
      m.age += safeDt;
      if (m.age >= m.life) {
        m.alive = false;
        continue;
      }
      m.x += m.vx * safeDt;
      m.y += m.vy * safeDt;
      m.z += m.vz * safeDt;
      m.vy += safeDt * 0.4;

      const u = m.age / m.life;
      const fade = u < 0.2 ? u / 0.2 : 1 - (u - 0.2) / 0.8;
      const size = m.size * (1 + u * 0.35) * 36;

      if (m.dark && si < TRAIL_COUNT) {
        smokePos[si * 3] = m.x - renderPos.current.x;
        smokePos[si * 3 + 1] = m.y - renderPos.current.y;
        smokePos[si * 3 + 2] = m.z - renderPos.current.z;
        smokeSize[si] = size * 1.15;
        smokeAlpha[si] = fade * 0.55;
        si++;
      } else if (!m.dark && bi < TRAIL_COUNT) {
        brightPos[bi * 3] = m.x - renderPos.current.x;
        brightPos[bi * 3 + 1] = m.y - renderPos.current.y;
        brightPos[bi * 3 + 2] = m.z - renderPos.current.z;
        brightSize[bi] = size;
        brightAlpha[bi] = fade * 0.75;
        bi++;
      }
    }

    for (let i = bi; i < TRAIL_COUNT; i++) brightAlpha[i] = 0;
    for (let i = si; i < TRAIL_COUNT; i++) smokeAlpha[i] = 0;

    brightGeo.attributes.position!.needsUpdate = true;
    brightGeo.attributes.aSize!.needsUpdate = true;
    brightGeo.attributes.aAlpha!.needsUpdate = true;
    smokeGeo.attributes.position!.needsUpdate = true;
    smokeGeo.attributes.aSize!.needsUpdate = true;
    smokeGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={group} visible={false}>
      <mesh ref={core} geometry={GEO_SPHERE_HI} material={coreMat} renderOrder={5} />
      <mesh ref={shell} geometry={GEO_SPHERE_HI} material={shellMat} renderOrder={4} />
      <mesh ref={glow} material={glowMat} renderOrder={3}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <points ref={brightPts} geometry={brightGeo} material={brightMat} renderOrder={2} />
      <points ref={smokePts} geometry={smokeGeo} material={smokeMat} renderOrder={1} />
    </group>
  );
}
