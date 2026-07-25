import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { abilityVfxColor } from "../colors";

const TIP_Y = 1.12;
const SHOULDER_FORWARD = 0.28;
const SHOULDER_Y = 1.28;
const SMOKE_COUNT = 14;

type SmokeBead = { x: number; y: number; z: number; age: number; life: number };

/**
 * Dark stretching arm with a clear glowing tip + smoke bead trail.
 * Uses the same MeshBasicMaterial path as Bolt (reliable additive draw).
 */
export function GraspProjectileEffect({ room, id }: { room: Room; id: string }) {
  const root = useRef<THREE.Group>(null);
  const limb = useRef<THREE.Mesh>(null);
  const tipGroup = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const smokeMeshes = useRef<(THREE.Mesh | null)[]>([]);

  const colorHex = useRef(abilityVfxColor("grasp"));
  const tipPos = useRef(new THREE.Vector3());
  const originPos = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const mid = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const smoke = useRef<SmokeBead[]>([]);
  const distAcc = useRef(0);
  const prevTip = useRef(new THREE.Vector3());

  const limbMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#1a0f24",
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.NormalBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const tipCoreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#120a1a",
        transparent: true,
        opacity: 0.72,
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
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const smokeMats = useMemo(
    () =>
      Array.from(
        { length: SMOKE_COUNT },
        () =>
          new THREE.MeshBasicMaterial({
            color: "#1a1024",
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
            toneMapped: false,
          }),
      ),
    [],
  );

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
    if (!p || !g) {
      if (g) g.visible = false;
      seeded.current = false;
      smoke.current = [];
      return;
    }
    g.visible = true;

    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;
    const safeDt = Math.min(0.05, Math.max(0, dt));

    if (!seeded.current) {
      tipPos.current.set(p.x, TIP_Y, p.z);
      prevTip.current.copy(tipPos.current);
      lastServer.current = { x: p.x, z: p.z, vx, vz };
      seeded.current = true;
      distAcc.current = 0;
      smoke.current = [];
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
    const len = Math.max(0.2, dir.length());
    dir.normalize();
    mid.copy(originPos.current).addScaledVector(dir, len * 0.5);
    quat.setFromUnitVectors(up, dir);

    if (limb.current) {
      limb.current.position.copy(mid);
      limb.current.quaternion.copy(quat);
      const thick = 0.22 + Math.min(0.1, len * 0.008);
      limb.current.scale.set(thick, len, thick);
    }

    if (tipGroup.current) {
      tipGroup.current.position.copy(tipPos.current);
    }

    // Drop smoke beads along tip travel (bolt-style trail)
    const traveled = tipPos.current.distanceTo(prevTip.current);
    distAcc.current += traveled;
    prevTip.current.copy(tipPos.current);
    while (distAcc.current >= 0.22) {
      distAcc.current -= 0.22;
      smoke.current.unshift({
        x: tipPos.current.x + (Math.random() - 0.5) * 0.15,
        y: tipPos.current.y + (Math.random() - 0.5) * 0.12,
        z: tipPos.current.z + (Math.random() - 0.5) * 0.15,
        age: 0,
        life: 0.35 + Math.random() * 0.2,
      });
      if (smoke.current.length > SMOKE_COUNT) smoke.current.length = SMOKE_COUNT;
    }

    for (const bead of smoke.current) bead.age += safeDt;
    smoke.current = smoke.current.filter((b) => b.age < b.life);

    const nextColor = abilityVfxColor(p.abilityId ?? "grasp");
    if (nextColor !== colorHex.current) {
      colorHex.current = nextColor;
      tipGlowMat.color.set(nextColor);
    }

    // Pulse tip so it reads while flying
    const pulse = 1 + Math.sin(performance.now() * 0.02) * 0.12;
    if (core.current) core.current.scale.setScalar(1.15 * pulse);
    if (glow.current) glow.current.scale.setScalar(2.1 * pulse);

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const mesh = smokeMeshes.current[i];
      const mat = smokeMats[i];
      const bead = smoke.current[i];
      if (!mesh || !mat) continue;
      if (!bead) {
        mesh.visible = false;
        continue;
      }
      const t = bead.age / bead.life;
      mesh.visible = true;
      mesh.position.set(bead.x, bead.y, bead.z);
      mesh.scale.setScalar(0.55 + t * 1.4);
      mat.opacity = (1 - t) * 0.45;
    }
  });

  return (
    <group ref={root}>
      <mesh ref={limb} material={limbMat}>
        <cylinderGeometry args={[1, 0.65, 1, 12]} />
      </mesh>

      <group ref={tipGroup}>
        <mesh ref={core} material={tipCoreMat}>
          <icosahedronGeometry args={[0.28, 1]} />
        </mesh>
        <mesh ref={glow} material={tipGlowMat}>
          <icosahedronGeometry args={[0.28, 0]} />
        </mesh>
        <pointLight color="#5b3a78" intensity={1.1} distance={4} decay={2} />
      </group>

      {smokeMats.map((mat, i) => (
        <mesh
          key={i}
          ref={(el) => {
            smokeMeshes.current[i] = el;
          }}
          visible={false}
        >
          <sphereGeometry args={[0.16, 8, 8]} />
          <primitive object={mat} attach="material" />
        </mesh>
      ))}
    </group>
  );
}
