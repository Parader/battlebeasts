import { useFrame, useThree } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { spawnElementRole, type ElementHandle } from "../engine";
import { cloneSpellEffectsMaterial, SOUL_MARK_GLYPH_FRAMES } from "../spellEffectsTexture";
import { SOUL_MARK_COLORS } from "./soulMarkPalette";

const FLY_Y = 1.05;

const BLOB_VERT = /* glsl */ `
uniform float uTime;
uniform float uWarp;
uniform float uSeed;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vViewDir;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

void main() {
  vec3 q = position * 2.15 + vec3(uSeed);
  float n = noise(q + vec3(uTime * 0.55, uTime * 0.38, -uTime * 0.42));
  float n2 = noise(q * 1.9 - vec3(uTime * 0.72, 0.15, uTime * 0.5));
  float w = (n * 0.62 + n2 * 0.38 - 0.4) * uWarp;
  vec3 pos = position + normal * w;
  vObj = pos;
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const BLOB_FRAG = /* glsl */ `
uniform vec3 uColorHot;
uniform vec3 uColorMid;
uniform vec3 uColorDeep;
uniform float uOpacity;
uniform float uTime;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vViewDir;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

void main() {
  vec3 nrm = normalize(vNormalW);
  vec3 view = normalize(vViewDir);
  float fres = pow(1.0 - max(dot(nrm, view), 0.0), 1.7);
  float turb = noise(vObj * 3.1 + vec3(0.0, uTime * 1.15, uTime * 0.4));
  float wisps = smoothstep(0.22, 0.78, turb);
  float mass = mix(0.38, 0.92, wisps) * (0.72 + fres * 0.35);
  float a = mass * uOpacity;
  if (a < 0.03) discard;
  vec3 col = mix(uColorDeep, uColorMid, turb);
  col = mix(col, uColorHot, fres * 0.85 + wisps * 0.12);
  gl_FragColor = vec4(col, a);
}
`;

function createSoulBlobMaterial(seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorHot: { value: new THREE.Color(SOUL_MARK_COLORS.bright) },
      uColorMid: { value: new THREE.Color(SOUL_MARK_COLORS.primary) },
      uColorDeep: { value: new THREE.Color(SOUL_MARK_COLORS.darkCore) },
      uOpacity: { value: 0.88 },
      uTime: { value: 0 },
      uWarp: { value: 0.32 },
      uSeed: { value: seed },
    },
    vertexShader: BLOB_VERT,
    fragmentShader: BLOB_FRAG,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/**
 * Soul Mark travel — writhing soul-wisp, not a stacked energy sphere.
 *
 * Caster: void blow on first spawn.
 * Travel: lumpy displaced lobes + rune-eye; ParticleWorld void trail and curling smoke.
 * Impact: Soul Mark rupture owns the landing.
 * Particles: void trail + void ground fog; no THREE.Points.
 * Light: none, the hot rim carries it.
 * Status: mark stacks live on the target ornament.
 */
export function SoulMarkProjectileEffect({ room, id }: { room: Room; id: string }) {
  const group = useRef<THREE.Group>(null);
  const aim = useRef<THREE.Group>(null);
  const tumble = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const blob = useRef<THREE.Mesh>(null);
  const lobeA = useRef<THREE.Mesh>(null);
  const lobeB = useRef<THREE.Mesh>(null);
  const eye = useRef<THREE.Mesh>(null);
  const trail = useRef<ElementHandle | null>(null);
  const fog = useRef<ElementHandle | null>(null);
  const { camera } = useThree();

  const blobGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 2), []);
  const coreGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const eyeGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const blobMat = useMemo(() => createSoulBlobMaterial(1.7), []);
  const lobeAMat = useMemo(() => createSoulBlobMaterial(4.2), []);
  const lobeBMat = useMemo(() => createSoulBlobMaterial(8.9), []);
  const coreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: SOUL_MARK_COLORS.darkCore,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const eyeMat = useMemo(
    () =>
      cloneSpellEffectsMaterial(SOUL_MARK_GLYPH_FRAMES[0]!, {
        color: SOUL_MARK_COLORS.hotFlash,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        softEdge: true,
        insetPx: 8,
      }),
    [],
  );

  const renderPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const wake = spawnElementRole("void", "trail", 0, FLY_Y, 0);
    const smoke = spawnElementRole("void", "ground", 0, FLY_Y, 0);
    wake.setRateScale(0);
    smoke.setRateScale(0);
    trail.current = wake;
    fog.current = smoke;
    return () => {
      wake.kill();
      smoke.kill();
      if (trail.current === wake) trail.current = null;
      if (fog.current === smoke) fog.current = null;
      blobGeo.dispose();
      coreGeo.dispose();
      eyeGeo.dispose();
      blobMat.dispose();
      lobeAMat.dispose();
      lobeBMat.dispose();
      coreMat.dispose();
      eyeMat.map?.dispose();
      eyeMat.dispose();
    };
  }, [blobGeo, coreGeo, eyeGeo, blobMat, lobeAMat, lobeBMat, coreMat, eyeMat]);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | { x: number; z: number; vx?: number; vz?: number }
      | undefined;
    const g = group.current;
    if (!p || !g) {
      if (g) g.visible = false;
      trail.current?.setRateScale(0);
      fog.current?.setRateScale(0);
      seeded.current = false;
      return;
    }
    g.visible = true;

    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;
    const safeDt = Math.min(0.05, Math.max(0, dt));
    const tSec = performance.now() * 0.001;

    if (!seeded.current) {
      renderPos.current.set(p.x, FLY_Y, p.z);
      lastServer.current = { x: p.x, z: p.z, vx, vz };
      seeded.current = true;
    } else {
      renderPos.current.x += vx * safeDt;
      renderPos.current.z += vz * safeDt;

      const errX = p.x - renderPos.current.x;
      const errZ = p.z - renderPos.current.z;
      const err = Math.hypot(errX, errZ);
      if (err > 2.5) {
        renderPos.current.x = p.x;
        renderPos.current.z = p.z;
      } else if (err > 0.02) {
        const pull = Math.min(1, safeDt * 8);
        renderPos.current.x += errX * pull;
        renderPos.current.z += errZ * pull;
      }
      lastServer.current = { x: p.x, z: p.z, vx, vz };
    }

    g.position.copy(renderPos.current);
    trail.current?.setPose(renderPos.current.x, renderPos.current.y, renderPos.current.z);
    trail.current?.setRateScale(1);
    fog.current?.setPose(renderPos.current.x, renderPos.current.y - 0.06, renderPos.current.z);
    fog.current?.setRateScale(0.55);

    const speed = Math.hypot(vx, vz);
    if (aim.current && speed > 0.05) {
      lookTarget.set(renderPos.current.x + vx, renderPos.current.y, renderPos.current.z + vz);
      aim.current.lookAt(lookTarget);
    }
    if (tumble.current) {
      tumble.current.rotation.z = tSec * 1.15;
      tumble.current.rotation.x = Math.sin(tSec * 1.7) * 0.22;
    }

    blobMat.uniforms.uTime!.value += safeDt;
    lobeAMat.uniforms.uTime!.value += safeDt;
    lobeBMat.uniforms.uTime!.value += safeDt;
    const breath = 1 + Math.sin(tSec * 3.4) * 0.08;
    blobMat.uniforms.uWarp!.value = 0.3 + Math.sin(tSec * 2.1) * 0.05;
    lobeAMat.uniforms.uWarp!.value = 0.38 + Math.sin(tSec * 2.6 + 1.2) * 0.07;
    lobeBMat.uniforms.uWarp!.value = 0.36 + Math.cos(tSec * 2.3 + 0.4) * 0.06;

    if (core.current) {
      const s = 0.09 * (1 + Math.sin(tSec * 5.2) * 0.06);
      core.current.scale.set(s * 0.85, s, s * 1.15);
    }
    if (blob.current) {
      blob.current.scale.set(0.17 * breath, 0.21 * breath, 0.34 * breath);
    }
    if (lobeA.current) {
      lobeA.current.position.set(
        Math.sin(tSec * 2.3) * 0.08,
        0.04 + Math.cos(tSec * 1.8) * 0.05,
        Math.sin(tSec * 1.4) * 0.05,
      );
      lobeA.current.rotation.set(tSec * 1.6, tSec * 0.9, tSec * 0.55);
      const s = 0.13 * (1 + Math.sin(tSec * 3.8) * 0.14);
      lobeA.current.scale.setScalar(s);
    }
    if (lobeB.current) {
      lobeB.current.position.set(
        Math.cos(tSec * 1.9 + 1.1) * 0.07,
        -0.03 + Math.sin(tSec * 2.5) * 0.045,
        Math.cos(tSec * 1.6) * 0.055,
      );
      lobeB.current.rotation.set(tSec * -1.2, tSec * 1.4, tSec * -0.7);
      const s = 0.11 * (1 + Math.cos(tSec * 4.1) * 0.16);
      lobeB.current.scale.setScalar(s);
    }
    if (eye.current) {
      eye.current.quaternion.copy(camera.quaternion);
      const s = 0.22 * (0.88 + 0.12 * (0.5 + 0.5 * Math.sin(tSec * 6.5)));
      eye.current.scale.setScalar(s);
      eyeMat.opacity = 0.55 + 0.22 * (0.5 + 0.5 * Math.sin(tSec * 7.2));
    }
  });

  return (
    <group ref={group} visible={false}>
      <group ref={aim}>
        <group ref={tumble}>
          <mesh ref={core} geometry={coreGeo} material={coreMat} renderOrder={6} />
          <mesh ref={blob} geometry={blobGeo} material={blobMat} renderOrder={4} />
          <mesh ref={lobeA} geometry={blobGeo} material={lobeAMat} renderOrder={4} />
          <mesh ref={lobeB} geometry={blobGeo} material={lobeBMat} renderOrder={4} />
        </group>
      </group>
      <mesh ref={eye} geometry={eyeGeo} material={eyeMat} renderOrder={7} />
    </group>
  );
}
