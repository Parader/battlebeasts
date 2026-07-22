import * as THREE from "three";
import { boneNameFromTrack, normalizedBoneFromTrack } from "./clipUtils";

/** Debug dump for a loaded character + clips. Call from the console or once on load. */
export function debugPrintAnimationAssets(
  root: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
  label = "[AnimDebug]",
): void {
  const clipNames = clips.map((c) => c.name);
  console.group(label);
  console.log("clips (%d):", clipNames.length, clipNames);

  for (const clip of clips) {
    console.groupCollapsed(`tracks — ${clip.name} (${clip.tracks.length}, ${clip.duration.toFixed(3)}s)`);
    for (const track of clip.tracks) {
      console.log(track.name, "→ bone", boneNameFromTrack(track.name), normalizedBoneFromTrack(track.name));
    }
    console.groupEnd();
  }

  const bones: string[] = [];
  root.traverse((obj) => {
    const skinned = obj as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) {
      for (const bone of skinned.skeleton.bones) {
        bones.push(bone.name);
      }
    }
  });
  const uniqueBones = [...new Set(bones)];
  console.log("skeleton bones (%d):", uniqueBones.length, uniqueBones);
  console.groupEnd();
}
