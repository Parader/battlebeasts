import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { createSmokePointMaterial } from "./materials/circlePoint";
import { getSmokeTexture } from "./smokeTexture";

const ORB = "#a16207";
const ORB_HOT = "#fde68a";
const TRAIL = 6;

type ProjLite = {
  x?: number;
  z?: number;
  spellbreakerOrbs?: number;
  mode?: string;
};

/** Yellow orbs that ride a Spellbreaker-empowered projectile to impact. */
function SpellbreakerRideOrbs({ room, id }: { room: Room; id: string }) {
  const root = useRef<THREE.Group>(null);
  const orbRefs = useRef<(THREE.Mesh | null)[]>([]);
  const orbMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: ORB,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const trailPos = useMemo(() => new Float32Array(TRAIL * 3), []);
  const trailSize = useMemo(() => new Float32Array(TRAIL), []);
  const trailAlpha = useMemo(() => new Float32Array(TRAIL), []);
  const trailGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(trailSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(trailAlpha, 1));
    return g;
  }, [trailPos, trailSize, trailAlpha]);
  const trailMat = useMemo(() => {
    const mat = createSmokePointMaterial(ORB_HOT);
    if (mat.uniforms.uMap) mat.uniforms.uMap.value = getSmokeTexture();
    return mat;
  }, []);

  useEffect(() => {
    return () => {
      orbMat.dispose();
      trailGeo.dispose();
      trailMat.dispose();
    };
  }, [orbMat, trailGeo, trailMat]);

  const prev = useRef({ x: 0, z: 0, seeded: false });

  useFrame(({ clock }) => {
    const p = room.state?.projectiles?.get(id) as ProjLite | undefined;
    const g = root.current;
    if (!p || !g || (p.spellbreakerOrbs ?? 0) <= 0) {
      if (g) g.visible = false;
      return;
    }
    const count = Math.min(3, Math.max(1, Math.floor(p.spellbreakerOrbs ?? 1)));
    const x = p.x ?? 0;
    const z = p.z ?? 0;
    g.visible = true;
    g.position.set(x, 0, z);

    const t = clock.elapsedTime;
    for (let i = 0; i < 3; i++) {
      const mesh = orbRefs.current[i];
      if (!mesh) continue;
      if (i >= count) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      const ang = t * 2.4 + (i / count) * Math.PI * 2;
      const r = 0.28 + count * 0.04;
      mesh.position.set(Math.cos(ang) * r, 0.85 + Math.sin(t * 3 + i) * 0.08, Math.sin(ang) * r);
      mesh.scale.setScalar(0.1 + 0.015 * count);
    }

    if (!prev.current.seeded) {
      prev.current = { x, z, seeded: true };
    }
    const dx = x - prev.current.x;
    const dz = z - prev.current.z;
    prev.current.x = x;
    prev.current.z = z;
    for (let i = 0; i < TRAIL; i++) {
      const u = i / (TRAIL - 1);
      trailPos[i * 3] = -dx * u * 4;
      trailPos[i * 3 + 1] = 0.85 - u * 0.05;
      trailPos[i * 3 + 2] = -dz * u * 4;
      trailSize[i] = (0.09 - u * 0.04) * 34;
      trailAlpha[i] = (1 - u) * 0.55;
    }
    trailGeo.attributes.position!.needsUpdate = true;
    trailGeo.attributes.aSize!.needsUpdate = true;
    trailGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={root} visible={false}>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            orbRefs.current[i] = el;
          }}
          renderOrder={26}
        >
          <sphereGeometry args={[1, 10, 8]} />
          <primitive object={orbMat} attach="material" />
        </mesh>
      ))}
      <points geometry={trailGeo} frustumCulled={false} renderOrder={25}>
        <primitive object={trailMat} attach="material" />
      </points>
    </group>
  );
}

/** Overlay companions for any projectile carrying Spellbreaker orbs. */
export function SpellbreakerProjectileOrbs({ room }: { room: Room | null }) {
  const [ids, setIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room?.state?.projectiles) return;
    const next: string[] = [];
    room.state.projectiles.forEach((p: ProjLite, id: string) => {
      if ((p.spellbreakerOrbs ?? 0) > 0) next.push(id);
    });
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
        <SpellbreakerRideOrbs key={id} room={room} id={id} />
      ))}
    </>
  );
}
