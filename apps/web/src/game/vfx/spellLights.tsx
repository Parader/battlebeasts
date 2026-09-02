/**
 * A fixed pool of point lights for spell VFX.
 *
 * Mounting a light is the single most expensive thing a spell can do. Three
 * bakes the scene's light counts into every shader's cache key, so a
 * `<pointLight>` appearing or disappearing invalidates the program for every
 * lit material in the scene -- character, props, ground -- and they all relink
 * on the spot. Measured at ~175 ms on first cast, which reads as a hard hitch.
 *
 * So the lights are created once and never leave. Effects borrow a slot, drive
 * its position, colour and intensity, and hand it back at zero intensity. The
 * light count is constant from the first frame to the last, so the shader
 * cache is never invalidated.
 *
 * The trade is deliberate: every lit material now always evaluates
 * `POOL_SIZE` point lights, even when nothing is cast. That is a small,
 * *constant* GPU cost in place of a large, unpredictable CPU stall, and steady
 * frame time is worth more than a slightly higher floor.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";

/**
 * Concurrent spell lights. Every extra slot is per-fragment cost on every lit
 * surface for the whole session, so this is kept to what a busy fight actually
 * needs rather than a comfortable over-allocation.
 */
const POOL_SIZE = 4;

type Slot = { light: THREE.PointLight; taken: boolean };

let pool: Slot[] | null = null;

function ensurePool(): Slot[] {
  if (pool) return pool;
  pool = Array.from({ length: POOL_SIZE }, () => {
    const light = new THREE.PointLight("#ffffff", 0, 4, 2);
    // Parked far below the map: an idle slot must not light anything, and
    // intensity 0 alone still leaves it in range calculations.
    light.position.set(0, -1000, 0);
    light.castShadow = false;
    return { light, taken: false };
  });
  return pool;
}

/**
 * Mount once, high enough in the tree to outlive scene transitions.
 *
 * Must be mounted *before* the shader warmup runs, so materials compile
 * against the same light count they will see in play.
 */
export function SpellLightPool() {
  const slots = useMemo(() => ensurePool(), []);
  return (
    <>
      {slots.map((s, i) => (
        <primitive key={i} object={s.light} />
      ))}
    </>
  );
}

export type SpellLight = {
  /** Place and light up, in world space. */
  emit(
    x: number,
    y: number,
    z: number,
    color: THREE.ColorRepresentation,
    intensity: number,
    distance: number,
  ): void;
  /**
   * Same, taking the world position of an object -- for effects whose light
   * used to sit nested inside a moving, scaled group.
   */
  emitAt(
    obj: THREE.Object3D | null,
    color: THREE.ColorRepresentation,
    intensity: number,
    distance: number,
  ): void;
  /** Go dark and hand the slot back for someone else to use. */
  off(): void;
};

const scratch = new THREE.Vector3();

/**
 * Borrow a pool slot for the lifetime of the calling component.
 *
 * Returns a no-op handle when the pool is exhausted, so a burst of simul-
 * taneous casts loses a light rather than throwing. Losing the dimmest light
 * in a crowded fight is not something a player can notice.
 */
export function useSpellLight(): SpellLight {
  const handle = useMemo(() => {
    // The api closes over this object, so release() below must mutate this
    // exact reference -- copying it would leave every call looking at null.
    const state: { slot: Slot | null } = { slot: null };

    /*
     * Slots are taken on first emit and given back on off(), rather than held
     * for the component's whole lifetime.
     *
     * This matters because some owners are long-lived but rarely lit --
     * HandShieldFx mounts for every player and glows only while shielded. On
     * lifetime ownership three players would hold six slots permanently and
     * starve every spell in the match.
     *
     * Churning ownership is free: it is a boolean on a plain object, and the
     * lights themselves never enter or leave the scene, so the shader cache is
     * untouched either way.
     */
    const acquire = (): Slot | null => {
      if (state.slot) return state.slot;
      const slot = ensurePool().find((s) => !s.taken) ?? null;
      if (slot) {
        slot.taken = true;
        state.slot = slot;
      }
      return slot;
    };

    const release = () => {
      const s = state.slot;
      if (!s) return;
      s.light.intensity = 0;
      s.light.position.set(0, -1000, 0);
      s.taken = false;
      state.slot = null;
    };

    const api: SpellLight = {
      emit(x, y, z, color, intensity, distance) {
        const s = acquire();
        if (!s) return;
        s.light.position.set(x, y, z);
        s.light.color.set(color);
        s.light.intensity = intensity;
        s.light.distance = distance;
      },
      emitAt(obj, color, intensity, distance) {
        if (!obj) return;
        const s = acquire();
        if (!s) return;
        obj.getWorldPosition(scratch);
        s.light.position.copy(scratch);
        s.light.color.set(color);
        s.light.intensity = intensity;
        s.light.distance = distance;
      },
      off: release,
    };

    return { release, api };
  }, []);

  // Hand the slot back if the owner unmounts mid-effect without calling off().
  useEffect(() => handle.release, [handle]);

  return handle.api;
}
