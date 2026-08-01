import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { VFX_FIRE_URL } from "../vfxUrls";

/**
 * Continuous textured point-sprite fire — adapted from bobbyroe's
 * Simple-Particle-Effects (MIT).
 * https://github.com/bobbyroe/Simple-Particle-Effects
 *
 * Point sizes use the same distance scale as AdditiveParticleBurst
 * (not bobbyroe's raw FOV multiplier), so we don't paint 500px+ quads.
 */

type Emitter = {
  x: number;
  y: number;
  z: number;
  /** 0..1 — only emits once wall grow progress reaches this. */
  reveal?: number;
};

type FireParticle = {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  rotation: number;
  rotationRate: number;
};

export type FireParticleFieldProps = {
  emitters: Emitter[];
  /** Particles spawned per second across all active emitters. */
  rate?: number;
  maxParticles?: number;
  textureUrl?: string;
  maxLife?: number;
  /** Base point size (pre distance scale) — keep ~0.15–0.45. */
  maxSize?: number;
  rise?: number;
  spread?: number;
  /**
   * Optional spawn velocity (world units/s). When set, particles drift along
   * this vector instead of rising (+Y) — use for projectile trails.
   */
  emitVelocityRef?: { current: { x: number; y: number; z: number } };
  /** Hot → mid → cool tint over particle life. Defaults to fire oranges. */
  colorStops?: readonly [string, string, string];
  progressRef?: { current: number };
  opacityMulRef?: { current: number };
};

const VS = /* glsl */ `
attribute float aSize;
attribute float aAngle;
attribute vec4 aColor;
varying vec4 vColor;
varying vec2 vAngle;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Cap size — uncapped FOV mul was freezing the GPU on long walls.
  float psz = aSize * (160.0 / max(-mv.z, 0.6));
  gl_PointSize = min(psz, 64.0);
  vAngle = vec2(cos(aAngle), sin(aAngle));
  vColor = aColor;
}
`;

const FS = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
varying vec2 vAngle;
void main() {
  vec2 coords = (gl_PointCoord - 0.5) * mat2(vAngle.x, vAngle.y, -vAngle.y, vAngle.x) + 0.5;
  vec4 tex = texture2D(uMap, coords);
  vec4 col = tex * vColor;
  if (col.a < 0.03) discard;
  gl_FragColor = col;
}
`;

function alphaAt(t: number) {
  if (t < 0.12) return t / 0.12;
  if (t < 0.5) return 1;
  return 1 - (t - 0.5) / 0.5;
}

function sizeAt(t: number) {
  return 0.45 + 0.7 * Math.min(1, t * 1.15);
}

const _defaultStops = ["#fff7ed", "#fb923c", "#ef4444"] as const;

function lerpColorStops(
  t: number,
  c0: THREE.Color,
  c1: THREE.Color,
  c2: THREE.Color,
  out: THREE.Color,
) {
  if (t < 0.35) return out.copy(c0).lerp(c1, t / 0.35);
  return out.copy(c1).lerp(c2, (t - 0.35) / 0.65);
}

const fireTexCache = new Map<string, THREE.Texture>();
const fireMatCache = new Map<string, THREE.ShaderMaterial>();

function getFireTexture(url: string): THREE.Texture {
  let tex = fireTexCache.get(url);
  if (!tex) {
    tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    fireTexCache.set(url, tex);
  }
  return tex;
}

/** Install a fully-decoded fire texture from the loading gate. */
export function setFireTexture(url: string, tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  fireTexCache.set(url, tex);
  const mat = fireMatCache.get(url);
  if (mat?.uniforms.uMap) mat.uniforms.uMap.value = tex;
}

/** Shared across firewall/volcano — one compile, no per-mount dispose hitch. */
export function getSharedFireMaterial(url = VFX_FIRE_URL): THREE.ShaderMaterial {
  let mat = fireMatCache.get(url);
  if (!mat) {
    mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: getFireTexture(url) },
      },
      vertexShader: VS,
      fragmentShader: FS,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    fireMatCache.set(url, mat);
  }
  return mat;
}

function getFireMaterial(url: string): THREE.ShaderMaterial {
  return getSharedFireMaterial(url);
}

export function FireParticleField({
  emitters,
  rate = 85,
  maxParticles = 280,
  textureUrl = VFX_FIRE_URL,
  maxLife = 1.2,
  maxSize = 0.4,
  rise = 2.1,
  spread = 0.18,
  emitVelocityRef,
  colorStops = _defaultStops,
  progressRef,
  opacityMulRef,
}: FireParticleFieldProps) {
  const points = useRef<THREE.Points>(null);
  const emitAcc = useRef(0);
  const living = useRef(0);

  const pool = useMemo(() => {
    const arr: FireParticle[] = [];
    for (let i = 0; i < maxParticles; i++) {
      arr.push({
        alive: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 0.2,
        rotation: 0,
        rotationRate: 0,
      });
    }
    return arr;
  }, [maxParticles]);

  const positions = useMemo(() => new Float32Array(maxParticles * 3), [maxParticles]);
  const sizes = useMemo(() => new Float32Array(maxParticles), [maxParticles]);
  const colors = useMemo(() => new Float32Array(maxParticles * 4), [maxParticles]);
  const angles = useMemo(() => new Float32Array(maxParticles), [maxParticles]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 4));
    geo.setAttribute("aAngle", new THREE.BufferAttribute(angles, 1));
    geo.setDrawRange(0, 0);
    return geo;
  }, [positions, sizes, colors, angles]);

  const material = useMemo(() => getFireMaterial(textureUrl), [textureUrl]);

  const palette = useMemo(() => {
    return {
      c0: new THREE.Color(colorStops[0]),
      c1: new THREE.Color(colorStops[1]),
      c2: new THREE.Color(colorStops[2]),
      out: new THREE.Color(),
    };
  }, [colorStops[0], colorStops[1], colorStops[2]]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      // Shared fire mat/texture — do not dispose here.
    };
  }, [geometry]);

  useFrame((_, dt) => {
    const pts = points.current;
    if (!pts) return;
    const safeDt = Math.min(0.033, dt);
    const progress = progressRef?.current ?? 1;
    const opacityMul = opacityMulRef?.current ?? 1;
    const canEmit = opacityMul > 0.02 && progress > 0.04 && emitters.length > 0;

    // Spawn into free pool slots (no per-frame array alloc)
    if (canEmit && living.current < maxParticles) {
      emitAcc.current += safeDt * rate * Math.min(1, 0.4 + progress * 0.85);
      let n = Math.floor(emitAcc.current);
      emitAcc.current -= n;
      for (let s = 0; s < n && living.current < maxParticles; s++) {
        // Pick an emitter that's revealed
        let em: Emitter | null = null;
        for (let tries = 0; tries < 4; tries++) {
          const cand = emitters[(Math.random() * emitters.length) | 0]!;
          if (progress >= (cand.reveal ?? 0) * 0.88) {
            em = cand;
            break;
          }
        }
        if (!em) break;
        let slot = -1;
        for (let i = 0; i < maxParticles; i++) {
          if (!pool[i]!.alive) {
            slot = i;
            break;
          }
        }
        if (slot < 0) break;
        const p = pool[slot]!;
        const life = (Math.random() * 0.45 + 0.55) * maxLife;
        p.alive = true;
        p.x = em.x + (Math.random() * 2 - 1) * spread;
        p.y = em.y + Math.random() * 0.06;
        p.z = em.z + (Math.random() * 2 - 1) * spread;
        const drift = emitVelocityRef?.current;
        if (drift) {
          const jitter = 0.35;
          p.vx = drift.x * (0.75 + Math.random() * 0.45) + (Math.random() * 2 - 1) * jitter;
          p.vy = drift.y * (0.75 + Math.random() * 0.45) + (Math.random() * 2 - 1) * jitter * 0.35;
          p.vz = drift.z * (0.75 + Math.random() * 0.45) + (Math.random() * 2 - 1) * jitter;
        } else {
          p.vx = (Math.random() * 2 - 1) * 0.28;
          p.vy = rise * (0.7 + Math.random() * 0.45);
          p.vz = (Math.random() * 2 - 1) * 0.28;
        }
        p.life = life;
        p.maxLife = life;
        p.size = (Math.random() * 0.4 + 0.6) * maxSize;
        p.rotation = Math.random() * Math.PI * 2;
        p.rotationRate = Math.random() * 0.025 - 0.012;
        living.current++;
      }
    }

    let write = 0;
    let aliveCount = 0;
    for (let i = 0; i < maxParticles; i++) {
      const p = pool[i]!;
      if (!p.alive) continue;
      p.life -= safeDt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      aliveCount++;
      p.rotation += p.rotationRate;
      p.x += p.vx * safeDt;
      p.y += p.vy * safeDt;
      p.z += p.vz * safeDt;
      p.vx *= 1 - 0.15 * safeDt;
      p.vy *= 1 - 0.1 * safeDt;
      p.vz *= 1 - 0.15 * safeDt;

      const t = 1 - p.life / p.maxLife;
      positions[write * 3] = p.x;
      positions[write * 3 + 1] = p.y;
      positions[write * 3 + 2] = p.z;
      // ×40 matches AdditiveParticleBurst scale into the distance formula
      sizes[write] = p.size * sizeAt(t) * 40;
      lerpColorStops(t, palette.c0, palette.c1, palette.c2, palette.out);
      const a = alphaAt(t) * opacityMul * 0.9;
      colors[write * 4] = palette.out.r;
      colors[write * 4 + 1] = palette.out.g;
      colors[write * 4 + 2] = palette.out.b;
      colors[write * 4 + 3] = a;
      angles[write] = p.rotation;
      write++;
    }
    living.current = aliveCount;

    geometry.setDrawRange(0, write);
    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.aSize!.needsUpdate = true;
    geometry.attributes.aColor!.needsUpdate = true;
    geometry.attributes.aAngle!.needsUpdate = true;
    pts.visible = write > 0 && opacityMul > 0.02;
  });

  return (
    <points ref={points} geometry={geometry} material={material} frustumCulled={false} />
  );
}
