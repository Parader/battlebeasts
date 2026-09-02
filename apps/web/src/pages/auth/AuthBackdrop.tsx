import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import {
  ARENA_SCENE_SCALE,
  ARENA_SCENE_URL,
  CEMETERY_SCENE_SCALE,
  CEMETERY_SCENE_URL,
  HUB_SCENE_SCALE,
  HUB_SCENE_URL,
} from "@battlebeasts/shared";
import { assetUrl } from "@/game/assetUrl";
import {
  getHipsStartY,
  heroAnimationConfig,
  plantHipsRootMotion,
  stripHorizontalRootMotion,
} from "@/game/animation";
import {
  CHARACTER_URL,
  prepareCharacterScene,
  tintCharacterSurface,
} from "@/game/characterVisual";
import {
  FireParticleField,
  GroundMagicCircle,
  VfxWarmup,
  VfxWorld,
  spawnCastEffect,
  spawnImpactEffect,
  vfxRuntime,
} from "@/game/vfx";

useGLTF.preload(CHARACTER_URL);

const MAP_CYCLE_MS = 11_000;
const CAST_CYCLE_MS = 4_200;

/** Plant scaled map so terrain under origin sits on y=0 (same as arena scenes). */
function plantSceneAtOrigin(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const meshes: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o);
  });
  if (meshes.length === 0) return;
  const hits = new THREE.Raycaster(
    new THREE.Vector3(0, 200, 0),
    new THREE.Vector3(0, -1, 0),
  ).intersectObjects(meshes, false);
  const hit = hits[0];
  if (hit && Number.isFinite(hit.point.y)) {
    root.position.y -= hit.point.y;
  }
}

type MapDef = {
  id: string;
  url: string;
  scale: number;
  fog: string;
  ground: string;
};

const MAPS: MapDef[] = [
  {
    id: "village",
    url: assetUrl(HUB_SCENE_URL.replace(/^\//, "")),
    scale: HUB_SCENE_SCALE,
    fog: "#142033",
    ground: "#1a2a1c",
  },
  {
    id: "desert",
    url: assetUrl(ARENA_SCENE_URL.replace(/^\//, "")),
    scale: ARENA_SCENE_SCALE,
    fog: "#2a2218",
    ground: "#3a2e1c",
  },
  {
    id: "cemetery",
    url: assetUrl(CEMETERY_SCENE_URL.replace(/^\//, "")),
    scale: CEMETERY_SCENE_SCALE,
    fog: "#121820",
    ground: "#1a1e22",
  },
];

for (const map of MAPS) {
  useGLTF.preload(map.url);
}

const CAST_CLIPS = [
  heroAnimationConfig.castFireballCharge,
  heroAnimationConfig.castPrimary,
  heroAnimationConfig.castSpikes,
  heroAnimationConfig.castBarrier,
  heroAnimationConfig.castFrostMist,
  heroAnimationConfig.castFirewall,
].filter(Boolean) as string[];

/** Two mages opposite each other on X — yaw faces inward (+X / −X). */
const CASTERS = [
  { x: -2.35, z: 1.85, yaw: Math.PI / 2, clipOffset: 0 },
  { x: 2.35, z: 1.85, yaw: -Math.PI / 2, clipOffset: 2 },
] as const;

type SpellBeat = {
  cast?: {
    abilityId: string;
    lifeMs?: number;
    y?: number;
    chargeMs?: number;
    radius?: number;
  };
  impact?: {
    abilityId: string;
    lifeMs?: number;
    delayMs?: number;
    /** Distance ahead of caster along yaw. */
    forward?: number;
    radius?: number;
  };
};

/** One beat per CAST_CLIPS entry — real catalog spell FX, roomless world poses. */
const SPELL_BEATS: SpellBeat[] = [
  {
    cast: { abilityId: "fireball", lifeMs: 2400, y: 1.2 },
    impact: { abilityId: "fireball", lifeMs: 3600, delayMs: 1500, forward: 3.6, radius: 2.2 },
  },
  {
    cast: { abilityId: "bolt", lifeMs: 380, y: 1.15 },
    impact: { abilityId: "bolt", lifeMs: 480, delayMs: 260, forward: 3.8 },
  },
  {
    impact: { abilityId: "spikes", lifeMs: 1100, delayMs: 380, forward: 2.4, radius: 3.8 },
  },
  {
    cast: { abilityId: "barrier", lifeMs: 1600, chargeMs: 750 },
  },
  {
    impact: { abilityId: "frostMist", lifeMs: 3200, delayMs: 180, forward: 0.4, radius: 6 },
  },
  {
    impact: { abilityId: "firewall", lifeMs: 4800, delayMs: 480, forward: 2.6, radius: 4.5 },
  },
];

/** Sparse map-flavored bursts when the environment crossfades. */
const MAP_AMBIENT: Record<string, { abilityId: string; lifeMs: number; radius?: number }[]> = {
  village: [
    { abilityId: "holyGround", lifeMs: 5200, radius: 3.2 },
    { abilityId: "smash", lifeMs: 900 },
  ],
  desert: [
    { abilityId: "fireball", lifeMs: 4200, radius: 2.8 },
    { abilityId: "firewall", lifeMs: 5000, radius: 4.5 },
  ],
  cemetery: [
    { abilityId: "iceLance", lifeMs: 1100 },
    { abilityId: "poisonCloud", lifeMs: 4800, radius: 2.6 },
  ],
};

function findClip(animations: THREE.AnimationClip[], name: string) {
  return (
    animations.find((c) => c.name === name) ??
    animations.find((c) => c.name.toLowerCase() === name.toLowerCase()) ??
    null
  );
}

function ahead(x: number, z: number, yaw: number, forward: number) {
  return {
    x: x + Math.sin(yaw) * forward,
    z: z + Math.cos(yaw) * forward,
  };
}

function fireSpellBeat(
  beat: SpellBeat,
  caster: { x: number; z: number; yaw: number },
  timers: number[],
) {
  if (beat.cast) {
    const y = beat.cast.y ?? 0.85;
    const hand = ahead(caster.x, caster.z, caster.yaw, 0.55);
    spawnCastEffect(
      beat.cast.abilityId,
      { x: hand.x, z: hand.z, y, yaw: caster.yaw },
      {
        lifeMs: beat.cast.lifeMs,
        chargeMs: beat.cast.chargeMs,
        radius: beat.cast.radius,
      },
    );
  }
  if (beat.impact) {
    const delay = beat.impact.delayMs ?? 0;
    const forward = beat.impact.forward ?? 0;
    const land = ahead(caster.x, caster.z, caster.yaw, forward);
    const abilityId = beat.impact.abilityId;
    const lifeMs = beat.impact.lifeMs;
    const radius = beat.impact.radius;
    const yaw = caster.yaw;
    const run = () => {
      spawnImpactEffect(
        abilityId,
        { x: land.x, z: land.z, y: 0.02, yaw },
        { lifeMs, radius },
      );
    };
    if (delay <= 0) run();
    else timers.push(window.setTimeout(run, delay));
  }
}

function MapScene({ url, scale, opacity }: { url: string; scale: number; opacity: number }) {
  const gltf = useGLTF(url);
  const group = useRef<THREE.Group>(null);
  const opacityRef = useRef(opacity);
  const targetOpacity = useRef(opacity);

  const scene = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.material = mats.map((m) => {
          const next = m.clone();
          next.transparent = true;
          const std = next as THREE.MeshStandardMaterial;
          if (std.isMeshStandardMaterial) std.envMapIntensity = 0;
          return next;
        });
      }
    });
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    plantSceneAtOrigin(root);
    return root;
  }, [gltf.scene, scale]);

  useEffect(() => {
    targetOpacity.current = opacity;
  }, [opacity]);

  useFrame((_, dt) => {
    opacityRef.current = THREE.MathUtils.damp(opacityRef.current, targetOpacity.current, 5.5, dt);
    const o = opacityRef.current;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (Math.abs(m.opacity - o) < 0.002) continue;
        m.opacity = o;
        m.transparent = o < 0.99;
        m.depthWrite = o > 0.85;
      }
    });
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

function CastingHero({
  position,
  yaw,
  color,
  clipOffset,
}: {
  position: [number, number, number];
  yaw: number;
  color: string;
  clipOffset: number;
}) {
  const gltf = useGLTF(CHARACTER_URL);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clipIndex = useRef(clipOffset);

  const idleClip = useMemo(
    () => findClip(gltf.animations, heroAnimationConfig.idle) ?? gltf.animations[0] ?? null,
    [gltf.animations],
  );

  const plantHipsY = useMemo(() => {
    if (!idleClip) return 100;
    return getHipsStartY(idleClip) ?? 100;
  }, [idleClip]);

  const preparedCastClips = useMemo(() => {
    return CAST_CLIPS.map((name) => {
      const src = findClip(gltf.animations, name);
      if (!src) return null;
      return plantHipsRootMotion(stripHorizontalRootMotion(src), plantHipsY);
    });
  }, [gltf.animations, plantHipsY]);

  const scene = useMemo(() => {
    const prepared = prepareCharacterScene(gltf.scene, { restClip: idleClip, upAxis: "y" });
    tintCharacterSurface(prepared, color, "plain", "#1f2937");
    prepared.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
    });
    return prepared;
  }, [gltf.scene, idleClip, color]);

  useEffect(() => {
    const clips = preparedCastClips;
    const play = (clip: THREE.AnimationClip | null) => {
      const next = clip ?? idleClip;
      if (!next) return;
      const mixer = mixerRef.current ?? new THREE.AnimationMixer(scene);
      mixerRef.current = mixer;
      mixer.stopAllAction();
      const action = mixer.clipAction(next);
      action.reset();
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      action.play();
    };

    play(clips[clipIndex.current % Math.max(clips.length, 1)] ?? null);
    const id = window.setInterval(() => {
      clipIndex.current = (clipIndex.current + 1) % Math.max(clips.length, 1);
      play(clips[clipIndex.current] ?? null);
    }, CAST_CYCLE_MS);

    return () => {
      window.clearInterval(id);
      mixerRef.current?.stopAllAction();
      if (mixerRef.current) mixerRef.current.uncacheRoot(scene);
      mixerRef.current = null;
    };
  }, [scene, preparedCastClips, idleClip]);

  useFrame((_, dt) => {
    mixerRef.current?.update(dt);
  });

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <primitive object={scene} />
      <GroundMagicCircle color={color} radius={0.95} spin={0.85} showRune y={0.02} />
    </group>
  );
}

/**
 * Spawns catalog spell FX in sync with the casting heroes + map cycle.
 * Uses world-fixed poses (no Colyseus room / followOwner).
 */
function AuthSpellDirector({ mapId }: { mapId: string }) {
  const timers = useRef<number[]>([]);
  const beatStep = useRef(0);

  useEffect(() => {
    const clearTimers = () => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    };

    const fireAllCasters = () => {
      const step = beatStep.current;
      beatStep.current = step + 1;
      for (const caster of CASTERS) {
        const beatIdx = (caster.clipOffset + step) % SPELL_BEATS.length;
        const beat = SPELL_BEATS[beatIdx];
        if (beat) fireSpellBeat(beat, caster, timers.current);
      }
    };

    // Align with CastingHero clip swaps (same period from mount).
    fireAllCasters();
    const interval = window.setInterval(fireAllCasters, CAST_CYCLE_MS);

    return () => {
      window.clearInterval(interval);
      clearTimers();
    };
  }, []);

  // Map crossfade → thematic ambient impacts near the duel.
  useEffect(() => {
    const bursts = MAP_AMBIENT[mapId];
    if (!bursts?.length) return;
    const localTimers: number[] = [];
    bursts.forEach((b, i) => {
      localTimers.push(
        window.setTimeout(() => {
          const caster = CASTERS[i % CASTERS.length]!;
          const land = ahead(caster.x, caster.z, caster.yaw, 1.8 + i * 0.6);
          spawnImpactEffect(
            b.abilityId,
            { x: land.x, z: land.z, y: 0.02, yaw: caster.yaw },
            { lifeMs: b.lifeMs, radius: b.radius },
          );
        }, 320 + i * 420),
      );
    });
    return () => {
      for (const t of localTimers) window.clearTimeout(t);
    };
  }, [mapId]);

  useEffect(() => () => vfxRuntime.clear(), []);

  return (
    <>
      <VfxWorld room={null} localSessionId={null} />
      <VfxWarmup />
      {mapId === "desert" ? (
        <FireParticleField
          emitters={[
            { x: -1.2, y: 0.05, z: 2.4 },
            { x: 1.2, y: 0.05, z: 2.4 },
            { x: 0, y: 0.05, z: 3.2 },
          ]}
          rate={32}
          maxParticles={72}
          maxSize={0.16}
          maxLife={1.4}
          rise={1.8}
          colorStops={["#fff7ed", "#f97316", "#7c2d12"]}
        />
      ) : null}
      {mapId === "cemetery" ? (
        <FireParticleField
          emitters={[
            { x: -1.6, y: 0.04, z: 1.6 },
            { x: 1.6, y: 0.04, z: 1.6 },
          ]}
          rate={18}
          maxParticles={48}
          maxSize={0.11}
          maxLife={1.8}
          rise={1.05}
          colorStops={["#e0f2fe", "#7dd3fc", "#0c4a6e"]}
        />
      ) : null}
    </>
  );
}

function OrbitRig({ fog }: { fog: string }) {
  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime * 0.07;
    const radius = 13.5;
    const height = 5.8 + Math.sin(t * 0.6) * 0.4;
    camera.position.set(Math.sin(t) * radius, height, Math.cos(t) * radius + 2.2);
    camera.lookAt(0, 1.25, 1.85);
  });

  return (
    <>
      <color attach="background" args={[fog]} />
      <fog attach="fog" args={[fog, 12, 42]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#c8d8e8", "#2a2418", 0.55]} />
      <directionalLight position={[8, 16, 6]} intensity={1.15} color="#fff2d8" />
      <directionalLight position={[-6, 8, -8]} intensity={0.35} color="#8eb4d8" />
    </>
  );
}

function AuthWorld({ mapIndex, mapOpacity }: { mapIndex: number; mapOpacity: number }) {
  const map = MAPS[mapIndex] ?? MAPS[0]!;
  return (
    <>
      <OrbitRig fog={map.fog} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[48, 48]} />
        <meshStandardMaterial color={map.ground} roughness={1} metalness={0} />
      </mesh>
      <Suspense fallback={null}>
        <MapScene url={map.url} scale={map.scale} opacity={mapOpacity} />
        <CastingHero
          position={[CASTERS[0].x, 0, CASTERS[0].z]}
          yaw={CASTERS[0].yaw}
          color="#4a7ab8"
          clipOffset={CASTERS[0].clipOffset}
        />
        <CastingHero
          position={[CASTERS[1].x, 0, CASTERS[1].z]}
          yaw={CASTERS[1].yaw}
          color="#8b4a3a"
          clipOffset={CASTERS[1].clipOffset}
        />
        <AuthSpellDirector mapId={map.id} />
      </Suspense>
    </>
  );
}

/**
 * Full-bleed WebGL backdrop for marketing / auth screens:
 * cycling arena maps + mages casting with real spell VFX.
 */
export function AuthBackdrop() {
  const [mapIndex, setMapIndex] = useState(0);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    let fadeOut: number | undefined;
    let fadeIn: number | undefined;
    const tick = window.setInterval(() => {
      setOpacity(0);
      fadeOut = window.setTimeout(() => {
        setMapIndex((i) => (i + 1) % MAPS.length);
        fadeIn = window.setTimeout(() => setOpacity(1), 40);
      }, 520);
    }, MAP_CYCLE_MS);
    return () => {
      window.clearInterval(tick);
      if (fadeOut) window.clearTimeout(fadeOut);
      if (fadeIn) window.clearTimeout(fadeIn);
      vfxRuntime.clear();
    };
  }, []);

  return (
    <div className="bb-auth-backdrop" aria-hidden>
      <Canvas
        camera={{ position: [12, 7, 14], fov: 42, near: 0.2, far: 120 }}
        dpr={[1, 1.35]}
        gl={{ antialias: true, alpha: false, powerPreference: "low-power" }}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <AuthWorld mapIndex={mapIndex} mapOpacity={opacity} />
      </Canvas>
      <div className="bb-auth-backdrop__veil" />
      <div className="bb-auth-backdrop__grain" />
    </div>
  );
}
