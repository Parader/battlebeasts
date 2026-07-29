import * as THREE from "three";

/**
 * Find a bone / Object3D by name (case-insensitive, partial match optional).
 */
export function findBone(
  root: THREE.Object3D,
  name: string,
  opts?: { partial?: boolean },
): THREE.Object3D | null {
  const key = name.toLowerCase();
  let found: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (found) return;
    const n = obj.name.toLowerCase();
    if (opts?.partial ? n.includes(key) : n === key) found = obj;
  });
  return found;
}

/**
 * Resolve a Mixamo hand bone without matching finger children
 * (`RightHandThumb1` etc. also contain "RightHand").
 */
export function findHandBone(
  root: THREE.Object3D,
  side: "left" | "right" = "right",
): THREE.Object3D | null {
  const want = side === "left" ? "lefthand" : "righthand";
  let exact: THREE.Object3D | null = null;
  let endsWith: THREE.Object3D | null = null;
  root.traverse((obj) => {
    const n = obj.name.toLowerCase().replace(/^mixamorig:/, "");
    if (n === want) exact = obj;
    else if (!endsWith && (n.endsWith(want) || n === `hand_${side[0]}`)) endsWith = obj;
  });
  return exact ?? endsWith;
}

export type AttachHandle = {
  /** Detach and stop following. */
  release: () => void;
};

/**
 * Parent `fx` under `target` (bone or prop). Optional local offset.
 * Returns a handle to restore previous parent.
 */
export function attachToObject(
  fx: THREE.Object3D,
  target: THREE.Object3D,
  offset?: { x?: number; y?: number; z?: number },
): AttachHandle {
  const prevParent = fx.parent;
  target.add(fx);
  fx.position.set(offset?.x ?? 0, offset?.y ?? 0, offset?.z ?? 0);
  fx.rotation.set(0, 0, 0);
  fx.scale.set(1, 1, 1);

  return {
    release: () => {
      if (fx.parent === target) {
        target.remove(fx);
        prevParent?.add(fx);
      }
    },
  };
}

/** Convenience: resolve bone by name then attach. */
export function attachToBone(
  fx: THREE.Object3D,
  characterRoot: THREE.Object3D,
  boneName: string,
  offset?: { x?: number; y?: number; z?: number },
): AttachHandle | null {
  const bone = findBone(characterRoot, boneName, { partial: true });
  if (!bone) return null;
  return attachToObject(fx, bone, offset);
}

/**
 * Copy world transform of `source` onto `fx` each call (manual follow without reparenting).
 * Useful when the effect must stay in the VFX world layer.
 */
export function followObjectWorld(
  fx: THREE.Object3D,
  source: THREE.Object3D,
  scratch: THREE.Vector3 = new THREE.Vector3(),
): void {
  source.getWorldPosition(scratch);
  fx.position.copy(scratch);
}
