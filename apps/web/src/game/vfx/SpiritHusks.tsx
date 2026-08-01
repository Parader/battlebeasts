import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import {
  MOVE_SPEED,
  SPIRIT_FORM_CAST,
  STARTER_COLORS,
  type CosmeticsEquipped,
} from "@battlebeasts/shared";
import { CHARACTER_URL, prepareCharacterScene, setCharacterOpacity, tintCharacterSurface } from "../characterVisual";
import { CharacterAnimationController, heroAnimationConfig } from "../animation";
import { cosmeticsKey, equippedFromPlayer } from "../cosmeticAttach";
import { EquippedCosmetics } from "../EquippedCosmetics";
import { createEnergyBallMaterial } from "./materials/energyBall";

type HuskNet = {
  x: number;
  z: number;
  yaw: number;
  ownerSessionId?: string;
  color?: string;
  pattern?: string;
  patternColor?: string;
  startedAt?: number;
  expiresAt?: number;
};

type PlayerPose = {
  x?: number;
  z?: number;
  cosmeticHat?: string;
  cosmeticShoulders?: string;
  cosmeticChest?: string;
  cosmeticGloves?: string;
  cosmeticBelt?: string;
  cosmeticLegs?: string;
  cosmeticShoes?: string;
};

const _zeroVel = new THREE.Vector3();
const _tetherY = new THREE.Vector3(0, 1, 0);
const _tetherDir = new THREE.Vector3();
const _tetherMid = new THREE.Vector3();
const _tetherQuat = new THREE.Quaternion();
const TETHER_HEIGHT = 1.05;
const COOLDOWN_RING_Y = 0.022;

/** Angular pie cooldown on the ground — track + filled sweep (0 empty → 1 full). */
function createCooldownRingMaterial(fillColor: string, trackColor: string) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uFill: { value: new THREE.Color(fillColor) },
      uTrack: { value: new THREE.Color(trackColor) },
      uInner: { value: 0.88 },
      uOuter: { value: 0.98 },
      uOpacity: { value: 0.92 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform vec3 uFill;
      uniform vec3 uTrack;
      uniform float uInner;
      uniform float uOuter;
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float soft = 0.018;
        float band = smoothstep(uInner - soft, uInner + soft, r)
          * (1.0 - smoothstep(uOuter - soft, uOuter + soft, r));
        if (band < 0.01) discard;

        // 0 at +Z (forward), sweeping clockwise like a UI cooldown.
        float ang = atan(p.x, -p.y);
        float a01 = ang / 6.28318530718 + 0.5;
        float edge = 0.014;
        float filled = 1.0 - smoothstep(uProgress, uProgress + edge, a01);
        vec3 col = mix(uTrack, uFill, filled);
        // Dim track on the empty arc; bright fill on the swept arc.
        float alpha = band * uOpacity * mix(0.42, 1.0, filled);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
    // Push into the ground slightly so transparent spirit mesh wins draw order fights.
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
}

function TimerRingFollow({
  getPos,
  startedAt,
  expiresAt,
}: {
  getPos: () => { x: number; z: number };
  startedAt: number;
  expiresAt: number;
}) {
  const root = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () => createCooldownRingMaterial("#c7d2fe", "#312e81"),
    [],
  );
  const radius = SPIRIT_FORM_CAST.timerRingRadius;

  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const p = getPos();
    g.position.x = p.x;
    g.position.y = COOLDOWN_RING_Y;
    g.position.z = p.z;
    const now = Date.now();
    const progress = Math.max(
      0,
      Math.min(1, (now - startedAt) / Math.max(1, expiresAt - startedAt)),
    );
    mat.uniforms.uProgress!.value = progress;
    if (mesh.current) mesh.current.visible = progress < 0.995;
  });

  return (
    <group ref={root}>
      <mesh
        ref={mesh}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[radius * 2, radius * 2, 1]}
        // Below transparent characters (spirit opacity) — higher order draws on top.
        renderOrder={-2}
      >
        <planeGeometry args={[1, 1]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}

function SpiritTetherFollow({
  getA,
  getB,
}: {
  getA: () => { x: number; z: number };
  getB: () => { x: number; z: number };
}) {
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const coreMat = useMemo(() => createEnergyBallMaterial("#c7d2fe", 0.75), []);
  const glowMat = useMemo(() => createEnergyBallMaterial("#818cf8", 0.32), []);

  useEffect(() => {
    return () => {
      coreMat.dispose();
      glowMat.dispose();
    };
  }, [coreMat, glowMat]);

  useFrame(() => {
    const a = getA();
    const b = getB();
    _tetherDir.set(b.x - a.x, 0, b.z - a.z);
    const len = _tetherDir.length();
    const show = len >= 0.05;
    if (core.current) core.current.visible = show;
    if (glow.current) glow.current.visible = show;
    if (!show) return;

    _tetherDir.multiplyScalar(1 / len);
    _tetherMid.set((a.x + b.x) * 0.5, TETHER_HEIGHT, (a.z + b.z) * 0.5);
    // Cylinder default axis is +Y — align that to husk→spirit on XZ.
    _tetherQuat.setFromUnitVectors(_tetherY, _tetherDir);

    const place = (m: THREE.Mesh | null, thick: number) => {
      if (!m) return;
      m.position.copy(_tetherMid);
      m.quaternion.copy(_tetherQuat);
      m.scale.set(thick, len, thick);
    };
    place(core.current, 0.055);
    place(glow.current, 0.13);
  });

  return (
    <group>
      <mesh ref={core} renderOrder={3}>
        <cylinderGeometry args={[1, 1, 1, 8]} />
        <primitive object={coreMat} attach="material" />
      </mesh>
      <mesh ref={glow} renderOrder={2}>
        <cylinderGeometry args={[1, 1, 1, 8]} />
        <primitive object={glowMat} attach="material" />
      </mesh>
    </group>
  );
}

function SpiritHuskAvatar({ room, huskId }: { room: Room; huskId: string }) {
  const group = useRef<THREE.Group>(null);
  const controllerRef = useRef<CharacterAnimationController | null>(null);
  const colorRef = useRef(STARTER_COLORS[0]!);
  const patternRef = useRef("plain");
  const patternColorRef = useRef("#1f2937");
  const cosmeticsKeyRef = useRef("");
  const [equipped, setEquipped] = useState<CosmeticsEquipped>({});
  const gltf = useGLTF(CHARACTER_URL);
  const scene = useMemo(() => {
    const idle =
      gltf.animations.find((c) => c.name === heroAnimationConfig.idle) ??
      gltf.animations[0] ??
      null;
    return prepareCharacterScene(gltf.scene, { restClip: idle, upAxis: "y" });
  }, [gltf.scene, gltf.animations]);

  useEffect(() => {
    const controller = new CharacterAnimationController(
      scene,
      gltf.animations,
      heroAnimationConfig,
    );
    controllerRef.current = controller;
    setCharacterOpacity(scene, 0.42);
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [scene, gltf.animations]);

  useFrame((_, dt) => {
    const h = room.state?.spiritHusks?.get(huskId) as HuskNet | undefined;
    const g = group.current;
    const controller = controllerRef.current;
    if (!h || !g || !controller) {
      if (g) g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(h.x, 0, h.z);
    g.rotation.y = h.yaw;

    const owner = h.ownerSessionId
      ? (room.state?.players?.get(h.ownerSessionId) as PlayerPose | undefined)
      : undefined;

    const color = h.color ?? STARTER_COLORS[0]!;
    const pattern = h.pattern ?? "plain";
    const patternColor = h.patternColor ?? "#1f2937";
    if (
      color !== colorRef.current ||
      pattern !== patternRef.current ||
      patternColor !== patternColorRef.current
    ) {
      colorRef.current = color;
      patternRef.current = pattern;
      patternColorRef.current = patternColor;
      tintCharacterSurface(scene, color, pattern, patternColor);
      setCharacterOpacity(scene, 0.42);
    }

    const nextCosmetics = cosmeticsKey(owner);
    if (nextCosmetics !== cosmeticsKeyRef.current) {
      cosmeticsKeyRef.current = nextCosmetics;
      setEquipped(equippedFromPlayer(owner));
    }

    controller.setMovement({
      worldVelocity: _zeroVel,
      facingYaw: h.yaw,
      maximumSpeed: MOVE_SPEED,
    });
    controller.update(Math.max(1e-4, Math.min(0.05, dt)));
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
      <EquippedCosmetics characterRoot={scene} equipped={equipped} />
    </group>
  );
}

function SpiritFormPair({
  room,
  huskId,
  localSessionId,
  predictedRef,
}: {
  room: Room;
  huskId: string;
  localSessionId: string | null;
  predictedRef?: { current: { x: number; z: number } };
}) {
  const spiritPos = useRef({ x: 0, z: 0 });
  const huskPos = useRef({ x: 0, z: 0 });
  const [clock, setClock] = useState(() => {
    const h = room.state?.spiritHusks?.get(huskId) as HuskNet | undefined;
    return {
      startedAt: h?.startedAt ?? 0,
      expiresAt: h?.expiresAt ?? 0,
    };
  });

  const syncEndpoints = (allowClockUpdate: boolean) => {
    const h = room.state?.spiritHusks?.get(huskId) as HuskNet | undefined;
    if (!h) return false;
    huskPos.current = { x: h.x, z: h.z };
    if (
      h.ownerSessionId &&
      localSessionId &&
      h.ownerSessionId === localSessionId &&
      predictedRef?.current
    ) {
      spiritPos.current = { x: predictedRef.current.x, z: predictedRef.current.z };
    } else if (h.ownerSessionId) {
      const p = room.state?.players?.get(h.ownerSessionId) as PlayerPose | undefined;
      if (p && typeof p.x === "number" && typeof p.z === "number") {
        spiritPos.current = { x: p.x, z: p.z };
      }
    }
    if (
      allowClockUpdate &&
      h.startedAt &&
      h.expiresAt &&
      (h.startedAt !== clock.startedAt || h.expiresAt !== clock.expiresAt)
    ) {
      setClock({ startedAt: h.startedAt, expiresAt: h.expiresAt });
    }
    return true;
  };

  useFrame(() => {
    syncEndpoints(true);
  });

  // Prime endpoints before the first tether frame (no setState in render).
  if (clock.startedAt && clock.expiresAt) {
    syncEndpoints(false);
  }

  if (!clock.startedAt || !clock.expiresAt) return null;

  return (
    <>
      <SpiritHuskAvatar room={room} huskId={huskId} />
      <SpiritTetherFollow getA={() => huskPos.current} getB={() => spiritPos.current} />
      <TimerRingFollow
        getPos={() => huskPos.current}
        startedAt={clock.startedAt}
        expiresAt={clock.expiresAt}
      />
      <TimerRingFollow
        getPos={() => spiritPos.current}
        startedAt={clock.startedAt}
        expiresAt={clock.expiresAt}
      />
    </>
  );
}

/** Schema-synced Spirit Form husks + tether + dual timer rings. */
export function SpiritHusks({
  room,
  localSessionId,
  predictedRef,
}: {
  room: Room | null;
  localSessionId: string | null;
  predictedRef?: { current: { x: number; z: number } };
}) {
  const [ids, setIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room?.state?.spiritHusks) return;
    const next: string[] = [];
    room.state.spiritHusks.forEach((_d: unknown, id: string) => next.push(id));
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
        <SpiritFormPair
          key={id}
          room={room}
          huskId={id}
          localSessionId={localSessionId}
          predictedRef={predictedRef}
        />
      ))}
    </>
  );
}
