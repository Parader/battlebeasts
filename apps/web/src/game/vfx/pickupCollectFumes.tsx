import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import type { Room } from "colyseus.js";
import * as THREE from "three";
import { softEnvelope } from "./easing";
import { createCirclePointMaterial } from "./materials/circlePoint";
import { registerSharedMaterial } from "./vfxDisposal";

const FUMES = 32;
const SLOTS = 4;
export const PICKUP_FUME_LIFE_MS = 1100;

export const PICKUP_FUME_COLOR: Record<string, string> = {
  heal: "#6EE7B7",
  energy: "#FACC15",
  absorb: "#60A5FA",
  speed: "#FB923C",
  power: "#F87171",
  haste: "#C084FC",
  generic: "#6EE7B7",
};

type Slot = {
  color: string;
  born: number;
  x: number;
  z: number;
  targetId?: string;
};

const emptySlot = (): Slot => ({
  color: PICKUP_FUME_COLOR.generic!,
  born: 0,
  x: 0,
  z: 0,
});

const slots: Slot[] = Array.from({ length: SLOTS }, emptySlot);
let localPlayedAt = 0;

const FUME_MAT = createCirclePointMaterial(PICKUP_FUME_COLOR.generic);
FUME_MAT.userData.shared = true;
registerSharedMaterial(FUME_MAT);

function setFumeColor(color: string) {
  const u = FUME_MAT.uniforms.uColor?.value as THREE.Color | undefined;
  u?.set(color);
}

/** Compile pickup fume program before first collect. */
export function warmPickupFumeMaterials(): THREE.ShaderMaterial[] {
  return [FUME_MAT];
}

export function pickupFumeColorForEffect(effect: string | undefined): string {
  return PICKUP_FUME_COLOR[effect ?? ""] ?? PICKUP_FUME_COLOR.generic!;
}

export function pickupFumeColorForAbility(abilityId: string): string {
  const effect = abilityId.startsWith("pickup_") ? abilityId.slice("pickup_".length) : "";
  return pickupFumeColorForEffect(effect);
}

export function spawnPickupCollectFumes(opts: {
  color: string;
  x: number;
  z: number;
  targetId?: string;
}): void {
  const now = performance.now();
  let idx = 0;
  let best = -1;
  for (let i = 0; i < SLOTS; i++) {
    const age = slots[i]!.born === 0 ? 1e9 : now - slots[i]!.born;
    if (age > best) {
      best = age;
      idx = i;
    }
  }
  const slot = slots[idx]!;
  slot.color = opts.color;
  slot.born = now;
  slot.x = opts.x;
  slot.z = opts.z;
  slot.targetId = opts.targetId;
}

export function markLocalPickupFumes(): void {
  localPlayedAt = performance.now();
}

export function didJustPlayLocalPickupFumes(withinMs = 240): boolean {
  return performance.now() - localPlayedAt < withinMs;
}

function writeFumes(
  pos: Float32Array,
  size: Float32Array,
  alpha: Float32Array,
  age: number,
) {
  const u = age / PICKUP_FUME_LIFE_MS;
  const fade = softEnvelope(u, 0.08, 0.7);
  for (let i = 0; i < FUMES; i++) {
    const pOffset = i / FUMES;
    const pProg = (age * 0.0011 + pOffset) % 1.0;
    const ang = pOffset * Math.PI * 2 + pProg * 4.5;
    const r = 0.28 + 0.12 * Math.sin(i * 3.7 + pProg * 3.0);
    pos[i * 3] = Math.cos(ang) * r;
    pos[i * 3 + 1] = 0.12 + pProg * 2.15;
    pos[i * 3 + 2] = Math.sin(ang) * r;
    const sz = Math.sin(pProg * Math.PI);
    size[i] = (1.4 + 0.8 * sz) * 1.6;
    alpha[i] = fade * sz * 0.95;
  }
}

function PickupFumeSlot({
  index,
  room,
  localSessionId,
  predictedRef,
}: {
  index: number;
  room: Room | null;
  localSessionId?: string | null;
  predictedRef?: MutableRefObject<{ x: number; z: number }>;
}) {
  const group = useRef<THREE.Group>(null);
  const pos = useMemo(() => new Float32Array(FUMES * 3), []);
  const size = useMemo(() => new Float32Array(FUMES), []);
  const alpha = useMemo(() => new Float32Array(FUMES), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
    return g;
  }, [pos, size, alpha]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const slot = slots[index]!;
    const age = slot.born === 0 ? PICKUP_FUME_LIFE_MS : performance.now() - slot.born;
    if (age >= PICKUP_FUME_LIFE_MS) {
      g.visible = false;
      return;
    }
    setFumeColor(slot.color);
    g.visible = true;

    let x = slot.x;
    let z = slot.z;
    if (slot.targetId && localSessionId && slot.targetId === localSessionId && predictedRef) {
      x = predictedRef.current.x;
      z = predictedRef.current.z;
    } else if (slot.targetId && room) {
      const p = room.state?.players?.get(slot.targetId) as { x?: number; z?: number } | undefined;
      if (p && typeof p.x === "number" && typeof p.z === "number") {
        x = p.x;
        z = p.z;
      }
    }
    g.position.set(x, 0, z);
    writeFumes(pos, size, alpha, age);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
  });

  return (
    <group ref={group} visible={false}>
      <points
        geometry={geo}
        material={FUME_MAT}
        frustumCulled={false}
        renderOrder={38}
      />
    </group>
  );
}

/** Always-mounted pool — collect never creates GPU objects. */
export function PickupCollectFumesLayer({
  room,
  localSessionId,
  predictedRef,
}: {
  room: Room | null;
  localSessionId?: string | null;
  predictedRef?: MutableRefObject<{ x: number; z: number }>;
}) {
  return (
    <>
      {slots.map((_, i) => (
        <PickupFumeSlot
          key={i}
          index={i}
          room={room}
          localSessionId={localSessionId}
          predictedRef={predictedRef}
        />
      ))}
    </>
  );
}
