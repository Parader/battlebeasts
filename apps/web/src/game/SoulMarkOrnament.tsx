import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { createCirclePointMaterial, createSmokePointMaterial } from "./vfx/materials/circlePoint";
import { createEnergyBallMaterial, createEnergyRingMaterial } from "./vfx/materials/energyBall";
import {
  easeOutBack,
  GEO_SOUL_CENTER,
  GEO_SOUL_INNER_RING,
  GEO_SOUL_OUTER_RING,
  GEO_SOUL_RUNE_ARM,
  SOUL_MARK_COLORS,
  SOUL_MARK_GROUND_Y,
  SOUL_RUNE_ANGLES,
  SOUL_RUNE_RADIUS,
  soulMarkStackConfig,
  type SoulMarkStackLevel,
} from "./vfx/effects/soulMarkPalette";

const RISE_COUNT = 14;
const WISP_COUNT = 3;
const HIT_FLASH_MS = 140;

type Props = {
  /** Polled each frame — max Soul Mark stacks on this unit (any caster). */
  getStacks: () => number;
};

type RiseMote = {
  alive: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  ang: number;
  dark: boolean;
};

/**
 * Persistent Soul Mark — procedural ground rune, orbiting wisps, rising soul motes.
 */
export function SoulMarkOrnament({ getStacks }: Props) {
  const root = useRef<THREE.Group>(null);
  const groundGroup = useRef<THREE.Group>(null);
  const outerRing = useRef<THREE.Mesh>(null);
  const innerRing = useRef<THREE.Mesh>(null);
  const centerGlow = useRef<THREE.Mesh>(null);
  const runeArms = useRef<(THREE.Mesh | null)[]>([null, null, null]);
  const hitRing = useRef<THREE.Mesh>(null);

  const outerRingMat = useMemo(() => createEnergyRingMaterial(SOUL_MARK_COLORS.primary, 0), []);
  const innerRingMat = useMemo(() => createEnergyRingMaterial(SOUL_MARK_COLORS.bright, 0), []);
  const centerMat = useMemo(() => createEnergyBallMaterial(SOUL_MARK_COLORS.deepViolet, 0), []);
  const runeArmMats = useMemo(
    () => [0, 1, 2].map(() => createEnergyBallMaterial(SOUL_MARK_COLORS.bright, 0)),
    [],
  );
  const hitRingMat = useMemo(() => createEnergyRingMaterial(SOUL_MARK_COLORS.hotFlash, 0), []);

  const wispBrightMat = useMemo(() => createCirclePointMaterial(SOUL_MARK_COLORS.bright), []);
  const wispSmokeMat = useMemo(() => createSmokePointMaterial(SOUL_MARK_COLORS.smoke), []);

  const wispPos = useMemo(() => new Float32Array(WISP_COUNT * 3), []);
  const wispSize = useMemo(() => new Float32Array(WISP_COUNT), []);
  const wispAlpha = useMemo(() => new Float32Array(WISP_COUNT), []);
  const wispGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(wispPos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(wispSize, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(wispAlpha, 1));
    return geo;
  }, [wispPos, wispSize, wispAlpha]);

  const risePool = useRef<RiseMote[]>(
    Array.from({ length: RISE_COUNT }, () => ({
      alive: false,
      age: 0,
      life: 0.6,
      x: 0,
      y: 0,
      z: 0,
      ang: 0,
      dark: false,
    })),
  );
  const riseBrightPos = useMemo(() => new Float32Array(RISE_COUNT * 3), []);
  const riseBrightSize = useMemo(() => new Float32Array(RISE_COUNT), []);
  const riseBrightAlpha = useMemo(() => new Float32Array(RISE_COUNT), []);
  const riseSmokePos = useMemo(() => new Float32Array(RISE_COUNT * 3), []);
  const riseSmokeSize = useMemo(() => new Float32Array(RISE_COUNT), []);
  const riseSmokeAlpha = useMemo(() => new Float32Array(RISE_COUNT), []);

  const riseBrightGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(riseBrightPos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(riseBrightSize, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(riseBrightAlpha, 1));
    return geo;
  }, [riseBrightPos, riseBrightSize, riseBrightAlpha]);

  const riseSmokeGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(riseSmokePos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(riseSmokeSize, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(riseSmokeAlpha, 1));
    return geo;
  }, [riseSmokePos, riseSmokeSize, riseSmokeAlpha]);

  const prevStacks = useRef(0);
  const armGrow = useRef([1, 1, 1]);
  const hitFlashBorn = useRef(0);
  const riseAcc = useRef(0);
  const outerRot = useRef(0);
  const innerRot = useRef(0);
  const fadeOut = useRef(1);

  useFrame((_, dt) => {
    const stacksRaw = Math.max(0, Math.min(3, Math.floor(getStacks())));
    const g = root.current;
    const ground = groundGroup.current;
    if (!g || !ground) return;

    if (stacksRaw <= 0) {
      g.visible = false;
      prevStacks.current = 0;
      fadeOut.current = 1;
      return;
    }

    fadeOut.current = 1;
    g.visible = true;
    ground.position.y = SOUL_MARK_GROUND_Y;

    const stacks = stacksRaw as SoulMarkStackLevel;
    const cfg = soulMarkStackConfig(stacks);
    const t = performance.now() * 0.001;

    if (stacks > prevStacks.current) {
      hitFlashBorn.current = performance.now();
      for (let i = prevStacks.current; i < stacks; i++) {
        armGrow.current[i] = 0;
      }
      // Upward burst on stack gain.
      for (let n = 0; n < 4 + stacks * 2; n++) {
        const m = risePool.current.find((r) => !r.alive);
        if (!m) break;
        m.alive = true;
        m.age = 0;
        m.life = 0.45 + Math.random() * 0.35;
        m.ang = Math.random() * Math.PI * 2;
        m.x = Math.cos(m.ang) * (0.05 + Math.random() * 0.12);
        m.y = 0.04;
        m.z = Math.sin(m.ang) * (0.05 + Math.random() * 0.12);
        m.dark = Math.random() < 0.3;
      }
    }
    prevStacks.current = stacks;

    for (let i = 0; i < 3; i++) {
      if (i < stacks && armGrow.current[i]! < 1) {
        armGrow.current[i] = Math.min(1, armGrow.current[i]! + dt * 5.5);
      }
    }

    const pulse =
      cfg.pulseScale > 0
        ? 1 + Math.sin(t * cfg.pulseSpeed) * cfg.pulseScale
        : 1 + Math.sin(t * cfg.pulseSpeed) * 0.02;
    ground.scale.setScalar(pulse);

    outerRot.current += dt * cfg.outerSpeed;
    innerRot.current += dt * cfg.innerSpeed;

    if (outerRing.current) {
      outerRing.current.rotation.z = outerRot.current;
      outerRingMat.opacity = cfg.outerOpacity * cfg.outerBright;
    }
    if (innerRing.current) {
      innerRing.current.visible = cfg.innerOpacity > 0.1;
      innerRing.current.rotation.z = innerRot.current;
      innerRingMat.opacity = cfg.innerOpacity;
    }
    if (centerGlow.current) {
      centerMat.opacity = cfg.centerGlow * (0.85 + 0.15 * Math.sin(t * cfg.pulseSpeed));
    }

    for (let i = 0; i < 3; i++) {
      const arm = runeArms.current[i];
      const mat = runeArmMats[i]!;
      const active = i < stacks;
      if (!arm) continue;
      arm.visible = active;
      if (!active) {
        mat.opacity = 0;
        continue;
      }
      const ang = SOUL_RUNE_ANGLES[i]!;
      arm.position.set(Math.cos(ang) * SOUL_RUNE_RADIUS, Math.sin(ang) * SOUL_RUNE_RADIUS, 0.002);
      arm.rotation.z = ang + Math.PI / 2;
      const grow = easeOutBack(armGrow.current[i]!);
      arm.scale.set(0.55 + grow * 0.45, 0.6 + grow * 0.4, 1);
      mat.opacity = cfg.outerBright * grow * (0.75 + 0.25 * Math.sin(t * 5 + i));
    }

    // Hit embed flash — thin ring + brief brighten.
    const hitAge = (performance.now() - hitFlashBorn.current) / HIT_FLASH_MS;
    if (hitRing.current && hitFlashBorn.current > 0 && hitAge < 1) {
      hitRing.current.visible = true;
      const hitT = 1 - hitAge;
      hitRing.current.scale.setScalar(0.7 + (1 - hitAge) * 0.35);
      hitRingMat.opacity = hitT * 0.65;
    } else if (hitRing.current) {
      hitRing.current.visible = false;
      hitRingMat.opacity = 0;
    }

    // Orbiting wisps — N active at stack count.
    const wispAngles = [0, Math.PI, (Math.PI * 2) / 3];
    for (let i = 0; i < WISP_COUNT; i++) {
      if (i >= cfg.wisps) {
        wispAlpha[i] = 0;
        continue;
      }
      const orbitAng = wispAngles[i]! + t * (0.9 + i * 0.15);
      const r = 0.58 + 0.08 * Math.sin(t * 2.1 + i);
      const h = 0.28 + 0.18 * Math.sin(t * 3.4 + i * 1.2);
      wispPos[i * 3] = Math.cos(orbitAng) * r;
      wispPos[i * 3 + 1] = h;
      wispPos[i * 3 + 2] = Math.sin(orbitAng) * r;
      wispSize[i] = (0.045 + i * 0.008) * 36;
      wispAlpha[i] = 0.35 + stacks * 0.12;
    }
    wispGeo.attributes.position!.needsUpdate = true;
    wispGeo.attributes.aSize!.needsUpdate = true;
    wispGeo.attributes.aAlpha!.needsUpdate = true;

    // Rising soul particles from ground mark.
    riseAcc.current += dt * cfg.riseRate;
    while (riseAcc.current >= 0.22) {
      riseAcc.current -= 0.22;
      const m = risePool.current.find((r) => !r.alive);
      if (!m) break;
      m.alive = true;
      m.age = 0;
      m.life = 0.4 + Math.random() * 0.5;
      m.ang = Math.random() * Math.PI * 2;
      m.x = Math.cos(m.ang) * (0.08 + Math.random() * 0.22);
      m.y = 0.05;
      m.z = Math.sin(m.ang) * (0.08 + Math.random() * 0.22);
      m.dark = Math.random() < 0.28;
    }

    let bi = 0;
    let si = 0;
    for (const m of risePool.current) {
      if (!m.alive) continue;
      m.age += dt;
      if (m.age >= m.life) {
        m.alive = false;
        continue;
      }
      const u = m.age / m.life;
      const spiral = m.ang + u * 2.4;
      m.y = 0.05 + u * (0.55 + stacks * 0.12);
      m.x = Math.cos(spiral) * (0.1 + u * 0.08);
      m.z = Math.sin(spiral) * (0.1 + u * 0.08);
      const fade = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
      const size = (0.035 + u * 0.04) * 36;

      if (m.dark && si < RISE_COUNT) {
        riseSmokePos[si * 3] = m.x;
        riseSmokePos[si * 3 + 1] = m.y;
        riseSmokePos[si * 3 + 2] = m.z;
        riseSmokeSize[si] = size * 1.2;
        riseSmokeAlpha[si] = fade * 0.5;
        si++;
      } else if (!m.dark && bi < RISE_COUNT) {
        riseBrightPos[bi * 3] = m.x;
        riseBrightPos[bi * 3 + 1] = m.y;
        riseBrightPos[bi * 3 + 2] = m.z;
        riseBrightSize[bi] = size;
        riseBrightAlpha[bi] = fade * (0.45 + stacks * 0.12);
        bi++;
      }
    }
    for (let i = bi; i < RISE_COUNT; i++) riseBrightAlpha[i] = 0;
    for (let i = si; i < RISE_COUNT; i++) riseSmokeAlpha[i] = 0;
    riseBrightGeo.attributes.position!.needsUpdate = true;
    riseBrightGeo.attributes.aSize!.needsUpdate = true;
    riseBrightGeo.attributes.aAlpha!.needsUpdate = true;
    riseSmokeGeo.attributes.position!.needsUpdate = true;
    riseSmokeGeo.attributes.aSize!.needsUpdate = true;
    riseSmokeGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={root} visible={false}>
      <group ref={groundGroup} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh ref={outerRing} geometry={GEO_SOUL_OUTER_RING} material={outerRingMat} renderOrder={2} />
        <mesh ref={innerRing} geometry={GEO_SOUL_INNER_RING} material={innerRingMat} renderOrder={3} />
        <mesh ref={centerGlow} geometry={GEO_SOUL_CENTER} material={centerMat} renderOrder={4} />
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            ref={(el) => {
              runeArms.current[i] = el;
            }}
            geometry={GEO_SOUL_RUNE_ARM}
            material={runeArmMats[i]}
            renderOrder={5}
            visible={false}
          />
        ))}
        <mesh
          ref={hitRing}
          geometry={GEO_SOUL_INNER_RING}
          material={hitRingMat}
          renderOrder={6}
          visible={false}
        />
      </group>

      <points geometry={wispGeo} material={wispBrightMat} renderOrder={7} />
      <points geometry={riseBrightGeo} material={wispBrightMat} renderOrder={8} />
      <points geometry={riseSmokeGeo} material={wispSmokeMat} renderOrder={1} />
    </group>
  );
}
