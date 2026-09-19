import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { EffectComposer as EffectComposerImpl } from "postprocessing";
import * as THREE from "three";
import { CAMERA, DEFAULT_GROUND_LAYERS } from "@battlebeasts/shared";
import { FixedFollowCamera } from "@web/game/FixedFollowCamera";
import { FollowSun } from "@web/game/FollowSun";
import { PerfProbe } from "@web/game/PerfHud";
import {
  CombatFxMeshes,
  Projectiles,
  Volcanoes,
  RockWalls,
  WorldTrees,
  ProtectionBubbles,
  OrbitingWisps,
  AstralChains,
  SoulSevers,
  RiftPortals,
  Shrooms,
} from "@web/game/CombatVfx";
import { SpellVfxBridge, VfxWorld } from "@web/game/vfx";
import { SpellLightPool } from "@web/game/vfx/spellLights";
import { warmSpellMaterials } from "@web/game/vfx/preloadVfx";
import { PaintedGround } from "@web/game/PaintedGround";
import { CASTER_ID, labSim } from "../sim/labSim";
import { labTick } from "../sim/labDirector";
import { setAim, setWorldStick, wasd } from "../sim/labInput";
import { labStore, useLabStore } from "../state/labStore";
import { LabActors } from "./LabActors";

const pitch = (CAMERA.pitchDeg * Math.PI) / 180;
const GAME_LOOK = new THREE.Vector3(0, 0, -1);
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

const LAB_GROUND = {
  kind: "painted" as const,
  sizeX: 48,
  sizeZ: 48,
  resX: 8,
  resZ: 8,
  layers: [...DEFAULT_GROUND_LAYERS],
  heightScale: 0,
};

function PostFX() {
  const composerRef = useRef<EffectComposerImpl>(null);
  const gl = useThree((s) => s.gl);

  useFrame(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const ctx = gl.getContext();
    const w = ctx.drawingBufferWidth;
    const h = ctx.drawingBufferHeight;
    const buf = (
      composer as EffectComposerImpl & {
        inputBuffer?: { width: number; height: number };
      }
    ).inputBuffer;
    if (!buf || buf.width !== w || buf.height !== h) {
      composer.setSize(w, h);
    }
  }, 0);

  return (
    <EffectComposer
      ref={composerRef}
      multisampling={0}
      enableNormalPass={false}
      frameBufferType={THREE.UnsignedByteType}
    >
      <Bloom
        luminanceThreshold={0.92}
        luminanceSmoothing={0.35}
        intensity={0.4}
        mipmapBlur
      />
    </EffectComposer>
  );
}

function SyncClearColor({ color }: { color: string }) {
  const gl = useThree((s) => s.gl);
  const parsed = useMemo(() => new THREE.Color(color), [color]);
  useLayoutEffect(() => {
    gl.setClearColor(parsed, 1);
  }, [gl, parsed]);
  return null;
}

function HorizonFill({ color }: { color: string }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.05, 0]}
      frustumCulled={false}
      renderOrder={-10}
    >
      <planeGeometry args={[2400, 2400]} />
      <meshBasicMaterial color={color} depthWrite={false} />
    </mesh>
  );
}

function LabGround() {
  const splat = useMemo(() => {
    const data = new Uint8Array([255, 0, 0, 255]);
    const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  }, []);
  return (
    <Suspense fallback={null}>
      <PaintedGround ground={LAB_GROUND} splat={splat} maxMeshSegs={8} />
    </Suspense>
  );
}

function LabClock({
  followTarget,
  predictedRef,
}: {
  followTarget: MutableRefObject<THREE.Vector3>;
  predictedRef: MutableRefObject<{ x: number; z: number; yaw: number }>;
}) {
  const { camera, pointer } = useThree();
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame((_, dt) => {
    ray.setFromCamera(pointer, camera);
    if (ray.ray.intersectPlane(groundPlane, hit)) setAim(hit.x, hit.z);

    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    right.crossVectors(fwd, up).normalize();
    const keys = wasd();
    let lx = 0;
    let lz = 0;
    if (keys.a) lx -= 1;
    if (keys.d) lx += 1;
    if (keys.w) lz += 1;
    if (keys.s) lz -= 1;
    setWorldStick(right.x * lx + fwd.x * lz, right.z * lx + fwd.z * lz);

    const caster = labSim.caster();
    followTarget.current.set(caster.x, 0, caster.z);
    predictedRef.current.x = caster.x;
    predictedRef.current.z = caster.z;
    predictedRef.current.yaw = caster.yaw;
    labTick(performance.now(), dt);

    const rangeEl = document.getElementById("lab-range");
    if (rangeEl) {
      const t = labSim.target();
      const dist = Math.hypot(t.x - caster.x, t.z - caster.z);
      rangeEl.textContent = `${dist.toFixed(1)} m`;
    }
  });
  return null;
}

function WarmSelectedKit() {
  const { gl, scene, camera } = useThree();
  const abilityId = useLabStore((s) => s.abilityId);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    const tick = () => {
      frames += 1;
      if (frames < 3) {
        raf = requestAnimationFrame(tick);
        return;
      }
      try {
        warmSpellMaterials(gl, scene, camera);
      } catch {
        /* First Play compiles anything the shared kit missed. */
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gl, scene, camera, abilityId]);
  return null;
}

function InspectSnap() {
  const nonce = useLabStore((s) => s.gameViewNonce);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null;

  useEffect(() => {
    if (!nonce || !controls) return;
    const dist = CAMERA.distance;
    const p = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
    controls.target.set(0, 0.8, -4);
    camera.position.set(
      controls.target.x,
      controls.target.y + Math.sin(p) * dist,
      controls.target.z + Math.cos(p) * dist,
    );
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      cam.fov = CAMERA.fov;
      cam.updateProjectionMatrix();
    }
    controls.update();
  }, [nonce, camera, controls]);

  return null;
}

function OrientationProbe() {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const el = document.getElementById("lab-compass-needle");
    if (!el) return;
    const m = camera.matrixWorld.elements;
    _right.set(m[0]!, m[1]!, m[2]!).normalize();
    _up.set(m[4]!, m[5]!, m[6]!).normalize();
    const sx = GAME_LOOK.dot(_right);
    const sy = GAME_LOOK.dot(_up);
    const angle = Math.atan2(sx, sy);
    const strength = Math.min(1, Math.hypot(sx, sy) * 1.4);
    el.style.transform = `rotate(${angle}rad)`;
    el.style.opacity = `${0.35 + strength * 0.65}`;
  });
  return null;
}

function LabScene() {
  const lighting = useLabStore((s) => s.lighting);
  const cameraMode = useLabStore((s) => s.camera);
  const followTarget = useRef(new THREE.Vector3());
  const predictedRef = useRef({ x: 0, z: 0, yaw: Math.PI });
  const cameraYaw = useRef(Math.PI);
  const isDungeon = lighting === "dungeon";
  const skyColor = isDungeon ? "#0a1018" : "#b59a6a";
  const room = labSim.room;

  return (
    <>
      <color attach="background" args={[skyColor]} />
      <fog attach="fog" args={[skyColor, isDungeon ? 28 : 42, isDungeon ? 62 : 90]} />
      <SyncClearColor color={skyColor} />
      <HorizonFill color={skyColor} />
      <ambientLight intensity={isDungeon ? 0.4 : 0.9} />
      <hemisphereLight args={["#fff1d6", "#8b6a3c", isDungeon ? 0 : 0.55]} />
      <FollowSun follow={followTarget} intensity={isDungeon ? 0.95 : 1.55} />
      <SpellLightPool />
      <LabGround />
      <Suspense fallback={null}>
        <LabActors />
      </Suspense>
      <Volcanoes room={room} />
      <RockWalls room={room} />
      <WorldTrees room={room} />
      <ProtectionBubbles room={room} />
      <OrbitingWisps room={room} localSessionId={CASTER_ID} predictedRef={predictedRef} />
      <AstralChains room={room} />
      <SoulSevers room={room} />
      <RiftPortals room={room} />
      <Shrooms room={room} localSessionId={CASTER_ID} pvpTeams={false} />
      <Projectiles room={room} />
      <CombatFxMeshes />
      <LabClock followTarget={followTarget} predictedRef={predictedRef} />
      <VfxWorld room={room} localSessionId={CASTER_ID} predictedRef={predictedRef} />
      <SpellVfxBridge room={room} />
      <WarmSelectedKit />
      <PerfProbe />
      {cameraMode === "follow" ? (
        <FixedFollowCamera
          target={followTarget}
          yawRef={cameraYaw}
          pitchDeg={CAMERA.pitchDeg}
          distance={CAMERA.distance}
          minDistance={CAMERA.minDistance}
          fov={CAMERA.fov}
          followLambda={CAMERA.followLambda}
          cursorLambda={CAMERA.cursorLambda}
          cursorInfluence={CAMERA.cursorInfluence}
        />
      ) : (
        <>
          <OrbitControls makeDefault target={[0, 0.8, -4]} enablePan enableRotate enableZoom />
          <InspectSnap />
          <OrientationProbe />
        </>
      )}
      <PostFX />
    </>
  );
}

export function Viewport() {
  return (
    <Canvas
      className="lab-canvas"
      shadows
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{
        fov: CAMERA.fov,
        near: 0.1,
        far: 280,
        position: [0, Math.sin(pitch) * CAMERA.distance, Math.cos(pitch) * CAMERA.distance],
      }}
    >
      <LabScene />
    </Canvas>
  );
}
