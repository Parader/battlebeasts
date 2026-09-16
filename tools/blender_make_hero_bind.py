"""
Strip a hero.blend duplicate down to a bind-pose workbench.

Keeps the Mixamo armature + body (and existing gear as modelling reference).
Deletes every animation / NLA track so this file stays small and is safe to
open while making skins. Never writes over the source .blend.

Usage (from the repo root):

    blender "C:/Users/deric/OneDrive/Documents/mage_trials/player/hero.blend" `
        --background --python tools/blender_make_hero_bind.py -- `
        --out "C:/Users/deric/OneDrive/Documents/mage_trials/player/hero_bind.blend"

Or open the source in Blender, Scripting → Open this file → Run Script
(then pass --out, or it writes hero_bind.blend next to the open file).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import blender_export_skin as skin  # noqa: E402


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Make a bind-pose workbench from hero.blend")
    p.add_argument(
        "--blend",
        type=Path,
        default=None,
        help="Open this .blend first (skip if Blender already loaded one)",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Destination .blend (default: <source_dir>/hero_bind.blend)",
    )
    p.add_argument(
        "--drop-cosmetics",
        action="store_true",
        help="Delete gear meshes too, leaving only armature + body. Off by default.",
    )
    return p.parse_args(argv)


def find_armature():
    import bpy

    preferred = bpy.data.objects.get("Armature")
    if preferred and preferred.type == "ARMATURE":
        return preferred
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("No armature in this file — is this actually the hero?")
    if len(arms) > 1:
        names = ", ".join(a.name for a in arms)
        print(f"[bind] multiple armatures ({names}); using {arms[0].name}")
    return arms[0]


def is_body_mesh(obj) -> bool:
    name = obj.name.lower()
    if "beta_joints" in name:
        return False
    if "beta_surface" in name or name.startswith("sm_chr_"):
        return True
    return False


def is_joints_mesh(obj) -> bool:
    return obj.type == "MESH" and "beta_joints" in obj.name.lower()


def is_cosmetic_mesh(obj) -> bool:
    if obj.type != "MESH":
        return False
    if is_body_mesh(obj) or is_joints_mesh(obj):
        return False
    name = obj.name.lower()
    if name.startswith("cosmetic_"):
        return True
    # Embedded gear in the current hero file uses catalog names, not the prefix.
    if obj.parent and obj.parent.type == "ARMATURE":
        return True
    for mod in obj.modifiers:
        if mod.type == "ARMATURE":
            return True
    return False


def clear_animation(obj) -> None:
    ad = obj.animation_data
    if ad is None:
        return
    for track in list(ad.nla_tracks):
        ad.nla_tracks.remove(track)
    ad.action = None
    obj.animation_data_clear()


def rest_pose(arm) -> None:
    import bpy

    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.data.pose_position = "REST"


def delete_objects(objs) -> None:
    import bpy

    for obj in objs:
        bpy.data.objects.remove(obj, do_unlink=True)


def purge_actions() -> int:
    import bpy

    n = len(bpy.data.actions)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    return n


def purge_orphans() -> None:
    import bpy

    # A few passes; deleting actions orphans NLA + unused meshes.
    for _ in range(3):
        try:
            bpy.ops.outliner.orphans_purge(
                do_local_ids=True, do_linked_ids=True, do_recursive=True
            )
        except Exception:
            break


def inventory() -> None:
    import bpy

    print("[bind] scene objects:")
    for obj in sorted(bpy.data.objects, key=lambda o: o.name.lower()):
        extra = ""
        if obj.type == "MESH":
            verts = len(obj.data.vertices) if obj.data else 0
            extra = f"  verts={verts}"
        print(f"  {obj.type:10} {obj.name}{extra}")


def resolve_out_path(args: argparse.Namespace) -> Path:
    import bpy

    if args.out:
        return Path(args.out)
    src = Path(bpy.data.filepath) if bpy.data.filepath else Path.cwd() / "hero.blend"
    return src.with_name("hero_bind.blend")


def main() -> None:
    import bpy

    args = parse_args(sys.argv)

    if args.blend:
        blend = Path(args.blend)
        if not blend.is_file():
            raise SystemExit(f"Blend not found: {blend}")
        print(f"[bind] opening {blend}")
        bpy.ops.wm.open_mainfile(filepath=str(blend))

    if not bpy.data.filepath:
        raise SystemExit("No .blend is open. Pass the file on the blender CLI or --blend.")

    src = Path(bpy.data.filepath)
    out = resolve_out_path(args)
    if out.resolve() == src.resolve():
        raise SystemExit(
            f"Refusing to overwrite the source file ({src}). Pass --out hero_bind.blend"
        )

    print(f"[bind] source: {src}")
    arm = find_armature()
    print(f"[bind] armature: {arm.name}  bones={len(arm.data.bones)}")

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    body = [o for o in meshes if is_body_mesh(o)]
    joints = [o for o in meshes if is_joints_mesh(o)]
    cosmetics = [o for o in meshes if is_cosmetic_mesh(o)]
    print(f"[bind] body: {[o.name for o in body] or '(none — check mesh names)'}")
    print(f"[bind] joints: {[o.name for o in joints]}")
    print(f"[bind] gear: {[o.name for o in cosmetics]}")

    rest_pose(arm)
    restored = skin.restore_body_inherits_armature(arm)
    if restored:
        print(f"[bind] dummy now inherits armature: {restored}")

    for obj in list(bpy.data.objects):
        clear_animation(obj)
    for mesh in bpy.data.meshes:
        if mesh.shape_keys and mesh.shape_keys.animation_data:
            mesh.shape_keys.animation_data_clear()

    dropped = purge_actions()
    print(f"[bind] dropped {dropped} action(s)")

    for obj in joints:
        obj.hide_set(True)
        obj.hide_viewport = True
        obj.hide_render = True
        print(f"[bind] hid {obj.name}")

    if args.drop_cosmetics and cosmetics:
        print(f"[bind] deleting {len(cosmetics)} gear mesh(es)")
        delete_objects(cosmetics)

    extras = [
        o
        for o in list(bpy.data.objects)
        if o.type in {"CAMERA", "LIGHT", "LAMP", "SPEAKER"}
    ]
    if extras:
        print(f"[bind] dropping {len(extras)} camera/light(s)")
        delete_objects(extras)

    bpy.context.scene.frame_set(1)
    purge_orphans()
    inventory()

    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out), copy=True)
    size_mb = out.stat().st_size / (1024 * 1024)
    print(f"\n[bind] wrote {out} ({size_mb:.1f} MB)")
    print("[bind] open this file for skins / body maps. Leave the source .blend alone.")


if __name__ == "__main__":
    main()
