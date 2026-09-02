"""
Merge Mixamo animation FBXs into a rigged character and export a game-ready GLB.

This is the Blender half of `README-npc-characters.md` done for you. The manual
version -- import, rename the action, mark a fake user, delete the duplicate
armature, push down, repeat -- is a dozen fiddly steps per clip where one
missed "Push Down" produces a GLB that looks fine in Blender and ships with no
animation. Doing it headlessly also means re-exporting after a mesh tweak is
one command rather than the whole ritual again.

Usage (from the repo root):

    blender --background --factory-startup \
        --python tools/blender_build_npc.py -- \
        --rig  "C:/.../NPC/merchant.glb" \
        --anims "C:/.../NPC" \
        --out  "apps/web/public/merchant.glb"

`--anims` is a folder; every .fbx in it becomes one clip, named after the file
(`Talking.fbx` -> `talking`). Pass `--name old=new` to rename a clip, which is
how `Talking.fbx` becomes the `talk` clip the NPC registry looks for.

How it works: both the rig and the Mixamo animations use the same
`mixamorig:` skeleton, so an action lifted off an imported FBX armature can be
assigned straight to the rig's armature -- no retargeting, no bone mapping. The
imported armature is then thrown away and only its action is kept.
"""

import argparse
import sys
from pathlib import Path

import bpy

# Clips whose file name does not match what the game asks for. Kept small on
# purpose: the fix for a badly named clip is usually to rename the file.
DEFAULT_ALIASES = {
    "talking": "talk",
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="blender_build_npc")
    p.add_argument("--rig", required=True, help="Rigged character (.glb/.gltf/.fbx/.blend)")
    p.add_argument("--anims", required=True, help="Folder of animation .fbx files")
    p.add_argument("--out", required=True, help="Destination .glb")
    p.add_argument(
        "--name",
        action="append",
        default=[],
        metavar="STEM=CLIP",
        help="Rename one clip, e.g. --name Talking=talk. Repeatable.",
    )
    p.add_argument(
        "--body-mesh",
        default="Beta_Surface",
        help="Rename the skinned mesh to this so in-game tinting can find it. "
             "Pass an empty string to leave the name alone.",
    )
    p.add_argument(
        "--keep-existing-actions",
        action="store_true",
        help="Keep animations already inside the rig file. Off by default: "
             "those are usually leftovers from however the rig was exported.",
    )
    return p.parse_args(argv)


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_any(path: Path) -> None:
    suffix = path.suffix.lower()
    if suffix == ".fbx":
        # Mixamo rigs round-trip cleanly with leaf bones dropped; keeping them
        # adds sixty `_end` bones that deform nothing and bloat the export.
        bpy.ops.import_scene.fbx(filepath=str(path), ignore_leaf_bones=True)
    elif suffix in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif suffix == ".blend":
        # Opened rather than appended: appending pulls objects out of their
        # scene and it is easy to end up with a rig whose mesh was left behind.
        bpy.ops.wm.open_mainfile(filepath=str(path))
    else:
        raise SystemExit(f"Unsupported file type: {path}")


def find_armature() -> bpy.types.Object:
    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not arms:
        raise SystemExit("No armature found -- is this file actually rigged?")
    if len(arms) > 1:
        # The rig having several armatures means the previous merge went wrong;
        # guessing which one is the real skeleton would hide that.
        names = ", ".join(a.name for a in arms)
        raise SystemExit(f"Expected one armature, found {len(arms)}: {names}")
    return arms[0]


def skinned_meshes(armature: bpy.types.Object) -> list[bpy.types.Object]:
    """Meshes actually driven by the rig, as opposed to junk in the scene."""
    out = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        bound = obj.parent is armature or any(
            m.type == "ARMATURE" and m.object is armature for m in obj.modifiers
        )
        if bound:
            out.append(obj)
    return out


def delete_objects(objs) -> None:
    for obj in objs:
        bpy.data.objects.remove(obj, do_unlink=True)


def assign_action(armature: bpy.types.Object, action: bpy.types.Action) -> None:
    """
    Bind an action to an armature, across the 4.4 slotted-action change.

    Before slots, setting `.action` was the whole job. Since slots, an action
    also needs a slot bound or it evaluates to nothing -- silently, which is
    exactly the failure this script exists to prevent.
    """
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = action

    slots = getattr(action, "slots", None)
    if not slots:
        return
    # Prefer a slot that targets an object; fall back to the first.
    slot = next((s for s in slots if getattr(s, "target_id_type", "OBJECT") == "OBJECT"), slots[0])
    try:
        armature.animation_data.action_slot = slot
    except (AttributeError, TypeError):
        pass


def stash(armature: bpy.types.Object, action: bpy.types.Action, name: str) -> None:
    """
    Park an action on its own NLA track.

    The glTF exporter walks NLA tracks to find what to export, so an action
    that is merely present in the file -- fake user and all -- does not ship.
    """
    anim = armature.animation_data
    track = anim.nla_tracks.new()
    track.name = name
    start = int(action.frame_range[0])
    strip = track.strips.new(name, start, action)
    strip.name = name
    track.mute = False
    # Detach so the next clip starts from a clean slot binding.
    anim.action = None


def main() -> None:
    args = parse_args()

    aliases = dict(DEFAULT_ALIASES)
    for pair in args.name:
        if "=" not in pair:
            raise SystemExit(f"--name expects STEM=CLIP, got {pair!r}")
        stem, clip = pair.split("=", 1)
        aliases[stem.strip().lower()] = clip.strip()

    rig_path = Path(args.rig)
    anim_dir = Path(args.anims)
    out_path = Path(args.out)

    if not rig_path.is_file():
        raise SystemExit(f"Rig not found: {rig_path}")
    if not anim_dir.is_dir():
        raise SystemExit(f"Animation folder not found: {anim_dir}")

    reset_scene()

    # --- the rig -----------------------------------------------------------
    print(f"[npc] rig: {rig_path.name}")
    import_any(rig_path)
    armature = find_armature()
    body = skinned_meshes(armature)
    if not body:
        raise SystemExit("The armature deforms no mesh -- the skin is not bound to the rig.")

    # Anything not bound to the skeleton is scene furniture (stray primitives,
    # reference objects) and has no business in a character GLB.
    strays = [
        o for o in list(bpy.context.scene.objects)
        if o is not armature and o not in body
    ]
    if strays:
        print(f"[npc] dropping {len(strays)} unrigged object(s): {', '.join(o.name for o in strays)}")
        delete_objects(strays)

    if args.body_mesh:
        # Only the first, since the game shows one surface mesh.
        print(f"[npc] renaming {body[0].name!r} -> {args.body_mesh!r}")
        body[0].name = args.body_mesh
        body[0].data.name = args.body_mesh

    if not args.keep_existing_actions:
        stale = list(bpy.data.actions)
        if stale:
            print(f"[npc] discarding {len(stale)} action(s) already in the rig")
            if armature.animation_data:
                armature.animation_data.action = None
            for act in stale:
                bpy.data.actions.remove(act)

    if armature.animation_data is None:
        armature.animation_data_create()
    for track in list(armature.animation_data.nla_tracks):
        armature.animation_data.nla_tracks.remove(track)

    rig_bones = {b.name for b in armature.data.bones}

    # --- the animations ----------------------------------------------------
    fbxs = sorted(p for p in anim_dir.iterdir() if p.suffix.lower() == ".fbx")
    if not fbxs:
        raise SystemExit(f"No .fbx animations in {anim_dir}")

    clips: list[str] = []
    for fbx in fbxs:
        stem = fbx.stem.lower()
        clip_name = aliases.get(stem, stem)

        before = set(bpy.data.actions)
        before_objs = set(bpy.context.scene.objects)
        import_any(fbx)
        new_actions = [a for a in bpy.data.actions if a not in before]
        new_objs = [o for o in bpy.context.scene.objects if o not in before_objs]

        if not new_actions:
            print(f"[npc] !! {fbx.name} carries no animation -- skipped")
            delete_objects(new_objs)
            continue
        if len(new_actions) > 1:
            print(f"[npc] !! {fbx.name} has {len(new_actions)} actions, taking the longest")
        action = max(new_actions, key=lambda a: a.frame_range[1] - a.frame_range[0])

        # Warn rather than fail on a partial match: a clip missing a couple of
        # finger bones still animates, and refusing it would be unhelpful.
        imported_arms = [o for o in new_objs if o.type == "ARMATURE"]
        if imported_arms:
            anim_bones = {b.name for b in imported_arms[0].data.bones}
            missing = anim_bones - rig_bones
            if missing:
                sample = ", ".join(sorted(missing)[:4])
                print(f"[npc] !! {fbx.name}: {len(missing)} bone(s) absent from the rig ({sample})")

        action.name = clip_name
        action.use_fake_user = True
        assign_action(armature, action)
        stash(armature, action, clip_name)

        frames = int(action.frame_range[1] - action.frame_range[0])
        print(f"[npc] clip {clip_name!r} <- {fbx.name} ({frames} frames)")
        clips.append(clip_name)

        # Everything the FBX brought except the action itself.
        delete_objects(new_objs)
        for act in [a for a in new_actions if a is not action]:
            bpy.data.actions.remove(act)

    if not clips:
        raise SystemExit("No clips were merged -- nothing to export.")

    # --- export ------------------------------------------------------------
    out_path.parent.mkdir(parents=True, exist_ok=True)
    for obj in bpy.context.scene.objects:
        obj.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_animations=True,
        # One glTF animation per action, which is what the game's animation
        # controller looks clips up by.
        export_animation_mode="ACTIONS",
        # Bones that deform nothing still cost a node and a channel each.
        export_def_bones=True,
        export_yup=True,
    )

    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"\n[npc] wrote {out_path} ({size_mb:.1f} MB)")
    print(f"[npc] clips: {', '.join(clips)}")


if __name__ == "__main__":
    main()
