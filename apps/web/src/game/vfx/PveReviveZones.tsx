import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { PVE_ALLY_REVIVE_RADIUS } from "@battlebeasts/shared";
import { AoeRimMarker } from "./components/AoeRimMarker";
import { GroundDecal } from "./components/GroundDecal";
import { createRuneMaterial, tickRuneMaterial } from "./materials/rune";
import { groundPresets } from "./presets/ground";

type ReviveSchema = {
  x: number;
  z: number;
  radius?: number;
  charge?: number;
  occupants?: number;
};

const EMERALD = "#34d399";
const MINT = "#a7f3d0";
const MOSS = "#065f46";

const washPreset = {
  ...groundPresets.frostBallAura,
  element: "ice" as const,
  shape: "circle" as const,
  colorCore: MINT,
  colorMid: EMERALD,
  colorEdge: MOSS,
  opacity: 0.62,
  additive: true,
  ringWidth: 0.12,
  softness: 0.06,
  innerRatio: 0.12,
  spin: 0.08,
};

const fillPreset = {
  ...washPreset,
  opacity: 0.78,
  innerRatio: 0.08,
  spin: 0.14,
};

function ReviveZoneMesh({ room, id }: { room: Room; id: string }) {
  const root = useRef<THREE.Group>(null);
  const runeMesh = useRef<THREE.Mesh>(null);
  const opacityMul = useRef(1);
  const fillProgress = useRef(0);
  const rimPulse = useRef(1);

  const runeMat = useMemo(
    () => createRuneMaterial(EMERALD, { opacity: 0.7, spokes: 8 }),
    [],
  );

  useEffect(() => () => runeMat.dispose(), [runeMat]);

  useFrame((_, dt) => {
    const v = room.state?.pveReviveZones?.get(id) as ReviveSchema | undefined;
    const g = root.current;
    if (!v || !g) {
      if (g) g.visible = false;
      return;
    }
    g.visible = true;
    g.position.x = v.x;
    g.position.z = v.z;

    const charge = THREE.MathUtils.clamp(v.charge ?? 0, 0, 1);
    const occupants = Math.max(0, v.occupants ?? 0);
    fillProgress.current = Math.max(0.08, charge);
    const pulse = 0.88 + 0.12 * Math.sin(performance.now() * (occupants > 0 ? 0.007 : 0.003));
    rimPulse.current = occupants > 0 ? 0.7 + 0.3 * pulse : 0.55;
    opacityMul.current = (occupants > 0 ? 0.85 : 0.62) * pulse;

    tickRuneMaterial(runeMat, dt);
    runeMat.uniforms.uOpacity!.value = (0.28 + 0.55 * charge) * pulse;
    const rune = runeMesh.current;
    if (rune) {
      rune.visible = true;
      rune.rotation.z += dt * (occupants > 0 ? 0.7 : 0.28);
      const radius = Math.max(1.2, v.radius ?? PVE_ALLY_REVIVE_RADIUS);
      rune.scale.setScalar(radius * 1.85 * (0.94 + 0.06 * pulse));
    }
  });

  const radius = PVE_ALLY_REVIVE_RADIUS;

  return (
    <group ref={root}>
      <AoeRimMarker
        x={0}
        z={0}
        radius={radius}
        color={EMERALD}
        hotColor={MINT}
        fill={0.14}
        noise={0.18}
        glowWidth={0.055}
        opacity={0.7}
        opacityMulRef={rimPulse}
        pulse
      />
      <GroundDecal
        preset={washPreset}
        shape="circle"
        x={0}
        z={0}
        y={0.032}
        radius={radius * 1.04}
        opacityMulRef={opacityMul}
      />
      <GroundDecal
        preset={fillPreset}
        shape="circle"
        x={0}
        z={0}
        y={0.038}
        radius={radius * 0.92}
        opacityMulRef={opacityMul}
        progressRef={fillProgress}
        growExpand
      />
      <mesh
        ref={runeMesh}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.045, 0]}
        scale={radius * 1.85}
        material={runeMat}
        renderOrder={3}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}

/** Schema-synced PvE ally-revive circles. */
export function PveReviveZones({ room }: { room: Room | null }) {
  const [ids, setIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room?.state?.pveReviveZones) return;
    const next: string[] = [];
    room.state.pveReviveZones.forEach((_d: unknown, id: string) => next.push(id));
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
        <ReviveZoneMesh key={id} room={room} id={id} />
      ))}
    </>
  );
}
