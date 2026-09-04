import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { CRUSHING_SIGIL_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope, smooth01 } from "../easing";
import { getCrushingSigilFlareTexture } from "../crushingSigilFlareTexture";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";

const CORE = new THREE.Color("#160D22");
const MAIN = new THREE.Color("#7834B8");
const BRIGHT = new THREE.Color("#C176FF");
const FLASH = new THREE.Color("#F4E9FF");

const DELAY = CRUSHING_SIGIL_CAST.delayedImpactMs;
const SEGMENT_COUNT = 4;
const SHARD_COUNT = 12;

type Shard = {
  angle: number;
  speed: number;
  lift: number;
  spin: number;
  len: number;
};

/**
 * Crushing Sigil — geometric arcane rune: place → compress → soft flare burst.
 * Timeline stays in sync with server `delayedImpactMs`.
 */
export function CrushingSigilEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const column = useRef<THREE.Mesh>(null);
  const shock = useRef<THREE.Mesh>(null);
  const segments = useRef<(THREE.Mesh | null)[]>([]);
  const shards = useRef<(THREE.Mesh | null)[]>([]);
  const motes = useRef<(THREE.Mesh | null)[]>([]);

  const radius = Math.max(0.6, shot.radius ?? CRUSHING_SIGIL_CAST.radius);

  const mats = useMemo(() => {
    const mk = (color: THREE.Color, opacity = 0) =>
      new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
    return {
      outer: mk(MAIN),
      inner: mk(BRIGHT),
      core: mk(CORE),
      segment: mk(MAIN),
      column: mk(BRIGHT),
      shock: mk(FLASH),
      shard: mk(BRIGHT),
      mote: mk(MAIN),
    };
  }, []);

  const shardDefs = useMemo<Shard[]>(() => {
    const out: Shard[] = [];
    for (let i = 0; i < SHARD_COUNT; i++) {
      const t = i / SHARD_COUNT;
      out.push({
        angle: t * Math.PI * 2 + (i % 3) * 0.17,
        speed: 2.4 + (i % 5) * 0.35,
        lift: 0.12 + (i % 4) * 0.05,
        spin: 2.2 + (i % 3) * 1.1,
        len: 0.18 + (i % 4) * 0.04,
      });
    }
    return out;
  }, []);

  const flareMap = useMemo(() => getCrushingSigilFlareTexture(), []);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = Math.max(DELAY + 280, shot.life ?? CRUSHING_SIGIL_CAST.vfxLifeMs);
    if (ms >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const place = smooth01(ms / 150);
    const chargeT = ms < 150 ? 0 : smooth01((ms - 150) / Math.max(1, DELAY - 250));
    const warnStart = DELAY - 100;
    const warn =
      ms < warnStart ? 0 : smooth01((ms - warnStart) / 100);
    const detMs = ms - DELAY;
    const detonating = detMs >= 0;
    const coreFlash =
      detonating && detMs < 70 ? softEnvelope(detMs / 70, 0.12, 0.4) : 0;
    const shockT =
      detonating && detMs >= 20 && detMs < 220
        ? smooth01((detMs - 20) / 180)
        : detonating && detMs >= 220
          ? 1
          : 0;
    const shockFade =
      detonating && detMs >= 20
        ? softEnvelope(Math.min(1, (detMs - 20) / 180), 0.1, 0.42)
        : 0;
    const shardT =
      detonating && detMs >= 40 ? Math.min(1, (detMs - 40) / 180) : 0;
    const burstPop =
      detonating && detMs < 90 ? softEnvelope(detMs / 90, 0.1, 0.35) : 0;

    const compress = chargeT * 0.22 + warn * 0.35;
    const sigilScale = detonating
      ? THREE.MathUtils.lerp(1 - compress, 0.28, Math.min(1, detMs / 30))
      : 1 - compress;

    if (outer.current) {
      outer.current.scale.setScalar(sigilScale);
      outer.current.rotation.z = ms * 0.0018 * (1 + chargeT * 1.4 + warn * 2);
      mats.outer.opacity =
        (0.22 + chargeT * 0.12 + warn * 0.18 + burstPop * 0.35) *
        place *
        (detonating ? 1 - Math.min(1, detMs / 110) : 1);
      mats.outer.color.copy(MAIN).lerp(FLASH, warn * 0.35 + burstPop * 0.55);
    }

    if (inner.current) {
      inner.current.scale.setScalar(sigilScale * (0.55 - chargeT * 0.08));
      inner.current.rotation.z = -ms * 0.0024 * (1 + chargeT + warn * 1.5);
      mats.inner.opacity =
        (0.28 + chargeT * 0.1 + warn * 0.25 + burstPop * 0.4) *
        place *
        (detonating ? 1 - Math.min(1, detMs / 95) : 1);
    }

    if (core.current) {
      const coreScale =
        (0.12 + chargeT * 0.04 + warn * 0.06 + coreFlash * 0.38) * place;
      core.current.scale.setScalar(coreScale);
      mats.core.color.copy(CORE).lerp(FLASH, coreFlash);
      mats.core.opacity =
        (0.55 + warn * 0.2 + coreFlash * 0.45) *
        place *
        (detonating ? Math.max(coreFlash, 1 - Math.min(1, detMs / 100)) : 1);
    }

    if (column.current) {
      const show = warn > 0.05 && (!detonating || detMs < 45);
      column.current.visible = show;
      if (show) {
        column.current.scale.set(0.04 + warn * 0.03, 0.35 + warn * 0.55, 0.04 + warn * 0.03);
        mats.column.opacity = 0.4 * warn * (detonating ? 1 - detMs / 45 : 1);
      }
    }

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const mesh = segments.current[i];
      if (!mesh) continue;
      const baseAng = (i / SEGMENT_COUNT) * Math.PI * 2;
      const pull = 0.55 - chargeT * 0.18 - warn * 0.22;
      const r = radius * pull * sigilScale;
      mesh.position.set(Math.cos(baseAng) * r, 0.01, Math.sin(baseAng) * r);
      mesh.rotation.y = -baseAng;
      mesh.scale.set(
        place * (0.7 + warn * 0.2),
        1,
        place * (0.35 + chargeT * 0.1),
      );
      mats.segment.opacity =
        (0.3 + chargeT * 0.15 + warn * 0.2 + burstPop * 0.35) *
        place *
        (detonating ? 1 - Math.min(1, detMs / 70) : 1);
    }

    for (let i = 0; i < 6; i++) {
      const mesh = motes.current[i];
      if (!mesh) continue;
      if (detonating) {
        mesh.visible = false;
        continue;
      }
      const orbit = ((ms * 0.0012 + i * 0.9) % 1);
      const pullIn = 0.85 - chargeT * 0.55 - warn * 0.2;
      const r = radius * THREE.MathUtils.lerp(pullIn, 0.12, orbit * chargeT);
      const ang = (i / 6) * Math.PI * 2 + ms * 0.002;
      mesh.visible = place > 0.2;
      mesh.position.set(Math.cos(ang) * r, 0.04 + orbit * 0.08, Math.sin(ang) * r);
      mats.mote.opacity = (0.15 + chargeT * 0.25) * place;
    }

    if (shock.current) {
      const show = shockFade > 0.01;
      shock.current.visible = show;
      if (show) {
        const r = THREE.MathUtils.lerp(0.12, radius * 1.05, shockT);
        shock.current.scale.set(r, 1, r);
        mats.shock.opacity = 0.85 * shockFade;
      }
    }

    for (let i = 0; i < SHARD_COUNT; i++) {
      const mesh = shards.current[i];
      const def = shardDefs[i]!;
      if (!mesh) continue;
      if (shardT <= 0) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      const ease = smooth01(shardT);
      const dist = def.speed * ease * radius * 0.95;
      mesh.position.set(
        Math.cos(def.angle) * dist,
        def.lift * ease * 1.35,
        Math.sin(def.angle) * dist,
      );
      mesh.rotation.set(ease * def.spin, def.angle, ease * def.spin * 0.6);
      mesh.scale.set(def.len * 1.25 * (1 - ease * 0.35), 0.04, 0.08);
      mats.shard.opacity = 0.78 * (1 - smooth01((shardT - 0.25) / 0.75));
    }
  });

  return (
    <group ref={root} position={[shot.x, 0.03, shot.z]} visible={false}>
      <mesh ref={outer} rotation={[-Math.PI / 2, 0, 0]} material={mats.outer}>
        <ringGeometry args={[radius * 0.92, radius, 48]} />
      </mesh>
      <mesh ref={inner} rotation={[-Math.PI / 2, 0, 0]} material={mats.inner}>
        <ringGeometry args={[radius * 0.28, radius * 0.48, 6]} />
      </mesh>
      <mesh ref={core} rotation={[-Math.PI / 2, 0, 0]} material={mats.core}>
        <circleGeometry args={[1, 16]} />
      </mesh>
      <mesh ref={column} position={[0, 0.2, 0]} material={mats.column} visible={false}>
        <cylinderGeometry args={[1, 1, 1, 6]} />
      </mesh>
      <mesh ref={shock} rotation={[-Math.PI / 2, 0, 0]} material={mats.shock} visible={false}>
        <ringGeometry args={[0.9, 1.04, 48]} />
      </mesh>

      {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
        <mesh
          key={`seg-${i}`}
          ref={(el) => {
            segments.current[i] = el;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          material={mats.segment}
        >
          <planeGeometry args={[0.35, 0.12]} />
        </mesh>
      ))}

      {Array.from({ length: 6 }, (_, i) => (
        <mesh
          key={`mote-${i}`}
          ref={(el) => {
            motes.current[i] = el;
          }}
          material={mats.mote}
        >
          <sphereGeometry args={[0.04, 6, 6]} />
        </mesh>
      ))}

      {shardDefs.map((_, i) => (
        <mesh
          key={`shard-${i}`}
          ref={(el) => {
            shards.current[i] = el;
          }}
          material={mats.shard}
          visible={false}
        >
          <boxGeometry args={[1, 1, 1]} />
        </mesh>
      ))}

      <AdditiveParticleBurst
        color="#E8C4FF"
        count={26}
        life={0.4}
        speed={4.2}
        speedSpread={2.4}
        size={0.32}
        sizeEnd={0.05}
        lift={2.6}
        upBias={0.58}
        gravity={7}
        fadeIn={0.08}
        stagger={0.18}
        startDelay={DELAY / 1000}
        origin={[0, 0.18, 0]}
        trigger={shot.key}
        map={flareMap}
      />
    </group>
  );
}
