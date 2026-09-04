import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { createCirclePointMaterial } from "./materials/circlePoint";
import { createEnergyBallMaterial } from "./materials/energyBall";
import { ASTRAL_CHAIN_COLORS } from "./effects/astralChainPalette";

const SEGMENTS = 10;
/** Caster leash sits at the hips/waist — not hand/head height. */
const CASTER_ATTACH_Y = 0.95;
/** Target attach stays mid-torso for readability. */
const TARGET_ATTACH_Y = 1.1;
const MOTE_N = 6;

type ChainNet = {
  casterId?: string;
  targetId?: string;
  maxDistance?: number;
  startedAt?: number;
  endsAt?: number;
};

type Pose = { x: number; z: number; y?: number };

function readUnitPose(room: Room, id: string, attachY: number): Pose | null {
  const p = room.state?.players?.get(id) as Pose | undefined;
  if (p && typeof p.x === "number") return { x: p.x, z: p.z, y: attachY };
  const t = room.state?.targets?.get(id) as Pose | undefined;
  if (t && typeof t.x === "number") return { x: t.x, z: t.z, y: attachY };
  return null;
}

function ChainMesh({ room, id }: { room: Room; id: string }) {
  const group = useRef<THREE.Group>(null);
  const casterRune = useRef<THREE.Mesh>(null);
  const targetRune = useRef<THREE.Mesh>(null);

  const positions = useMemo(() => new Float32Array((SEGMENTS + 1) * 3), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  const lineMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: ASTRAL_CHAIN_COLORS.main,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const lineObj = useMemo(() => new THREE.Line(geo, lineMat), [geo, lineMat]);
  const runeMat = useMemo(() => createEnergyBallMaterial(ASTRAL_CHAIN_COLORS.bright, 0.45), []);
  const targetRuneMat = useMemo(
    () => createEnergyBallMaterial(ASTRAL_CHAIN_COLORS.highlight, 0.4),
    [],
  );

  const motePos = useMemo(() => new Float32Array(MOTE_N * 3), []);
  const moteSize = useMemo(() => new Float32Array(MOTE_N), []);
  const moteAlpha = useMemo(() => new Float32Array(MOTE_N), []);
  const moteGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(moteSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(moteAlpha, 1));
    return g;
  }, [motePos, moteSize, moteAlpha]);
  const pointMat = useMemo(() => createCirclePointMaterial(ASTRAL_CHAIN_COLORS.bright), []);

  useFrame(() => {
    const chain = room.state?.astralChains?.get(id) as ChainNet | undefined;
    const g = group.current;
    if (!chain || !g) {
      if (g) g.visible = false;
      return;
    }
    const caster = chain.casterId ? readUnitPose(room, chain.casterId, CASTER_ATTACH_Y) : null;
    const target = chain.targetId ? readUnitPose(room, chain.targetId, TARGET_ATTACH_Y) : null;
    if (!caster || !target) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const now = Date.now();
    const left = (chain.endsAt ?? now + 1000) - now;
    const fadeOut = left < 180 ? Math.max(0, left / 180) : 1;
    const age = now - (chain.startedAt ?? now);
    const fadeIn = Math.min(1, age / 120);
    const opacity = fadeIn * fadeOut;

    const ax = caster.x;
    const ay = caster.y ?? CASTER_ATTACH_Y;
    const az = caster.z;
    const bx = target.x;
    const by = target.y ?? TARGET_ATTACH_Y;
    const bz = target.z;
    const dist = Math.hypot(bx - ax, bz - az);
    const maxD = Math.max(0.01, chain.maxDistance ?? dist);
    const tension = Math.min(1, dist / maxD);
    const taut = tension >= 0.9;

    const midX = (ax + bx) * 0.5;
    const midZ = (az + bz) * 0.5;
    // Sag less when taut.
    const sag = THREE.MathUtils.lerp(0.22, 0.04, tension);
    const wave = Math.sin(performance.now() * 0.006 + id.length) * (taut ? 0.02 : 0.06);
    const midY = (ay + by) * 0.5 - sag;

    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const omt = 1 - t;
      // Quadratic Bezier caster → sag mid → target
      const x = omt * omt * ax + 2 * omt * t * (midX + wave) + t * t * bx;
      const y = omt * omt * ay + 2 * omt * t * midY + t * t * by;
      const z = omt * omt * az + 2 * omt * t * (midZ - wave * 0.6) + t * t * bz;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
    geo.attributes.position!.needsUpdate = true;
    if (geo.boundingSphere) geo.computeBoundingSphere();

    lineMat.color.set(taut ? ASTRAL_CHAIN_COLORS.highlight : ASTRAL_CHAIN_COLORS.main);
    lineMat.opacity = (taut ? 0.95 : 0.75) * opacity;

    if (casterRune.current) {
      casterRune.current.position.set(ax, ay, az);
      casterRune.current.scale.setScalar(0.12 * opacity);
      casterRune.current.rotation.y += 0.02;
    }
    if (targetRune.current) {
      targetRune.current.position.set(bx, by, bz);
      targetRune.current.scale.setScalar((0.14 + (taut ? 0.04 : 0)) * opacity);
      targetRune.current.rotation.y -= 0.025;
    }

    const scroll = (performance.now() * 0.001 * (taut ? 2.2 : 1.1)) % 1;
    for (let i = 0; i < MOTE_N; i++) {
      const t = (scroll + i / MOTE_N) % 1;
      const idx = Math.min(SEGMENTS, Math.floor(t * SEGMENTS));
      const frac = t * SEGMENTS - idx;
      const i0 = idx;
      const i1 = Math.min(SEGMENTS, idx + 1);
      motePos[i * 3] = THREE.MathUtils.lerp(positions[i0 * 3]!, positions[i1 * 3]!, frac);
      motePos[i * 3 + 1] = THREE.MathUtils.lerp(
        positions[i0 * 3 + 1]!,
        positions[i1 * 3 + 1]!,
        frac,
      );
      motePos[i * 3 + 2] = THREE.MathUtils.lerp(
        positions[i0 * 3 + 2]!,
        positions[i1 * 3 + 2]!,
        frac,
      );
      moteSize[i] = (taut ? 0.035 : 0.025) * 36 * opacity;
      moteAlpha[i] = 0.55 * opacity;
    }
    moteGeo.attributes.position!.needsUpdate = true;
    moteGeo.attributes.aSize!.needsUpdate = true;
    moteGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <primitive object={lineObj} renderOrder={5} frustumCulled={false} />
      <mesh ref={casterRune} material={runeMat} renderOrder={6}>
        <torusGeometry args={[0.16, 0.025, 8, 16]} />
      </mesh>
      <mesh ref={targetRune} material={targetRuneMat} renderOrder={6}>
        <torusGeometry args={[0.2, 0.028, 8, 18]} />
      </mesh>
      <points geometry={moteGeo} material={pointMat} renderOrder={7} frustumCulled={false} />
    </group>
  );
}

/** Schema-synced astral tethers. */
export function AstralChains({ room }: { room: Room | null }) {
  const [ids, setIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room?.state?.astralChains) return;
    const next: string[] = [];
    room.state.astralChains.forEach((_d: unknown, id: string) => next.push(id));
    next.sort();
    const key = next.join("|");
    if (key !== prevKey.current) {
      prevKey.current = key;
      setIds(next);
    }
  });

  if (!room) return null;
  return (
    <>
      {ids.map((id) => (
        <ChainMesh key={id} room={room} id={id} />
      ))}
    </>
  );
}
