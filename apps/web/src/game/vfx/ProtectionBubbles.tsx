import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { PROTECTION_BUBBLE_CAST } from "@battlebeasts/shared";
import { GroundDecal } from "./components/GroundDecal";
import { softEnvelope } from "./easing";
import { groundPresets } from "./presets/ground";

type BubbleSchema = {
  x: number;
  z: number;
  radius?: number;
  phase?: string;
  formEndsAt?: number;
  activeEndsAt?: number;
  expiresAt?: number;
};

const DOME_COLOR = "#7dd3fc";
const DOME_EDGE = "#e0f2fe";
/** Ground rim overshoots the dome footprint so soft edges still read at the shell. */
const GROUND_RIM_MUL = 1.18;

const rimPreset = {
  ...groundPresets.iceFrost,
  element: "ice" as const,
  shape: "ring" as const,
  colorCore: "#e0f2fe",
  colorMid: "#38bdf8",
  colorEdge: "#0ea5e9",
  opacity: 0.28,
  additive: true,
  ringWidth: 0.08,
  softness: 0.045,
  innerRatio: 0.84,
  spin: 0.12,
  appearEnd: 0.08,
  fadeStart: 0.92,
};

function BubbleMesh({ room, id }: { room: Room; id: string }) {
  const root = useRef<THREE.Group>(null);
  const domeGroup = useRef<THREE.Group>(null);
  const born = useRef(performance.now());
  const formProgress = useRef(0.12);
  const opacityMul = useRef(0.12);

  const domeMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: DOME_COLOR,
        transparent: true,
        opacity: 0.025,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const shellMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: DOME_EDGE,
        transparent: true,
        opacity: 0.04,
        depthWrite: false,
        side: THREE.FrontSide,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useFrame(() => {
    const v = room.state?.protectionBubbles?.get(id) as BubbleSchema | undefined;
    const g = root.current;
    if (!v || !g) {
      if (g) g.visible = false;
      return;
    }
    g.visible = true;
    g.position.x = v.x;
    g.position.z = v.z;
    const maxR = Math.max(1.5, v.radius ?? PROTECTION_BUBBLE_CAST.radius);

    const now = Date.now();
    const formEnds = v.formEndsAt ?? now;
    const activeEnds = v.activeEndsAt ?? formEnds;
    const expires = v.expiresAt ?? activeEnds;
    const phase = v.phase ?? "active";

    let form = 1;
    let fade = 1;
    if (phase === "forming" || now < formEnds) {
      const start = formEnds - PROTECTION_BUBBLE_CAST.formMs;
      const span = Math.max(1, PROTECTION_BUBBLE_CAST.formMs);
      const u = Math.max(0, Math.min(1, (now - start) / span));
      form = 1 - (1 - u) * (1 - u);
      fade = 0.35 + 0.65 * form;
    } else if (phase === "fading" || now >= activeEnds) {
      const span = Math.max(1, expires - activeEnds);
      const u = Math.max(0, Math.min(1, (now - activeEnds) / span));
      form = 1;
      fade = softEnvelope(u, 0.02, 0.35);
    }

    formProgress.current = Math.max(0.12, form);
    opacityMul.current = fade;

    const liveR = maxR * formProgress.current;
    if (domeGroup.current) {
      domeGroup.current.scale.setScalar(Math.max(0.05, liveR));
      domeGroup.current.visible = fade > 0.04;
    }
    domeMat.opacity = 0.015 + 0.02 * fade;
    shellMat.opacity = 0.025 + 0.025 * fade;
  });

  return (
    <group ref={root}>
      <GroundDecal
        preset={rimPreset}
        shape="ring"
        x={0}
        z={0}
        y={0.035}
        born={born.current}
        life={
          PROTECTION_BUBBLE_CAST.formMs +
          PROTECTION_BUBBLE_CAST.zoneDurationMs +
          PROTECTION_BUBBLE_CAST.fadeMs
        }
        radius={PROTECTION_BUBBLE_CAST.radius * GROUND_RIM_MUL}
        opacityMulRef={opacityMul}
        progressRef={formProgress}
        growExpand
      />
      <group ref={domeGroup}>
        <mesh renderOrder={3} frustumCulled={false}>
          <sphereGeometry args={[1, 40, 28]} />
          <primitive object={domeMat} attach="material" />
        </mesh>
        <mesh scale={[0.985, 0.985, 0.985]} renderOrder={4} frustumCulled={false}>
          <sphereGeometry args={[1, 28, 18]} />
          <primitive object={shellMat} attach="material" />
        </mesh>
      </group>
    </group>
  );
}

/** Schema-synced protection domes. */
export function ProtectionBubbles({ room }: { room: Room | null }) {
  const [ids, setIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room?.state?.protectionBubbles) return;
    const next: string[] = [];
    room.state.protectionBubbles.forEach((_d: unknown, id: string) => next.push(id));
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
        <BubbleMesh key={id} room={room} id={id} />
      ))}
    </>
  );
}
