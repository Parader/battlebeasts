import * as THREE from "three";
import { getCharacterRoot } from "../characterRoots";
import { findMixamoBone } from "./attach";
import type { VfxFollowContext } from "./catalog";

/**
 * Body-resolution helpers shared by beams, cones and channels.
 *
 * `coneRayMaxLength` already tells an effect *how far* its ray travels, but an impact
 * that reads has to land inside the thing it hit, not at the tip of the ray in open
 * air. These helpers answer "which body stopped me, and where is its chest".
 */

/** Soft stop radius — matches the combat body soft occlude on the server. */
export const BODY_RADIUS = 0.55;

/**
 * Fallback torso height from the character origin (feet). Kept below Mixamo
 * head (~1.6–1.8) so a missing spine bone still reads as chest, not skull.
 */
export const CHEST_OFFSET_Y = 0.85;

/** Fallback chest height when the character root has not streamed in yet. */
export const DEFAULT_CHEST_Y = 0.9;

export type BodyPoint = { x: number; y: number; z: number };

const chestScratch = new THREE.Vector3();
const torsoScratch: BodyPoint = { x: 0, y: 0, z: 0 };

/** Mixamo mid-back — Spine2's bind axes park attachments on the head. */
function findTorsoBone(root: THREE.Object3D): THREE.Object3D | null {
  return (
    findMixamoBone(root, "Spine1") ??
    findMixamoBone(root, "Spine") ??
    findMixamoBone(root, "Hips")
  );
}

/**
 * Write the live torso point into `out`. Prefers Spine1 world pose so beasts and
 * scaled humans land in the chest instead of a fixed offset that sits on the head.
 */
export function resolveTorsoPoint(
  out: BodyPoint,
  bodyId: string | null | undefined,
): BodyPoint | null {
  const root = getCharacterRoot(bodyId);
  if (!root) return null;
  const bone = findTorsoBone(root);
  if (bone) {
    bone.getWorldPosition(chestScratch);
    out.x = chestScratch.x;
    out.y = chestScratch.y;
    out.z = chestScratch.z;
    return out;
  }
  root.getWorldPosition(chestScratch);
  out.x = chestScratch.x;
  out.y = chestScratch.y + CHEST_OFFSET_Y;
  out.z = chestScratch.z;
  return out;
}

export type OccludeBody = {
  id: string;
  x: number;
  z: number;
  hp?: number;
};

/**
 * Every body that can soft-stop an owner's ray: enemy players plus world targets.
 * Allies and the caster are skipped so a friendly standing in front does not eat the beam.
 */
export function collectOccludeBodies(
  follow: VfxFollowContext | undefined,
  ownerId: string | undefined,
): OccludeBody[] {
  const room = follow?.room;
  if (!room?.state) return [];
  const out: OccludeBody[] = [];
  const players = room.state.players as
    | Map<string, { x?: number; z?: number; hp?: number; team?: string }>
    | undefined;
  const ownerTeam =
    ownerId && players
      ? (players.get(ownerId) as { team?: string } | undefined)?.team
      : undefined;
  players?.forEach((p, id) => {
    if (ownerId && id === ownerId) return;
    if (ownerTeam && p.team && p.team === ownerTeam) return;
    out.push({ id, x: p.x ?? 0, z: p.z ?? 0, hp: p.hp });
  });
  const targets = room.state.targets as
    | Map<string, { x?: number; z?: number; hp?: number }>
    | undefined;
  targets?.forEach((t, id) => {
    out.push({ id, x: t.x ?? 0, z: t.z ?? 0, hp: t.hp });
  });
  return out;
}

/**
 * Front-most body soft-stopping the aim ray.
 *
 * `maxLen` is the ray length with bodies considered, `wallLen` without — if they agree
 * the ray died on geometry, not on a body, and there is nothing to spill into.
 */
export function findConeHitBody(
  origin: { x: number; z: number },
  yaw: number,
  maxLen: number,
  wallLen: number,
  bodies: readonly OccludeBody[],
): OccludeBody | null {
  if (maxLen >= wallLen - 0.08) return null;
  const nx = Math.sin(yaw);
  const nz = Math.cos(yaw);
  let best: OccludeBody | null = null;
  let bestAlong = Infinity;
  for (const b of bodies) {
    const bx = b.x - origin.x;
    const bz = b.z - origin.z;
    const along = bx * nx + bz * nz;
    if (along <= 0 || along > maxLen + BODY_RADIUS + 0.25) continue;
    const perp = Math.abs(bx * nz - bz * nx);
    if (perp > BODY_RADIUS) continue;
    if (along < bestAlong) {
      bestAlong = along;
      best = b;
    }
  }
  return best;
}

/** Chest height for a body, from its live torso bone when one exists. */
export function chestHeightOf(bodyId: string | null | undefined): number {
  if (resolveTorsoPoint(torsoScratch, bodyId)) return torsoScratch.y;
  return DEFAULT_CHEST_Y;
}

/**
 * Write the impact point *inside* a hit body's torso into `out`.
 * Falls back to the ray tip when nothing was hit, so callers never branch.
 */
export function resolveImpactPoint(
  out: BodyPoint,
  hitBody: OccludeBody | null,
  tipX: number,
  tipY: number,
  tipZ: number,
  forwardX: number,
  forwardZ: number,
  depth = 0.1,
): BodyPoint {
  if (!hitBody) {
    out.x = tipX;
    out.y = tipY;
    out.z = tipZ;
    return out;
  }
  if (resolveTorsoPoint(out, hitBody.id)) {
    out.x -= forwardX * depth;
    out.z -= forwardZ * depth;
    return out;
  }
  out.x = hitBody.x - forwardX * depth;
  out.y = DEFAULT_CHEST_Y;
  out.z = hitBody.z - forwardZ * depth;
  return out;
}
