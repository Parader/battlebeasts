import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import type { Room } from "colyseus.js";
import * as THREE from "three";
import { circlesOverlap, COLLISION } from "@battlebeasts/shared";
import { usePickupIds } from "../useColyseusMapKeys";
import { createEnergyBallMaterial } from "./materials/energyBall";
import { createSmokePointMaterial } from "./materials/circlePoint";
import { getSmokeTexture } from "./smokeTexture";
import {
  markLocalPickupFumes,
  PickupCollectFumesLayer,
  pickupFumeColorForEffect,
  spawnPickupCollectFumes,
} from "./pickupCollectFumes";
import { registerSharedGeometry, registerSharedMaterial } from "./vfxDisposal";
import { PICKUP_SIGIL_URLS } from "./vfxUrls";

type PickupNet = {
  id: string;
  effect?: string;
  x: number;
  y?: number;
  z: number;
  radius?: number;
  available?: boolean;
};

type PickupTheme = {
  coreColor: string;
  glowColor: string;
  smokeColor: string;
};

const THEMES: Record<string, PickupTheme> = {
  heal: { coreColor: "#14532d", glowColor: "#4ade80", smokeColor: "#86efac" },
  energy: { coreColor: "#713f12", glowColor: "#facc15", smokeColor: "#fde68a" },
  absorb: { coreColor: "#1e3a8a", glowColor: "#3b82f6", smokeColor: "#93c5fd" },
  speed: { coreColor: "#155e75", glowColor: "#22d3ee", smokeColor: "#67e8f9" },
  power: { coreColor: "#7f1d1d", glowColor: "#ef4444", smokeColor: "#fca5a5" },
  haste: { coreColor: "#3b0764", glowColor: "#c084fc", smokeColor: "#e9d5ff" },
};

const DEFAULT_THEME: PickupTheme = {
  coreColor: "#0f172a",
  glowColor: "#7dd3fc",
  smokeColor: "#bae6fd",
};

const SMOKE_COUNT = 10;
const WISP_SPECS = Array.from({ length: SMOKE_COUNT }, (_, i) => ({
  ang: (i / SMOKE_COUNT) * Math.PI * 2,
  radius: 0.1 + (i % 3) * 0.045,
  baseY: -0.08 + (i % 4) * 0.05,
  rise: 0.42 + (i % 3) * 0.1,
  size: 0.07 + (i % 3) * 0.025,
  speed: 0.5 + (i % 4) * 0.11,
  phase: i * 0.71,
  spin: 0.65 + (i % 3) * 0.22,
}));

const GEO_CORE = new THREE.SphereGeometry(1, 12, 10);
const GEO_GLOW = new THREE.SphereGeometry(1, 10, 8);
const GEO_SHADOW = new THREE.CircleGeometry(0.32, 12);
const GEO_SIGIL = new THREE.PlaneGeometry(2.35, 2.35);
for (const geo of [GEO_CORE, GEO_GLOW, GEO_SHADOW, GEO_SIGIL]) {
  registerSharedGeometry(geo);
}

const SHADOW_MAT = new THREE.MeshBasicMaterial({
  color: "#000000",
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
});
SHADOW_MAT.userData.shared = true;
registerSharedMaterial(SHADOW_MAT);

type ThemeMats = {
  core: THREE.MeshBasicMaterial;
  glow: THREE.MeshBasicMaterial;
  smoke: THREE.ShaderMaterial;
  sigil: THREE.MeshBasicMaterial | null;
};

const themeMats = new Map<string, ThemeMats>();
const sigilTextures = new Map<string, THREE.Texture>();

function sigilTextureFor(effect: string): THREE.Texture | null {
  const url = PICKUP_SIGIL_URLS[effect];
  if (!url) return null;
  let tex = sigilTextures.get(effect);
  if (!tex) {
    tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    sigilTextures.set(effect, tex);
  }
  return tex;
}

function matsForEffect(effect: string): ThemeMats {
  let mats = themeMats.get(effect);
  if (!mats) {
    const theme = THEMES[effect] ?? DEFAULT_THEME;
    const core = new THREE.MeshBasicMaterial({
      color: theme.coreColor,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      toneMapped: false,
    });
    const glow = createEnergyBallMaterial(theme.glowColor, 0.28);
    const smoke = createSmokePointMaterial(theme.smokeColor);
    if (smoke.uniforms.uMap) smoke.uniforms.uMap.value = getSmokeTexture();
    const sigilTex = sigilTextureFor(effect);
    const sigil = sigilTex
      ? new THREE.MeshBasicMaterial({
          map: sigilTex,
          color: theme.glowColor,
          transparent: true,
          opacity: 0.62,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        })
      : null;
    core.userData.shared = true;
    glow.userData.shared = true;
    smoke.userData.shared = true;
    registerSharedMaterial(core);
    registerSharedMaterial(glow);
    registerSharedMaterial(smoke);
    if (sigil) {
      sigil.userData.shared = true;
      registerSharedMaterial(sigil);
    }
    mats = { core, glow, smoke, sigil };
    themeMats.set(effect, mats);
  }
  return mats;
}

function PickupOrbMesh({
  room,
  id,
  localSessionId,
  predictedRef,
}: {
  room: Room;
  id: string;
  localSessionId?: string | null;
  predictedRef?: MutableRefObject<{ x: number; z: number }>;
}) {
  const group = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const smokeRef = useRef<THREE.Points>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const sigilRef = useRef<THREE.Mesh>(null);
  const pickup = room.state?.pickups?.get(id) as PickupNet | undefined;
  const currentScale = useRef(pickup?.available !== false ? 1 : 0);
  const hoverTime = useRef(Math.random() * 10);
  const wasAvailable = useRef(pickup?.available !== false);
  const playedFumes = useRef(pickup?.available === false);
  const appliedEffect = useRef("");

  const effect = pickup?.effect && pickup.effect !== "random" ? pickup.effect : "energy";
  const mats = matsForEffect(effect);

  const applyTheme = (nextEffect: string) => {
    const themeId = THEMES[nextEffect] ? nextEffect : "energy";
    if (themeId === appliedEffect.current) return;
    appliedEffect.current = themeId;
    const nextMats = matsForEffect(themeId);
    if (coreRef.current) coreRef.current.material = nextMats.core;
    if (glowRef.current) glowRef.current.material = nextMats.glow;
    if (smokeRef.current) smokeRef.current.material = nextMats.smoke;
    if (sigilRef.current && nextMats.sigil) {
      sigilRef.current.material = nextMats.sigil;
      sigilRef.current.visible = true;
    } else if (sigilRef.current) {
      sigilRef.current.visible = false;
    }
  };

  const smokePos = useMemo(() => new Float32Array(SMOKE_COUNT * 3), []);
  const smokeSize = useMemo(() => new Float32Array(SMOKE_COUNT), []);
  const smokeAlpha = useMemo(() => new Float32Array(SMOKE_COUNT), []);
  const smokeGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(smokePos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(smokeSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(smokeAlpha, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    return g;
  }, [smokePos, smokeSize, smokeAlpha]);

  useFrame((_, dt) => {
    const p = room.state?.pickups?.get(id) as PickupNet | undefined;
    const g = group.current;
    if (!p || !g) {
      if (g) g.visible = false;
      return;
    }

    const available = p.available !== false;
    if (p.effect) applyTheme(p.effect);
    if (available && !wasAvailable.current) {
      playedFumes.current = false;
      currentScale.current = 0;
    }
    wasAvailable.current = available;

    const overlapping =
      !!available &&
      !!localSessionId &&
      !!predictedRef &&
      circlesOverlap(
        p.x,
        p.z,
        p.radius ?? 1.2,
        predictedRef.current.x,
        predictedRef.current.z,
        COLLISION.playerRadius,
      );

    if (overlapping && !playedFumes.current) {
      playedFumes.current = true;
      spawnPickupCollectFumes({
        color: pickupFumeColorForEffect(p.effect),
        x: predictedRef!.current.x,
        z: predictedRef!.current.z,
        targetId: localSessionId ?? undefined,
      });
      markLocalPickupFumes();
    }

    if (!available || overlapping) {
      currentScale.current = 0;
      g.visible = false;
      return;
    }

    currentScale.current = THREE.MathUtils.damp(currentScale.current, 1, 12, dt);
    if (currentScale.current < 0.01) {
      g.visible = false;
      return;
    }

    g.visible = true;
    hoverTime.current += dt;
    const t = hoverTime.current;
    const baseY = (p.y ?? 0) + 0.95;
    const bobY = baseY + Math.sin(t * 2.4) * 0.1;
    g.position.set(p.x, bobY, p.z);
    g.scale.setScalar(currentScale.current);

    if (coreRef.current) {
      const s = 0.22 + 0.02 * Math.sin(t * 4.2);
      coreRef.current.scale.setScalar(s);
    }
    if (glowRef.current) {
      glowRef.current.scale.setScalar(0.34 + 0.03 * Math.sin(t * 3.1));
    }
    if (shadowRef.current) {
      shadowRef.current.position.y = (p.y ?? 0) + 0.02 - bobY;
      shadowRef.current.scale.setScalar(Math.max(0.2, 1 - (bobY - baseY) * 0.8));
    }
    if (sigilRef.current) {
      sigilRef.current.position.y = 0.05 - bobY;
      const pulse = 0.94 + 0.07 * Math.sin(t * 1.65);
      sigilRef.current.scale.setScalar(pulse);
    }

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const spec = WISP_SPECS[i]!;
      const cycle = (t * spec.speed + spec.phase) % 1;
      const ang = spec.ang + t * spec.spin;
      const outward = 0.7 + cycle * 1.05;
      smokePos[i * 3] = Math.cos(ang) * spec.radius * outward;
      smokePos[i * 3 + 1] = spec.baseY + cycle * spec.rise;
      smokePos[i * 3 + 2] = Math.sin(ang) * spec.radius * outward;
      const fade =
        cycle < 0.12 ? cycle / 0.12 : cycle > 0.55 ? 1 - (cycle - 0.55) / 0.45 : 1;
      smokeSize[i] = spec.size * (0.85 + cycle * 1.35) * 34;
      smokeAlpha[i] = Math.max(0, fade) * (0.5 + (i % 3) * 0.08);
    }
    smokeGeo.attributes.position!.needsUpdate = true;
    smokeGeo.attributes.aSize!.needsUpdate = true;
    smokeGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <mesh ref={coreRef} geometry={GEO_CORE} material={mats.core} renderOrder={24} />
      <mesh ref={glowRef} geometry={GEO_GLOW} material={mats.glow} renderOrder={23} />
      <points ref={smokeRef} geometry={smokeGeo} material={mats.smoke} frustumCulled={false} renderOrder={25} />
      <mesh
        ref={shadowRef}
        geometry={GEO_SHADOW}
        material={SHADOW_MAT}
        rotation={[-Math.PI / 2, 0, 0]}
      />
      <mesh
        ref={sigilRef}
        geometry={GEO_SIGIL}
        material={mats.sigil ?? SHADOW_MAT}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={2}
        visible={Boolean(mats.sigil)}
      />
    </group>
  );
}

/** Schema-synced floating map pickup orbs. */
export function PickupOrbs({
  room,
  localSessionId,
  predictedRef,
}: {
  room: Room | null;
  localSessionId?: string | null;
  predictedRef?: MutableRefObject<{ x: number; z: number }>;
}) {
  const ids = usePickupIds(room);

  if (!room) return null;
  return (
    <>
      {ids.map((id) => (
        <PickupOrbMesh
          key={id}
          room={room}
          id={id}
          localSessionId={localSessionId}
          predictedRef={predictedRef}
        />
      ))}
      <PickupCollectFumesLayer
        room={room}
        localSessionId={localSessionId}
        predictedRef={predictedRef}
      />
    </>
  );
}
