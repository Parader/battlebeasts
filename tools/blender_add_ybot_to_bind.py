"""
Put Mixamo Y Bot in the bind-pose workbench as a male reference body.

Keeps its own armature (Armature_Male) so the mesh stays male-shaped.
find_armature() still prefers the female object named Armature.
Does not touch hero.glb / hero.blend.

    blender "C:/Users/deric/OneDrive/Documents/mage_trials/player/hero_bind.blend" `
        --background --python tools/blender_add_ybot_to_bind.py -- `
        --fbx "C:/Users/deric/OneDrive/Documents/mage_trials/player/Y Bot.fbx"

Sidebar → Character → Skins → Female / Male toggles the two bodies.
Duplicate a piece, fit it on Y Bot, tag Body = Male, export. Same catalog id
writes `*_male.glb` (fileMale on the existing shop SKU).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BIND = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero_bind.blend")
DEFAULT_FBX = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\Y Bot.fbx")

MALE_ARM = "Armature_Male"
MALE_SURFACE = "YBot_Surface"
COL_FEMALE = "Body Female"
COL_MALE = "Body Male"


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Add Mixamo Y Bot to the skin workbench")
    p.add_argument("--blend", type=Path, default=BIND)
    p.add_argument("--fbx", type=Path, default=DEFAULT_FBX)
    p.add_argument("--out", type=Path, default=None)
    return p.parse_args(argv)


def ensure_object_mode() -> None:
    import bpy

    try:
        if bpy.context.object and bpy.context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
    except RuntimeError:
        pass


def remove_object(name: str) -> None:
    import bpy

    obj = bpy.data.objects.get(name)
    if obj is not None:
        bpy.data.objects.remove(obj, do_unlink=True)
        print(f"[ybot] removed existing {name}")


def ensure_collection(name: str):
    import bpy

    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
    scene_col = bpy.context.scene.collection
    if col.name not in {c.name for c in scene_col.children}:
        try:
            scene_col.children.link(col)
        except RuntimeError:
            pass
    return col


def move_to_collection(obj, col) -> None:
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    if obj.name not in col.objects:
        col.objects.link(obj)


def set_collection_visible(name: str, visible: bool) -> None:
    import bpy

    col = bpy.data.collections.get(name)
    if col is None:
        return
    col.hide_viewport = not visible
    col.hide_render = not visible

    def walk(lc) -> bool:
        if lc.collection == col:
            lc.hide_viewport = not visible
            return True
        for child in lc.children:
            if walk(child):
                return True
        return False

    walk(bpy.context.view_layer.layer_collection)


def pick_surface(meshes: list):
    surface = None
    joints = []
    for obj in meshes:
        low = obj.name.lower()
        if "joint" in low:
            joints.append(obj)
            continue
        if surface is None or "surface" in low:
            surface = obj
    if surface is None and meshes:
        surface = meshes[0]
    return surface, joints


def main() -> None:
    import bpy

    args = parse_args(sys.argv)
    blend = args.blend.expanduser().resolve()
    fbx = args.fbx.expanduser().resolve()
    if not blend.is_file():
        raise SystemExit(f"Workbench missing: {blend}")
    if not fbx.is_file():
        raise SystemExit(f"Missing FBX: {fbx}")

    bpy.ops.wm.open_mainfile(filepath=str(blend))
    ensure_object_mode()

    host = bpy.data.objects.get("Armature")
    if host is None or host.type != "ARMATURE":
        raise SystemExit("No object named Armature — open the Mixamo hero bind file")

    for name in (MALE_ARM, MALE_SURFACE, "Alpha_Surface", "Alpha_Joints"):
        remove_object(name)

    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(fbx), use_anim=False)
    imported = [o for o in bpy.data.objects if o not in before]
    if not imported:
        raise SystemExit("FBX import added no objects")

    arms = [o for o in imported if o.type == "ARMATURE"]
    meshes = [o for o in imported if o.type == "MESH"]
    if not arms:
        raise SystemExit("Y Bot FBX has no armature")
    male_arm = arms[0]
    surface, joints = pick_surface(meshes)
    if surface is None:
        raise SystemExit("Y Bot FBX has no body mesh")

    male_arm.name = MALE_ARM
    if male_arm.data:
        male_arm.data.name = MALE_ARM
    surface.name = MALE_SURFACE
    if surface.data:
        surface.data.name = MALE_SURFACE

    for obj in joints:
        jname = obj.name
        bpy.data.objects.remove(obj, do_unlink=True)
        print(f"[ybot] dropped joints {jname}")

    keep = {male_arm, surface}
    for obj in imported:
        try:
            obj.name
        except ReferenceError:
            continue
        if obj in keep:
            continue
        if obj.type in {"CAMERA", "LIGHT", "EMPTY"}:
            bpy.data.objects.remove(obj, do_unlink=True)

    # Same Mixamo world as the female host — game remounts Y Bot on that skeleton.
    male_arm.matrix_world = host.matrix_world.copy()
    bpy.context.view_layer.update()
    sc = male_arm.scale
    print(
        f"[ybot] {MALE_ARM} scale=({sc.x:.4f},{sc.y:.4f},{sc.z:.4f}) "
        f"parent={getattr(surface.parent, 'name', None)} "
        f"verts={len(surface.data.vertices)}"
    )

    female_col = ensure_collection(COL_FEMALE)
    male_col = ensure_collection(COL_MALE)
    for name in ("Beta_Surface", "Beta_Core", "Beta_Joints"):
        obj = bpy.data.objects.get(name)
        if obj is not None:
            move_to_collection(obj, female_col)
    move_to_collection(male_arm, male_col)
    move_to_collection(surface, male_col)

    tools = Path(__file__).resolve().parent
    if str(tools) not in sys.path:
        sys.path.insert(0, str(tools))
    import blender_export_skin as skin

    skin.restore_body_inherits_armature(male_arm, (MALE_SURFACE,))

    set_collection_visible(COL_FEMALE, True)
    set_collection_visible(COL_MALE, False)

    out = Path(args.out) if args.out else Path(bpy.data.filepath)
    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    print(f"[ybot] saved {out}")
    print(
        "[ybot] Male body is in collection 'Body Male' (hidden). "
        "Skins panel → Male to show it. Duplicate gear, tag Body = Male, export."
    )


if __name__ == "__main__":
    main()
