import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { RIFT_FISSURE_CAST } from "@battlebeasts/shared";

type RiftSchema = {
  ownerSessionId?: string;
  phase?: string;
  armEndsAt?: number;
  index?: number;
};

const RING_RADIUS = 0.72;

/** Outline-only cooldown: bright arc depletes clockwise; dim track stays full. */
function createRiftArmRingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uFill: { value: new THREE.Color("#ddd6fe") },
      uTrack: { value: new THREE.Color("#4c1d95") },
      uInner: { value: 0.86 },
      uOuter: { value: 0.98 },
      uOpacity: { value: 0.9 },
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
        float soft = 0.02;
        float band = smoothstep(uInner - soft, uInner + soft, r)
          * (1.0 - smoothstep(uOuter - soft, uOuter + soft, r));
        if (band < 0.01) discard;

        // 0 at +Z (forward), sweeping clockwise as time elapses.
        float ang = atan(p.x, -p.y);
        float a01 = ang / 6.28318530718 + 0.5;
        float edge = 0.016;
        float filled = 1.0 - smoothstep(uProgress, uProgress + edge, a01);
        vec3 col = mix(uTrack, uFill, filled);
        float alpha = band * uOpacity * mix(0.38, 1.0, filled);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
}

/**
 * Circular countdown under the caster's feet while waiting to plant portal B.
 * Outline ring de-progresses (does not shrink in radius).
 */
export function RiftArmRing({
  room,
  sessionId,
}: {
  room: Room | null;
  sessionId: string | null;
}) {
  const root = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => createRiftArmRingMaterial(), []);

  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(() => {
    const g = root.current;
    if (!room?.state?.riftPortals || !sessionId) {
      if (g) g.visible = false;
      return;
    }
    let armEndsAt = 0;
    room.state.riftPortals.forEach((raw: RiftSchema) => {
      if (raw.ownerSessionId !== sessionId) return;
      if (raw.phase !== "arming") return;
      if ((raw.index ?? 0) !== 0) return;
      armEndsAt = Math.max(armEndsAt, raw.armEndsAt ?? 0);
    });
    if (armEndsAt <= 0) {
      if (g) g.visible = false;
      return;
    }
    const left = Math.max(0, armEndsAt - Date.now());
    const remaining = left / Math.max(1, RIFT_FISSURE_CAST.armMs);
    // Shader expects elapsed 0→1 (full → empty).
    const elapsed = 1 - Math.max(0, Math.min(1, remaining));
    mat.uniforms.uProgress!.value = elapsed;
    mat.uniforms.uOpacity!.value = remaining > 0.02 ? 0.9 : 0;
    if (g) g.visible = remaining > 0.02;
    if (mesh.current) mesh.current.visible = remaining > 0.02;
  });

  if (!sessionId) return null;

  return (
    <group ref={root} position={[0, 0.03, 0]} visible={false}>
      <mesh
        ref={mesh}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[RING_RADIUS * 2, RING_RADIUS * 2, 1]}
        renderOrder={-2}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}
