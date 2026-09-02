import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { abilityVfxColor } from "../colors";
import { useSpellLight } from "../spellLights";

const TIP_Y = 1.12;
const SHOULDER_FORWARD = 0.28;
const SHOULDER_Y = 1.28;
/** Center-to-center spacing — small gaps between oval links. */
const LINK_SPACING = 0.15;
const MAX_LINKS = 64;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Discrete interlocking chain links from caster shoulder to hook tip.
 * Gaps between links so it reads as a chain, not a continuous tube.
 */
export function ChainJumpProjectileEffect({ room, id }: { room: Room; id: string }) {
  const root = useRef<THREE.Group>(null);
  const linksMesh = useRef<THREE.InstancedMesh>(null);
  const tipGroup = useRef<THREE.Group>(null);
  const light = useSpellLight();
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);

  const colorHex = useRef(abilityVfxColor("chainJump"));
  const tipPos = useRef(new THREE.Vector3());
  const originPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const align = useMemo(() => new THREE.Quaternion(), []);
  const spin = useMemo(() => new THREE.Quaternion(), []);

  const linkGeo = useMemo(() => new THREE.TorusGeometry(0.042, 0.014, 5, 12), []);
  const linkMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#6e6e76",
        metalness: 0.72,
        roughness: 0.38,
        emissive: "#2a2a30",
        emissiveIntensity: 0.15,
      }),
    [],
  );

  const tipCoreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#9a9aa3",
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const tipGlowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: colorHex.current,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      linkGeo.dispose();
      linkMat.dispose();
      tipCoreMat.dispose();
      tipGlowMat.dispose();
    };
  }, [linkGeo, linkMat, tipCoreMat, tipGlowMat]);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | {
          x: number;
          z: number;
          vx?: number;
          vz?: number;
          abilityId?: string;
          ownerSessionId?: string;
        }
      | undefined;
    const g = root.current;
    const mesh = linksMesh.current;
    if (!p || !g || !mesh) {
      if (g) g.visible = false;
      seeded.current = false;
      light.off();
      return;
    }
    g.visible = true;

    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;
    const safeDt = Math.min(0.05, Math.max(0, dt));

    if (!seeded.current) {
      tipPos.current.set(p.x, TIP_Y, p.z);
      lastServer.current = { x: p.x, z: p.z, vx, vz };
      seeded.current = true;
    } else {
      tipPos.current.x += vx * safeDt;
      tipPos.current.z += vz * safeDt;

      const serverMoved =
        p.x !== lastServer.current.x ||
        p.z !== lastServer.current.z ||
        vx !== lastServer.current.vx ||
        vz !== lastServer.current.vz;

      if (serverMoved) {
        lastServer.current = { x: p.x, z: p.z, vx, vz };
        const err = Math.hypot(tipPos.current.x - p.x, tipPos.current.z - p.z);
        if (err > 1.25) {
          tipPos.current.x = p.x;
          tipPos.current.z = p.z;
        } else {
          const blend = 1 - Math.exp(-14 * safeDt);
          tipPos.current.x = THREE.MathUtils.lerp(tipPos.current.x, p.x, blend);
          tipPos.current.z = THREE.MathUtils.lerp(tipPos.current.z, p.z, blend);
        }
      }
    }

    const ownerId = p.ownerSessionId;
    const owner = ownerId
      ? (room.state?.players?.get(ownerId) as { x?: number; z?: number; yaw?: number } | undefined)
      : undefined;
    if (owner && owner.x != null && owner.z != null) {
      const yaw = owner.yaw ?? 0;
      originPos.current.set(
        owner.x + Math.sin(yaw) * SHOULDER_FORWARD,
        SHOULDER_Y,
        owner.z + Math.cos(yaw) * SHOULDER_FORWARD,
      );
    } else {
      const spd = Math.hypot(vx, vz) || 1;
      originPos.current.set(
        tipPos.current.x - (vx / spd) * 1.4,
        SHOULDER_Y,
        tipPos.current.z - (vz / spd) * 1.4,
      );
    }

    dir.subVectors(tipPos.current, originPos.current);
    const len = Math.max(0.15, dir.length());
    dir.normalize();

    // Place oval links along the path; leave a little room for the tip hook.
    const usable = Math.max(0.1, len - 0.12);
    let count = 0;
    for (let i = 0; i < MAX_LINKS; i++) {
      const u = LINK_SPACING * 0.45 + i * LINK_SPACING;
      if (u > usable) break;

      dummy.position.copy(originPos.current).addScaledVector(dir, u);
      // Torus long-axis = local Y → align along chain, alternate 90° for interlocking.
      align.setFromUnitVectors(Y_AXIS, dir);
      if (i % 2 === 1) {
        spin.setFromAxisAngle(Y_AXIS, Math.PI / 2);
        align.multiply(spin);
      }
      dummy.quaternion.copy(align);
      // Slightly oval so links read like the reference chain
      dummy.scale.set(0.82, 1.35, 0.82);
      dummy.updateMatrix();
      mesh.setMatrixAt(count, dummy.matrix);
      count += 1;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;

    if (tipGroup.current) tipGroup.current.position.copy(tipPos.current);

    const nextColor = abilityVfxColor(p.abilityId ?? "chainJump");
    if (nextColor !== colorHex.current) {
      colorHex.current = nextColor;
      tipGlowMat.color.set(nextColor);
    }

    const pulse = 1 + Math.sin(performance.now() * 0.02) * 0.1;
    if (core.current) core.current.scale.setScalar(0.55 * pulse);
    if (glow.current) glow.current.scale.setScalar(1.05 * pulse);
    light.emitAt(tipGroup.current, "#a8a8b0", 0.55, 2.6);
  });

  return (
    <group ref={root}>
      <instancedMesh ref={linksMesh} args={[linkGeo, linkMat, MAX_LINKS]} frustumCulled={false} />

      <group ref={tipGroup}>
        <mesh ref={core} material={tipCoreMat} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.09, 0.035, 8, 14]} />
        </mesh>
        <mesh ref={glow} material={tipGlowMat} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.09, 0.035, 6, 12]} />
        </mesh>
      </group>
    </group>
  );
}
