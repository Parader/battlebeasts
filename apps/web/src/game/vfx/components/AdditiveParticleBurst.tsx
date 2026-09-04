import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ObjectPool } from "../pool";
import { createCirclePointMaterial } from "../materials/circlePoint";

export type ParticleBurstOpts = {
  color: string;
  count?: number;
  /** Seconds. */
  life?: number;
  speed?: number;
  speedSpread?: number;
  size?: number;
  sizeEnd?: number;
  /** Upward bias (world Y). */
  lift?: number;
  /** Spread cone: 0 = all directions, 1 = mostly +Y. */
  upBias?: number;
  /**
   * Prefer downward spray (0 = none, 1 = mostly -Y).
   * Overrides `upBias` when > 0 — used for wall fizzles.
   */
  downBias?: number;
  /** Gravity on particle Y (world units / s²). Default 4.5. */
  gravity?: number;
  /** Fraction of each particle life spent easing alpha in (0..1). */
  fadeIn?: number;
  /** Max spawn delay as a fraction of `life` so the burst isn't instant. */
  stagger?: number;
  /** Extra wait before the first particle (seconds). */
  startDelay?: number;
  /** Optional sprite map (defaults to circle.png). */
  map?: THREE.Texture | null;
};

type Particle = {
  alive: boolean;
  age: number;
  life: number;
  delay: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  sizeEnd: number;
};

function createParticle(): Particle {
  return {
    alive: false,
    age: 0,
    life: 1,
    delay: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    size: 0.1,
    sizeEnd: 0.02,
  };
}

/**
 * Additive point-sprite burst (CPU-sim, GPU draw) using soft circle.png.
 * Auto-hides when all particles die. Re-fire with `trigger` bump or remount.
 */
export function AdditiveParticleBurst({
  color,
  count = 18,
  life = 0.45,
  speed = 3.5,
  speedSpread = 2,
  size = 0.22,
  sizeEnd = 0.04,
  lift = 1.2,
  upBias = 0.35,
  downBias = 0,
  gravity = 4.5,
  fadeIn = 0.25,
  stagger = 0.2,
  startDelay = 0,
  map = null,
  origin = [0, 0, 0] as [number, number, number],
  trigger = 0,
}: ParticleBurstOpts & {
  origin?: [number, number, number];
  /** Change this to re-burst without remounting. */
  trigger?: number;
}) {
  const points = useRef<THREE.Points>(null);
  const pool = useMemo(() => new ObjectPool(createParticle), []);
  const active = useRef<Particle[]>([]);
  const positions = useMemo(() => new Float32Array(count * 3), [count]);
  const sizes = useMemo(() => new Float32Array(count), [count]);
  const alphas = useMemo(() => new Float32Array(count), [count]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return geo;
  }, [positions, sizes, alphas]);

  const material = useMemo(() => createCirclePointMaterial(color), [color]);

  useEffect(() => {
    const u = material.uniforms.uColor?.value as THREE.Color | undefined;
    u?.set(color);
    if (map && material.uniforms.uMap) {
      material.uniforms.uMap.value = map;
    }
  }, [material, color, map]);

  const burst = () => {
    for (const p of active.current) pool.release(p);
    active.current = [];
    for (let i = 0; i < count; i++) {
      const p = pool.acquire();
      p.alive = true;
      p.age = 0;
      p.delay = startDelay + Math.random() * life * stagger;
      p.life = life * (0.75 + Math.random() * 0.5);
      p.x = origin[0];
      p.y = origin[1];
      p.z = origin[2];
      const theta = Math.random() * Math.PI * 2;
      const spd = speed + (Math.random() - 0.5) * 2 * speedSpread;
      if (downBias > 0) {
        // elev: ~π/2 (horizontal) → π (straight down), weighted by downBias.
        const u = Math.random();
        const elev =
          Math.PI * 0.5 +
          Math.PI * 0.5 * Math.pow(u, Math.max(0.35, 1.15 - downBias));
        p.vx = Math.sin(elev) * Math.cos(theta) * spd * (0.55 + Math.random() * 0.45);
        p.vy = Math.cos(elev) * spd + lift * Math.random();
        p.vz = Math.sin(elev) * Math.sin(theta) * spd * (0.55 + Math.random() * 0.45);
      } else {
        const up = Math.random();
        const elev = Math.acos(THREE.MathUtils.lerp(1 - upBias * 2, 1, up));
        p.vx = Math.sin(elev) * Math.cos(theta) * spd;
        p.vy = Math.cos(elev) * spd + lift * Math.random();
        p.vz = Math.sin(elev) * Math.sin(theta) * spd;
      }
      p.size = size * (0.75 + Math.random() * 0.5);
      p.sizeEnd = sizeEnd;
      active.current.push(p);
    }
  };

  useEffect(() => {
    burst();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reburst on trigger / color mount
  }, [trigger, count, life, startDelay]);

  useFrame((_, dt) => {
    const pts = points.current;
    if (!pts) return;
    const safeDt = Math.min(0.05, dt);
    let living = 0;

    for (let i = 0; i < count; i++) {
      const p = active.current[i];
      if (!p || !p.alive) {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = -999;
        positions[i * 3 + 2] = 0;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      p.age += safeDt;
      if (p.age < p.delay) {
        positions[i * 3 + 1] = -999;
        sizes[i] = 0;
        alphas[i] = 0;
        living++;
        continue;
      }
      const lived = p.age - p.delay;
      if (lived >= p.life) {
        p.alive = false;
        positions[i * 3 + 1] = -999;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      const t = lived / p.life;
      p.x += p.vx * safeDt;
      p.y += p.vy * safeDt;
      p.z += p.vz * safeDt;
      p.vy -= gravity * safeDt;
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      const appear =
        fadeIn > 1e-4 ? THREE.MathUtils.smoothstep(t, 0, fadeIn) : 1;
      const fade = (1 - t) * (1 - t);
      const sz = THREE.MathUtils.lerp(p.size, p.sizeEnd, t);
      sizes[i] = sz * appear * 28;
      alphas[i] = appear * fade;
      living++;
    }

    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.aSize!.needsUpdate = true;
    geometry.attributes.aAlpha!.needsUpdate = true;
    pts.visible = living > 0;
  });

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      for (const p of active.current) pool.release(p);
      active.current = [];
    };
  }, [geometry, material, pool]);

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}
