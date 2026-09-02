import type { MapColliderSpec } from "@battlebeasts/shared";
import type { PropEntry } from "./manifest";

/**
 * Collision choices that carry from one placement to the next.
 *
 * Only the decisions worth repeating, never the measurements: laying out a row
 * of roof pieces means making the same "these do not collide" call over and
 * over, but a radius copied from the previous prop would be meaningless on
 * this one. Sizes always come from the new model's own fitted default.
 */
export type StickyCollider = {
  mode: MapColliderSpec["mode"];
  blocksProjectiles: boolean;
};

export function stickyOf(spec: MapColliderSpec): StickyCollider {
  return {
    mode: spec.mode,
    blocksProjectiles: spec.mode === "none" ? true : spec.blocksProjectiles !== false,
  };
}

/**
 * Where the model's base slice sits relative to its centre.
 *
 * Centre-relative because that is what a placement's position means: the
 * renderer subtracts the pivot, so `x`/`z` is the middle of the visible model.
 * Measuring from the origin instead would put the collider wherever the artist
 * happened to leave the pivot.
 */
function baseFromCentre(b?: PropEntry["bounds"] | null) {
  return {
    x: (b?.baseCx ?? 0) - (b?.centreX ?? 0),
    z: (b?.baseCz ?? 0) - (b?.centreZ ?? 0),
  };
}

/**
 * Offset and projectile flag survive a mode change; extents do not.
 *
 * A spec that had no collider carries no offset either, so the model's own
 * base-slice position stands in. Without it, switching a scenery prop on would
 * put its collider at the centre -- fine for a tree, wrong for anything whose
 * mass sits to one side.
 */
function carried(spec: MapColliderSpec, entry?: Pick<PropEntry, "bounds"> | null) {
  const fallback = baseFromCentre(entry?.bounds);
  const offsetX = spec.mode === "none" ? fallback.x : (spec.offsetX ?? fallback.x);
  const offsetZ = spec.mode === "none" ? fallback.z : (spec.offsetZ ?? fallback.z);
  return {
    ...(offsetX ? { offsetX } : {}),
    ...(offsetZ ? { offsetZ } : {}),
    ...(spec.mode !== "none" && spec.blocksProjectiles === false
      ? { blocksProjectiles: false as const }
      : {}),
  };
}

/**
 * Re-shape a collider, keeping everything that is not about shape.
 *
 * The offset in particular has to survive: it is what holds the collider on a
 * model that is not built around its own pivot, so dropping it on a mode
 * switch would silently fling the collider back to the origin.
 */
export function colliderWithMode(
  current: MapColliderSpec,
  mode: MapColliderSpec["mode"],
  entry?: Pick<PropEntry, "bounds"> | null,
): MapColliderSpec {
  if (mode === "none") return { mode: "none" };

  const keep = carried(current, entry);
  const b = entry?.bounds;

  if (mode === "circle") {
    // Seeded from the fitted default so turning collision back on does not
    // start from a meaningless 0.5 m guess.
    const radius =
      current.mode === "box"
        ? (current.halfX + current.halfZ) / 2
        : current.mode === "circle"
          ? current.radius
          : ((b?.baseHx ?? 0.5) + (b?.baseHz ?? 0.5)) / 2;
    return { mode: "circle", radius: Math.max(0.05, radius), ...keep };
  }

  const halfX = current.mode === "circle" ? current.radius : (b?.baseHx ?? 0.5);
  const halfZ = current.mode === "circle" ? current.radius : (b?.baseHz ?? 0.5);
  return {
    mode: "box",
    halfX: Math.max(0.05, halfX),
    halfZ: Math.max(0.05, halfZ),
    yaw: current.mode === "box" ? (current.yaw ?? 0) : 0,
    ...keep,
  };
}

/**
 * The collider a fresh placement of this model should get.
 *
 * Three sources, most specific first:
 *
 *   1. a correction saved for this exact model, which is a standing statement
 *      that its fitted collider is wrong
 *   2. the last collision choice made, for laying out a run of props
 *   3. the model's own fitted default
 *
 * A per-model correction outranks the sticky choice because it is about *this
 * model*, while sticky is a mode you are working in. Setting a correction also
 * sets sticky, so the two only ever disagree once you have moved on to a
 * different model and then come back.
 */
export function colliderForPlacement(
  entry: PropEntry,
  sticky: StickyCollider | null,
  override?: MapColliderSpec,
): MapColliderSpec {
  if (override) return structuredClone(override);

  const fitted = entry.defaultCollider as MapColliderSpec;
  if (!sticky) return fitted;

  const shaped = colliderWithMode(fitted, sticky.mode, entry);
  if (shaped.mode === "none") return shaped;
  return sticky.blocksProjectiles
    ? { ...shaped, blocksProjectiles: undefined }
    : { ...shaped, blocksProjectiles: false };
}
