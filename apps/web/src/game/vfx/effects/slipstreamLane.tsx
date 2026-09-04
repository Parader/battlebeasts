import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SLIPSTREAM_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope, smooth01 } from "../easing";
import { getWindStreakTexture } from "../windStreakTexture";

const LAYER_COUNT = 3;
const PARTICLE_N = 16;
const CYAN_TINT = new THREE.Color("#c0e8f5");
const PALE_TINT = new THREE.Color("#e4eff8");
const SIGIL_COLOR = new THREE.Color("#a8d8ea");

function hash01(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** 0 at both ends, 1 in the middle. */
function laneEndFade(along01: number, pad: number): number {
  return smooth01(Math.min(1, along01 / pad)) * smooth01(Math.min(1, (1 - along01) / pad));
}

/** Soft-edged plane so the stream tapers at start, end, and sides. */
function makeLanePlane(width: number, length: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(width, length, 4, 14);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const halfW = Math.max(0.001, width * 0.5);
  const endPad = 0.22;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const across = 1 - Math.pow(Math.min(1, Math.abs(x) / halfW), 1.55);
    const along01 = (y + length * 0.5) / Math.max(0.001, length);
    const a = Math.max(0, across) * laneEndFade(along01, endPad);
    colors[i * 3] = a;
    colors[i * 3 + 1] = a;
    colors[i * 3 + 2] = a;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

type ParticleSpec = {
  along0: number;
  across: number;
  y: number;
  len: number;
  speed: number;
  phase: number;
};

/**
 * Slipstream lane VFX:
 * - Textured wind layers scrolling forward (+Z in local space)
 * - Wispy particle streaks scrolling forward
 * - Ground sigils at origin and end of lane
 */
export function SlipstreamLaneEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Group>(null);

  const windTex = getWindStreakTexture();

  const halfW = Math.max(0.35, shot.radius ?? SLIPSTREAM_CAST.halfWidth);
  const hasEnd =
    typeof shot.originX === "number" &&
    typeof shot.originZ === "number" &&
    Number.isFinite(shot.originX) &&
    Number.isFinite(shot.originZ);
  const length = hasEnd
    ? Math.max(1, Math.hypot(shot.originX! - shot.x, shot.originZ! - shot.z))
    : SLIPSTREAM_CAST.length;
  const yaw = shot.yaw;
  const life = Math.max(800, shot.life || SLIPSTREAM_CAST.zoneDurationMs + 200);
  const seed = Math.floor(shot.key * 4243 + shot.x * 17);

  // Textured wind layers
  const layers = useMemo(() => {
    return Array.from({ length: LAYER_COUNT }, (_, i) => {
      const tex = windTex.clone();
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      // Plane args = [width(X), length(Y)]. After -PI/2 X-rot, Y becomes Z (forward).
      // Wind PNG has horizontal streaks. We rotate the UV 90° so streaks run along
      // the plane's Y axis (= forward after rotation).
      tex.rotation = Math.PI / 2;
      tex.center.set(0.5, 0.5);
      // After 90° rotation: repeat.x tiles along forward, repeat.y tiles laterally.
      tex.repeat.set(length / 4, halfW / 2);
      return {
        tex,
        mat: new THREE.MeshBasicMaterial({
          map: tex,
          color: i === 1 ? CYAN_TINT : PALE_TINT,
          vertexColors: true,
          transparent: true,
          opacity: 0.35 - i * 0.06,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
        geo: makeLanePlane(halfW * (1.8 - i * 0.15), length),
        y: 0.04 + i * 0.12 + hash01(seed + i) * 0.05,
        speed: 0.25 + i * 0.12 + hash01(seed + i * 7) * 0.08,
        xOff: (hash01(seed + i * 13) - 0.5) * halfW * 0.2,
        width: halfW * (1.8 - i * 0.15),
      };
    });
  }, [windTex, halfW, length, seed]);

  useEffect(() => {
    return () => {
      for (const layer of layers) layer.geo.dispose();
    };
  }, [layers]);

  // Forward-scrolling particle streaks
  const particles = useMemo((): ParticleSpec[] => {
    return Array.from({ length: PARTICLE_N }, (_, i) => ({
      along0: hash01(seed + 40 + i) * 0.85,
      across: (hash01(seed + 60 + i) - 0.5) * halfW * 1.5,
      y: 0.12 + hash01(seed + 80 + i) * 0.6,
      len: 0.3 + hash01(seed + 100 + i) * 0.55,
      speed: 0.5 + hash01(seed + 120 + i) * 0.7,
      phase: hash01(seed + 140 + i),
    }));
  }, [halfW, seed]);

  const particleMats = useMemo(
    () =>
      particles.map(
        () =>
          new THREE.MeshBasicMaterial({
            color: "#d0e8f2",
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
      ),
    [particles],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    if (ms >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const age = ms / life;
    const appear = softEnvelope(age, 0.08, 0.82);
    const t = ms / 1000;

    // Scroll texture forward (after 90° UV rotation, offset.x = forward)
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      layer.tex.offset.x = t * layer.speed;
      layer.mat.opacity = (0.32 - i * 0.05) * appear;
    }

    // Animate particles
    if (particlesRef.current) {
      for (let i = 0; i < particlesRef.current.children.length; i++) {
        const mesh = particlesRef.current.children[i] as THREE.Mesh;
        const spec = particles[i];
        const mat = particleMats[i];
        if (!spec || !mat) continue;
        const u = (spec.along0 + t * spec.speed + spec.phase) % 1.15;
        const along = u * length;
        const travelFade = u < 0.08 ? u / 0.08 : u > 0.85 ? Math.max(0, (1.05 - u) / 0.2) : 1;
        const endFade = laneEndFade(THREE.MathUtils.clamp(along / length, 0, 1), 0.18);
        mesh.position.set(spec.across, spec.y, along);
        mesh.scale.set(0.04 + hash01(seed + i) * 0.03, 1, spec.len);
        mat.opacity = 0.28 * appear * travelFade * endFade;
      }
    }

  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]} rotation={[0, yaw, 0]}>
      {/* Textured wind layers */}
      {layers.map((layer, i) => (
        <mesh
          key={`layer-${i}`}
          material={layer.mat}
          position={[layer.xOff, layer.y, length * 0.5]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={2}
        >
          <primitive object={layer.geo} attach="geometry" />
        </mesh>
      ))}

      {/* Forward-scrolling particle streaks */}
      <group ref={particlesRef}>
        {particles.map((_, i) => (
          <mesh
            key={`p-${i}`}
            material={particleMats[i]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={3}
          >
            <planeGeometry args={[0.1, 0.5]} />
          </mesh>
        ))}
      </group>

    </group>
  );
}

/** Ground-only sigil pulse when Slipstream buff is granted. */
export function SlipstreamTailwindEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const sigilRef = useRef<THREE.Mesh>(null);
  const sigilMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: SIGIL_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = Math.max(400, shot.life || 550);
    if (ms >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const age = ms / life;
    const amp = softEnvelope(age, 0.1, 0.4);

    if (sigilRef.current) {
      const s = 0.5 + amp * 0.7;
      sigilRef.current.scale.set(s, s, 1);
      sigilRef.current.rotation.z = ms * 0.003;
    }
    sigilMat.opacity = amp * 0.35;
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]}>
      <mesh
        ref={sigilRef}
        position={[0, 0.03, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={sigilMat}
      >
        <ringGeometry args={[0.35, 0.7, 6]} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} material={sigilMat}>
        <ringGeometry args={[0.15, 0.25, 6]} />
      </mesh>
    </group>
  );
}
