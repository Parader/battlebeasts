import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const SAMPLES = 36;
const MAX_PATH = 6.2;
const MIN_STEP = 0.05;
const MOVE_SPEED = 0.45;
const HEAD_WIDTH = 0.048;
const GLOW_WIDTH = 0.13;
const FADE_IN = 6;
const FADE_OUT = 3.4;

export type FlagTrailPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
};

type Sample = { x: number; y: number; z: number };

type Props = {
  color: string;
  hot: string;
  getPose: () => FlagTrailPose | null;
};

const RIBBON_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RIBBON_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSoft;
varying vec2 vUv;
void main() {
  // uv.x: 0 at the faded tail, 1 at the carrier.
  float along = vUv.x;
  float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;
  edge = pow(max(edge, 0.0), uSoft);
  float fade = pow(along, 1.15) * (1.0 - smoothstep(0.94, 1.0, along));
  float a = edge * fade * uOpacity;
  if (a < 0.012) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

function createRibbonMaterial(hex: string, opacity: number, soft: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(hex) },
      uOpacity: { value: opacity },
      uSoft: { value: soft },
    },
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function makeRibbonGeometry(segments: number): THREE.BufferGeometry {
  const verts = segments * 2;
  const positions = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const u = i / Math.max(1, segments - 1);
    uvs[i * 4] = u;
    uvs[i * 4 + 1] = 0;
    uvs[i * 4 + 2] = u;
    uvs[i * 4 + 3] = 1;
    if (i === 0) continue;
    const a = (i - 1) * 2;
    const b = a + 1;
    const c = i * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.setDrawRange(0, 0);
  return geo;
}

/**
 * Tapered additive ribbon that follows the carrier's path.
 * Hidden while standing still; no particle motes or discrete planes.
 */
export function FlagCarryTrail({ color, hot, getPose }: Props) {
  const root = useRef<THREE.Group>(null);
  const coreMesh = useRef<THREE.Mesh>(null);
  const glowMesh = useRef<THREE.Mesh>(null);
  const path = useRef<Sample[]>([]);
  const last = useRef<Sample | null>(null);
  const shown = useRef(0);
  const time = useRef(0);

  const coreGeo = useMemo(() => makeRibbonGeometry(SAMPLES), []);
  const glowGeo = useMemo(() => makeRibbonGeometry(SAMPLES), []);
  const coreMat = useMemo(() => createRibbonMaterial(hot, 0.92, 1.7), [hot]);
  const glowMat = useMemo(() => createRibbonMaterial(color, 0.38, 1.15), [color]);

  useEffect(() => {
    return () => {
      coreGeo.dispose();
      glowGeo.dispose();
      coreMat.dispose();
      glowMat.dispose();
    };
  }, [coreGeo, glowGeo, coreMat, glowMat]);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const safeDt = Math.min(0.05, Math.max(0, dt));
    time.current += safeDt;
    const pose = getPose();

    if (!pose) {
      last.current = null;
      shown.current = Math.max(0, shown.current - safeDt * FADE_OUT);
      if (shown.current <= 0.01) {
        path.current = [];
        g.visible = false;
        return;
      }
    } else {
      const prev = last.current;
      if (!prev) {
        last.current = { x: pose.x, y: pose.y, z: pose.z };
        path.current = [{ x: pose.x, y: pose.y, z: pose.z }];
      } else {
        const dx = pose.x - prev.x;
        const dz = pose.z - prev.z;
        const traveled = Math.hypot(dx, dz);
        const speed = safeDt > 1e-4 ? traveled / safeDt : 0;
        last.current = { x: pose.x, y: pose.y, z: pose.z };
        if (speed >= MOVE_SPEED) {
          shown.current = Math.min(1, shown.current + safeDt * FADE_IN);
          if (path.current.length === 0) {
            path.current.push({ x: prev.x, y: prev.y, z: prev.z });
          }
          if (traveled >= MIN_STEP) {
            path.current.push({ x: pose.x, y: pose.y, z: pose.z });
          } else if (path.current.length > 0) {
            const head = path.current[path.current.length - 1]!;
            head.x = pose.x;
            head.y = pose.y;
            head.z = pose.z;
          }
        } else {
          shown.current = Math.max(0, shown.current - safeDt * FADE_OUT);
          if (path.current.length > 0) {
            const head = path.current[path.current.length - 1]!;
            head.x = pose.x;
            head.y = pose.y;
            head.z = pose.z;
          }
        }
        trimPath(path.current, MAX_PATH);
      }
    }

    const pts = path.current;
    const live = shown.current > 0.02 && pts.length >= 2;
    g.visible = live;
    if (!live) return;

    writeRibbon(coreGeo, pts, HEAD_WIDTH, time.current, 1);
    writeRibbon(glowGeo, pts, GLOW_WIDTH, time.current, 0.55);
    const op = shown.current;
    coreMat.uniforms.uOpacity!.value = 0.92 * op;
    glowMat.uniforms.uOpacity!.value = 0.38 * op;
  });

  return (
    <group ref={root} visible={false}>
      <mesh
        ref={glowMesh}
        geometry={glowGeo}
        material={glowMat}
        frustumCulled={false}
        renderOrder={3}
      />
      <mesh
        ref={coreMesh}
        geometry={coreGeo}
        material={coreMat}
        frustumCulled={false}
        renderOrder={4}
      />
    </group>
  );
}

function trimPath(pts: Sample[], maxLen: number): void {
  let len = 0;
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i]!;
    const b = pts[i - 1]!;
    len += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (len > maxLen) {
      pts.splice(0, i);
      return;
    }
  }
}

function writeRibbon(
  geo: THREE.BufferGeometry,
  pts: Sample[],
  headWidth: number,
  t: number,
  wave: number,
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = SAMPLES;
  const count = pts.length;
  const lengths = new Float32Array(count);
  let total = 0;
  lengths[0] = 0;
  for (let i = 1; i < count; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    lengths[i] = total;
  }
  if (total < 1e-4) {
    geo.setDrawRange(0, 0);
    return;
  }

  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const dist = u * total;
    while (cursor < count - 2 && lengths[cursor + 1]! < dist) cursor++;
    const i0 = cursor;
    const i1 = Math.min(count - 1, cursor + 1);
    const span = Math.max(1e-5, lengths[i1]! - lengths[i0]!);
    const f = THREE.MathUtils.clamp((dist - lengths[i0]!) / span, 0, 1);
    const a = pts[i0]!;
    const b = pts[i1]!;
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const z = a.z + (b.z - a.z) * f;

    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const tlen = Math.hypot(tx, tz);
    if (tlen < 1e-5) {
      const prev = pts[Math.max(0, i0 - 1)]!;
      tx = a.x - prev.x;
      tz = a.z - prev.z;
    }
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const sx = tz;
    const sz = -tx;
    const taper = Math.pow(u, 1.05);
    const sway = Math.sin(t * 3.1 + u * 10.5) * 0.028 * (1 - u) * wave;
    const w = Math.max(0.006, headWidth * taper);
    const ox = sx * (w + sway);
    const oz = sz * (w + sway);

    const vi = i * 2;
    pos.setXYZ(vi, x - ox, y, z - oz);
    pos.setXYZ(vi + 1, x + ox, y, z + oz);
  }
  pos.needsUpdate = true;
  geo.setDrawRange(0, (n - 1) * 6);
  geo.computeBoundingSphere();
}
