import * as THREE from "three";

/** Tokens matched against normalized bone names (partial, case-insensitive). */
export const UPPER_BODY_BONE_TOKENS = [
  "spine",
  "spine1",
  "spine2",
  "chestproxy",
  "neck",
  "head",
  "jaw",
  "eye",
  "eyebrow",
  "clavicle",
  "shoulder",
  "arm",
  "forearm",
  "elbow",
  "hand",
  "finger",
  "thumb",
  "index",
  "middle",
  "ring",
  "pinky",
] as const;

/**
 * Hips / Root belong to lower body so upper casts never drive root translation.
 * Includes Blender hero ankle/ball naming (not Mixamo `Foot`).
 */
export const LOWER_BODY_BONE_TOKENS = [
  "root",
  "hips",
  "upleg",
  "leg",
  "foot",
  "ankle",
  "ball",
  "toe",
] as const;

/** Strip common Mixamo / exporter prefixes and non-alphanumerics for matching. */
export function normalizeBoneName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^mixamorig/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Track names look like:
 *   "mixamorigHips.position"
 *   "Armature|mixamorigLeftArm.quaternion"
 *   "Beta_Surface_0.morphTargetInfluences"
 */
export function boneNameFromTrack(trackName: string): string {
  const withoutProp = trackName.includes(".")
    ? trackName.slice(0, trackName.lastIndexOf("."))
    : trackName;
  const segments = withoutProp.split(/[|/]/);
  return segments[segments.length - 1] ?? withoutProp;
}

export function normalizedBoneFromTrack(trackName: string): string {
  return normalizeBoneName(boneNameFromTrack(trackName));
}

/**
 * True if the bone key contains a token as a contiguous substring.
 * Special-case: token "arm" must not match "upleg" / "forearm" is ok (contains arm).
 * Token "leg" must not match purely upper bones; "upleg"/"leftleg" are fine.
 */
export function boneMatchesTokens(normalizedBone: string, tokens: readonly string[]): boolean {
  for (const token of tokens) {
    if (token === "arm") {
      // Match Arm / ForeArm / LeftArm, but not unrelated
      if (normalizedBone.includes("arm") && !normalizedBone.includes("upleg")) return true;
      continue;
    }
    if (token === "leg") {
      if (
        normalizedBone.includes("leg") ||
        normalizedBone.includes("upleg") ||
        normalizedBone.endsWith("leg")
      ) {
        return true;
      }
      continue;
    }
    if (normalizedBone.includes(token)) return true;
  }
  return false;
}

/** True for skeleton root movers (Mixamo Hips or Blender Root/Hips). */
export function isRootMoverBone(normalizedBone: string): boolean {
  return normalizedBone === "root" || normalizedBone.includes("hips");
}

export function isUpperBodyTrack(trackName: string): boolean {
  const bone = normalizedBoneFromTrack(trackName);
  // Explicitly exclude root movers from upper masking
  if (isRootMoverBone(bone)) return false;
  if (boneMatchesTokens(bone, LOWER_BODY_BONE_TOKENS) && !boneMatchesTokens(bone, UPPER_BODY_BONE_TOKENS)) {
    return false;
  }
  return boneMatchesTokens(bone, UPPER_BODY_BONE_TOKENS);
}

export function isLowerBodyTrack(trackName: string): boolean {
  const bone = normalizedBoneFromTrack(trackName);
  return boneMatchesTokens(bone, LOWER_BODY_BONE_TOKENS);
}

export function isHipsPositionTrack(trackName: string): boolean {
  const bone = normalizedBoneFromTrack(trackName);
  const prop = trackName.slice(trackName.lastIndexOf(".") + 1).toLowerCase();
  return isRootMoverBone(bone) && prop.startsWith("position");
}

/** Any root-mover track (position or quaternion) — Hips and/or Root. */
export function isHipsTrack(trackName: string): boolean {
  return isRootMoverBone(normalizedBoneFromTrack(trackName));
}

/** Clone clip keeping only tracks that pass `keep`. */
export function filterClipTracks(
  clip: THREE.AnimationClip,
  keep: (track: THREE.KeyframeTrack) => boolean,
  nameSuffix: string,
): THREE.AnimationClip {
  const tracks = clip.tracks.filter(keep).map((t) => t.clone());
  return new THREE.AnimationClip(`${clip.name}${nameSuffix}`, clip.duration, tracks);
}

export function createUpperBodyClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  return filterClipTracks(clip, (t) => isUpperBodyTrack(t.name), "::upper");
}

/** Cached upper-body cast masks — survive CharacterAvatar remounts / new mixers. */
const upperCastClipCache = new WeakMap<THREE.AnimationClip, THREE.AnimationClip>();

/**
 * Upper-body cast clip from a source Mixamo clip.
 * Cached by source identity so hub↔content remounts skip track filtering.
 */
export function getCachedUpperCastClip(src: THREE.AnimationClip): THREE.AnimationClip {
  let cached = upperCastClipCache.get(src);
  if (cached) return cached;
  cached = createUpperBodyClip(src);
  upperCastClipCache.set(src, cached);
  return cached;
}

/** Normalized name is exactly `spine1` (not spine / spine2). */
export function isExactSpine1Bone(normalizedBone: string): boolean {
  return normalizedBone === "spine1";
}

/** Normalized name is exactly `spine` (not spine1 / spine2). */
export function isExactSpineBone(normalizedBone: string): boolean {
  return normalizedBone === "spine";
}

/**
 * Upper loco for twin-stick. Keeps full upper (incl. Spine / Spine1) so clips
 * drive lean and body-turn; Spine1 gets a relative aim offset after the mixer.
 */
export function createUpperLocoClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  return filterClipTracks(clip, (t) => isUpperBodyTrack(t.name), "::upperLoco");
}

export function createLowerBodyClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  return filterClipTracks(clip, (t) => isLowerBodyTrack(t.name), "::lower");
}


/** First-frame hips Y from a clip (prefer Hips over Root), or null if missing. */
export function getHipsStartY(clip: THREE.AnimationClip): number | null {
  const hips = clip.tracks.find((t) => {
    const bone = normalizedBoneFromTrack(t.name);
    const prop = t.name.slice(t.name.lastIndexOf(".") + 1).toLowerCase();
    return bone.includes("hips") && prop.startsWith("position");
  });
  const track =
    hips ??
    clip.tracks.find((t) => isHipsPositionTrack(t.name));
  if (!track || track.values.length < 3) return null;
  return track.values[1]!;
}

/**
 * Remove horizontal root motion from Root/Hips.position while keeping Y bounce.
 * Locks XZ to 0 (not the first keyframe) so the mesh stays on the gameplay
 * origin — retargeted clips often rest at a non-zero root XZ.
 */
export function stripHorizontalRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    if (!isHipsPositionTrack(track.name)) return track.clone();

    const values = track.values;
    if (values.length < 3) return track.clone();

    const next = track.clone();
    for (let i = 0; i < next.values.length; i += 3) {
      next.values[i] = 0;
      // Y preserved at next.values[i + 1]
      next.values[i + 2] = 0;
    }
    return next;
  });

  return new THREE.AnimationClip(`${clip.name}::noRootXZ`, clip.duration, tracks);
}

/**
 * Lock Hips Y to `plantY` (and Hips/Root XZ to origin) so cast crouches
 * don't drive feet through the ground. Root Y is left alone — Blender Root
 * is usually near 0 while Hips carries stance height.
 * Quaternion (aim twist) is untouched.
 */
export function plantHipsRootMotion(
  clip: THREE.AnimationClip,
  plantY: number,
): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    if (!isHipsPositionTrack(track.name)) return track.clone();

    const values = track.values;
    if (values.length < 3) return track.clone();

    const bone = normalizedBoneFromTrack(track.name);
    const plantYOnThisBone = bone.includes("hips");

    const next = track.clone();
    for (let i = 0; i < next.values.length; i += 3) {
      next.values[i] = 0;
      if (plantYOnThisBone) next.values[i + 1] = plantY;
      next.values[i + 2] = 0;
    }
    return next;
  });

  return new THREE.AnimationClip(`${clip.name}::planted`, clip.duration, tracks);
}

/** Normalize for fuzzy clip-name resolve: lower case, collapse non-alnum. */
export function normalizeClipKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Known export renames — Mixamo title ↔ short Blender export name.
 * Tried only after exact/fuzzy miss so ambiguous packs stay strict.
 */
const CLIP_ALIASES: Record<string, readonly string[]> = {
  "standing 1h magic attack 01": ["magic_1h"],
  magic_1h: ["Standing 1H Magic Attack 01"],
};

function matchClipExactOrFuzzy(
  clips: readonly THREE.AnimationClip[],
  configuredName: string,
): THREE.AnimationClip | null {
  const exact = clips.filter((c) => c.name.toLowerCase() === configuredName.toLowerCase());
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;

  const key = normalizeClipKey(configuredName);
  const fuzzy = clips.filter((c) => normalizeClipKey(c.name) === key);
  if (fuzzy.length === 1) return fuzzy[0]!;
  return null;
}

/**
 * Resolve a configured name against loaded clips.
 * Exact (case-insensitive) first, then normalized key equality.
 * Never picks a loosely related name — returns null if ambiguous or missing.
 */
export function resolveClip(
  clips: readonly THREE.AnimationClip[],
  configuredName: string,
): THREE.AnimationClip | null {
  if (!configuredName) return null;

  const direct = matchClipExactOrFuzzy(clips, configuredName);
  if (direct) return direct;

  for (const alias of CLIP_ALIASES[configuredName.toLowerCase()] ?? []) {
    const hit = matchClipExactOrFuzzy(clips, alias);
    if (hit) return hit;
  }
  return null;
}

export function reportMissingClips(
  clips: readonly THREE.AnimationClip[],
  config: Record<string, string | undefined>,
  label = "[CharacterAnimation]",
): string[] {
  const missing: string[] = [];
  for (const [key, name] of Object.entries(config)) {
    if (!name) continue;
    if (!resolveClip(clips, name)) {
      missing.push(`${key} → "${name}"`);
      console.warn(`${label} missing clip for ${key}: "${name}"`);
    }
  }
  return missing;
}
