import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { ChestLootLine, ChestQuality } from "@battlebeasts/shared";
import { assetUrl } from "../assetUrl";
import { CoinIcon, GemIcon } from "./CoinDisplay";
import { ShopGrantThumb, grantDisplayLabel } from "./ShopGrantThumb";

export const CHEST_GLB_URL = assetUrl("assets/vfx/chest.glb");
useGLTF.preload(CHEST_GLB_URL);

export type ChestRevealState = {
  quality: ChestQuality | string;
  essence: number;
  copper: number;
  lines: ChestLootLine[];
};

type Props = {
  reveal: ChestRevealState;
  onClose: () => void;
};

const RARITY_HEX: Record<string, string> = {
  green: "#4ade80",
  blue: "#38bdf8",
  purple: "#a78bfa",
  legendary: "#fbbf24",
};

/** Lid hinge open (~112°) — pivot is authored on SM_Prop_Chest_01_Lid. */
const LID_OPEN_RAD = -Math.PI * 0.62;

const SPIKE_COUNT = 16;

/** Timeline (ms) — shake / suspense before rarity + lid. */
const SHAKE_MS = 1100;
const OPEN_MS = 950;
const LOOT_DELAY_MS = 180;

type AnimState = {
  /** 0–1 shake intensity (peaks near end of shake). */
  shake: number;
  /** 0–1 lid open. */
  open: number;
  /** 0–1 rarity glow / color reveal. */
  rarity: number;
  elapsed: number;
};

const ZERO_ANIM: AnimState = { shake: 0, open: 0, rarity: 0, elapsed: 0 };

function easeInOut(t: number) {
  return t * t * (3 - 2 * t);
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

/** Soft radial disc — fades to 0 so glow never hard-clips. */
function createSoftGlowMaterial(colorHex: string) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float d = length(p);
        float soft = 1.0 - smoothstep(0.15, 1.0, d);
        soft *= soft;
        float a = soft * uOpacity;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
}

function ChestModel({
  openProgress,
  shake,
}: {
  openProgress: number;
  shake: number;
}) {
  const group = useRef<THREE.Group>(null);
  const shakeRef = useRef<THREE.Group>(null);
  const lidRef = useRef<THREE.Object3D | null>(null);
  const lidRestX = useRef(0);
  const framedRef = useRef(false);
  const { camera, size: viewSize } = useThree();
  const gltf = useGLTF(CHEST_GLB_URL);

  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  useLayoutEffect(() => {
    const lid =
      scene.getObjectByName("SM_Prop_Chest_01_Lid") ??
      scene.getObjectByName("Lid") ??
      null;
    lidRef.current = lid;
    if (lid) lidRestX.current = lid.rotation.x;

    if (!group.current || framedRef.current) return;
    const box = new THREE.Box3().setFromObject(scene);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    scene.position.sub(center);
    group.current.scale.setScalar(0.95 / maxDim);

    const dist = 3.15;
    const aspect = viewSize.width / Math.max(1, viewSize.height);
    camera.position.set(dist * 0.22, dist * 0.36, dist);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = aspect;
      camera.fov = 34;
      camera.near = 0.05;
      camera.far = 50;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(0, 0.04, 0);
    framedRef.current = true;
  }, [scene, camera, viewSize.width, viewSize.height]);

  useFrame(({ clock }) => {
    const lid = lidRef.current;
    if (lid) lid.rotation.x = lidRestX.current + openProgress * LID_OPEN_RAD;

    const g = shakeRef.current;
    if (!g) return;
    if (shake <= 0.001) {
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
      return;
    }
    const t = clock.elapsedTime;
    const amp = shake * 0.028;
    // Building rattle — faster near peak shake.
    const freq = 18 + shake * 28;
    g.position.x = Math.sin(t * freq) * amp;
    g.position.y = Math.abs(Math.sin(t * freq * 1.35)) * amp * 0.55;
    g.position.z = Math.cos(t * freq * 0.9) * amp * 0.7;
    g.rotation.z = Math.sin(t * freq * 1.1) * amp * 1.8;
    g.rotation.x = Math.cos(t * freq * 0.85) * amp * 0.9;
  });

  return (
    <group ref={group}>
      <group ref={shakeRef}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

/** Soft rarity bloom behind/around the chest — delayed until rarity reveal. */
function RarityBackGlow({
  colorHex,
  rarity,
}: {
  colorHex: string;
  rarity: number;
}) {
  const group = useRef<THREE.Group>(null);
  const matA = useMemo(() => createSoftGlowMaterial(colorHex), [colorHex]);
  const matB = useMemo(() => createSoftGlowMaterial(colorHex), [colorHex]);
  const matC = useMemo(() => createSoftGlowMaterial("#fff8e0"), []);

  useEffect(() => {
    return () => {
      matA.dispose();
      matB.dispose();
      matC.dispose();
    };
  }, [matA, matB, matC]);

  useFrame(({ clock, camera }) => {
    const pulse = 0.9 + Math.sin(clock.elapsedTime * 2.2) * 0.1;
    const r = rarity * pulse;
    matA.uniforms.uOpacity.value = r * 0.55;
    matB.uniforms.uOpacity.value = r * 0.28;
    matC.uniforms.uOpacity.value = r * 0.12;
    if (group.current) group.current.quaternion.copy(camera.quaternion);
  });

  return (
    <group position={[0, 0.06, -0.35]}>
      <pointLight color={colorHex} intensity={rarity * 5.5} distance={8} decay={2} />
      <pointLight
        color={colorHex}
        intensity={rarity * 2.2}
        distance={5}
        decay={2}
        position={[0, 0.35, 0.4]}
      />
      <group ref={group}>
        <mesh material={matA} position={[0, 0.05, 0]} scale={2.8}>
          <planeGeometry args={[1, 1]} />
        </mesh>
        <mesh material={matB} position={[0, 0.08, -0.05]} scale={4.6}>
          <planeGeometry args={[1, 1]} />
        </mesh>
        <mesh material={matC} position={[0, 0.1, 0.05]} scale={1.7}>
          <planeGeometry args={[1, 1]} />
        </mesh>
      </group>
    </group>
  );
}

/** Neutral warm tease light during shake (no rarity color yet). */
function AnticipationGlow({ shake }: { shake: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => createSoftGlowMaterial("#ffd27a"), []);
  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(({ clock, camera }) => {
    const flicker =
      shake *
      (0.35 + Math.sin(clock.elapsedTime * 14) * 0.2 + Math.sin(clock.elapsedTime * 23) * 0.1);
    mat.uniforms.uOpacity.value = flicker * 0.22;
    if (meshRef.current) meshRef.current.quaternion.copy(camera.quaternion);
  });

  return (
    <group position={[0, 0.05, 0.05]}>
      <pointLight color="#ffc978" intensity={shake * 1.4} distance={3} decay={2} />
      <mesh ref={meshRef} material={mat} scale={0.9}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}

/** Yellow rays aimed outward from the chest cavity (+Y cone → direction). */
function ChestInteriorBurst({ openProgress }: { openProgress: number }) {
  const group = useRef<THREE.Group>(null);
  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  const mats = useMemo(() => {
    const core = new THREE.MeshBasicMaterial({
      color: "#fff3a0",
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const ray = new THREE.MeshBasicMaterial({
      color: "#ffcc33",
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    return { core, ray };
  }, []);

  useEffect(() => {
    return () => {
      mats.core.dispose();
      mats.ray.dispose();
    };
  }, [mats]);

  const spikes = useMemo(() => {
    const items: {
      quat: THREE.Quaternion;
      mid: THREE.Vector3;
      len: number;
      thick: number;
    }[] = [];
    for (let i = 0; i < SPIKE_COUNT; i++) {
      const t = i / SPIKE_COUNT;
      // Fan mostly upward / outward from the open lid mouth.
      const yaw = t * Math.PI * 2 + (i % 2) * 0.2;
      const elev = 0.35 + (i % 5) * 0.12 + Math.sin(i * 2.1) * 0.08;
      const dir = new THREE.Vector3(
        Math.sin(yaw) * Math.cos(elev),
        Math.sin(elev) + 0.15,
        Math.cos(yaw) * Math.cos(elev),
      ).normalize();
      const len = 0.7 + (i % 4) * 0.14;
      const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
      items.push({
        quat,
        mid: dir.clone().multiplyScalar(len * 0.5),
        len,
        thick: 0.022 + (i % 3) * 0.008,
      });
    }
    return items;
  }, [yAxis]);

  useFrame(({ clock }) => {
    const t = Math.max(0, (openProgress - 0.12) / 0.88);
    const eased = easeOutCubic(t);
    const pulse = 0.88 + Math.sin(clock.elapsedTime * 5.5) * 0.12;
    mats.core.opacity = eased * 0.9 * pulse;
    mats.ray.opacity = eased * 0.5 * pulse;
    if (group.current) {
      group.current.scale.setScalar(0.25 + eased * 1.05);
      group.current.rotation.y = clock.elapsedTime * 0.22;
    }
  });

  return (
    <group ref={group} position={[0, 0.1, 0.04]}>
      <mesh material={mats.core}>
        <sphereGeometry args={[0.08, 16, 16]} />
      </mesh>
      <mesh material={mats.core} scale={2.1}>
        <sphereGeometry args={[0.08, 12, 12]} />
      </mesh>
      {spikes.map((s, i) => (
        <mesh
          key={i}
          material={mats.ray}
          quaternion={s.quat}
          position={s.mid}
        >
          <coneGeometry args={[s.thick, s.len, 5, 1, true]} />
        </mesh>
      ))}
    </group>
  );
}

function LootOverlayLine({ line }: { line: ChestLootLine }) {
  if (line.kind === "note") {
    return <span className="bb-chest-loot__line">{line.text}</span>;
  }
  if (line.kind === "essence") {
    return (
      <span className="bb-chest-loot__line">
        <GemIcon kind="essence" size={28} />
        <span>+{line.amount} essence</span>
      </span>
    );
  }
  if (line.kind === "copper") {
    return (
      <span className="bb-chest-loot__line">
        <CoinIcon metal="copper" size={28} />
        <span>+{line.amount} copper</span>
      </span>
    );
  }
  if (line.kind === "duplicate_copper") {
    return (
      <span className="bb-chest-loot__line bb-chest-loot__line--dupe">
        <ShopGrantThumb grant={line.grant} forceIcon />
        <span className="bb-chest-loot__dupe-meta">
          <span className="bb-chest-loot__dupe-name">
            {grantDisplayLabel(line.grant, line.for)}
          </span>
          <span className="bb-chest-loot__dupe-sub">
            Duplicate · <CoinIcon metal="copper" size={18} /> +{line.amount} copper
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className="bb-chest-loot__line">
      <ShopGrantThumb grant={line.grant} forceIcon />
      <span>{grantDisplayLabel(line.grant, line.label)}</span>
    </span>
  );
}

function ChestScene({
  anim,
  rarityHex,
}: {
  anim: AnimState;
  rarityHex: string;
}) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2.5, 4, 2]} intensity={1.15} />
      <directionalLight position={[-2, 1.5, -1]} intensity={0.3} />
      <Suspense fallback={null}>
        <AnticipationGlow shake={anim.shake * (1 - anim.rarity)} />
        <RarityBackGlow colorHex={rarityHex} rarity={anim.rarity} />
        <ChestModel openProgress={anim.open} shake={anim.shake} />
        <ChestInteriorBurst openProgress={anim.open} />
      </Suspense>
    </>
  );
}

/** Full-screen chest open — shake → rarity bloom → lid + spikes → loot. */
export function ChestRevealPanel({ reveal, onClose }: Props) {
  const [anim, setAnim] = useState<AnimState>(ZERO_ANIM);
  const [showLoot, setShowLoot] = useState(false);
  const rarityHex = RARITY_HEX[reveal.quality] ?? RARITY_HEX.blue;

  useEffect(() => {
    setAnim(ZERO_ANIM);
    setShowLoot(false);
    const start = performance.now();
    let raf = 0;
    let lootShown = false;

    const tick = (now: number) => {
      const elapsed = now - start;
      let shake = 0;
      let open = 0;
      let rarity = 0;

      if (elapsed < SHAKE_MS) {
        const t = elapsed / SHAKE_MS;
        // Build suspense: soft → hard rattle near the end.
        shake = easeInOut(Math.min(1, t / 0.55)) * (0.35 + 0.65 * easeInOut(t));
        // Tiny rarity tease only in the last beat of the shake.
        rarity = t > 0.82 ? easeInOut((t - 0.82) / 0.18) * 0.15 : 0;
      } else {
        shake = Math.max(0, 1 - (elapsed - SHAKE_MS) / 180);
        const ot = Math.min(1, (elapsed - SHAKE_MS) / OPEN_MS);
        open = easeOutCubic(ot);
        rarity = Math.min(1, 0.15 + easeOutCubic(Math.min(1, ot / 0.55)) * 0.85);
      }

      setAnim({ shake, open, rarity, elapsed });

      if (!lootShown && elapsed >= SHAKE_MS + OPEN_MS + LOOT_DELAY_MS) {
        lootShown = true;
        setShowLoot(true);
      }

      if (elapsed < SHAKE_MS + OPEN_MS + LOOT_DELAY_MS + 400) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reveal]);

  return (
    <div
      data-ui-overlay
      className="bb-chest-reveal pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center"
    >
      {/* Full-bleed WebGL so soft glows feather off instead of clipping mid-frame. */}
      <div className="bb-chest-reveal__canvas pointer-events-none absolute inset-0">
        <Canvas
          camera={{ position: [0.7, 1.15, 3.15], fov: 34, near: 0.05, far: 50 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
          style={{ width: "100%", height: "100%", display: "block", background: "transparent" }}
        >
          <ChestScene anim={anim} rarityHex={rarityHex} />
        </Canvas>
      </div>

      <div className="bb-chest-reveal__stage relative z-10 flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-2">
        <div className="relative h-[min(58vh,24rem)] w-full">
          <div
            className={[
              "bb-chest-loot pointer-events-none absolute inset-x-0 top-[8%] flex flex-col items-center gap-3 px-4 transition-opacity duration-500",
              showLoot ? "opacity-100" : "opacity-0",
            ].join(" ")}
          >
            {reveal.lines.map((line, i) => (
              <LootOverlayLine key={`${line.kind}-${i}`} line={line} />
            ))}
          </div>
        </div>

        <button
          type="button"
          className="bb-chest-reveal__collect mt-4"
          disabled={!showLoot}
          onClick={onClose}
        >
          Collect
        </button>
      </div>
    </div>
  );
}
