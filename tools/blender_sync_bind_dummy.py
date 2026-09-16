"""
Replace hero_bind's female Mixamo dummy with the exact meshes from hero.blend.

Y Bot stays in the file but Body Male is hidden — the white smooth foot is Y Bot,
not the peach Mixamo female.

    blender "C:/Users/deric/OneDrive/Documents/mage_trials/player/hero_bind.blend" `
        --background --python tools/blender_sync_bind_dummy.py
"""

from __future__ import annotations

import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import blender_export_skin as skin  # noqa: E402

BIND = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero_bind.blend")
HERO = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero.blend")
COPY = ("Beta_Surface", "Beta_Joints")
HAT_MESHES = ("WizardHat", "Head set 2", "Head set 3", "Head Set 4", "Head Set 5")


def heel_y(obj) -> float:
    import bpy

    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    ys = [(ev.matrix_world @ v.co).y for v in me.vertices]
    ev.to_mesh_clear()
    return min(ys)


def main() -> None:
    import bpy

    if not HERO.is_file():
        raise SystemExit(f"Missing {HERO}")
    if not bpy.data.filepath:
        bpy.ops.wm.open_mainfile(filepath=str(BIND))

    arm = skin.find_armature()
    prev = arm.data.pose_position
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()

    hats = {}
    for name in HAT_MESHES:
        hat = bpy.data.objects.get(name)
        if hat is not None:
            hats[name] = hat.matrix_world.copy()

    body = bpy.data.objects.get("Beta_Surface")
    before = heel_y(body) if body else None
    print(f"[sync] bind female heel Y before={before}")

    before_objs = set(bpy.data.objects)
    before_meshes = set(bpy.data.meshes)
    with bpy.data.libraries.load(str(HERO), link=False) as (src, dst):
        dst.objects = [n for n in COPY if n in src.objects]
    appended = [o for o in bpy.data.objects if o not in before_objs]
    print(f"[sync] appended from hero.blend: {[o.name for o in appended]}")

    by_stem = {}
    for obj in appended:
        stem = obj.name.split(".")[0]
        by_stem[stem] = obj

    for name in COPY:
        src = by_stem.get(name)
        dst = bpy.data.objects.get(name)
        if src is None:
            print(f"[sync] {name} not in hero.blend — skip")
            continue
        if dst is None:
            raise SystemExit(f"{name} missing in bind")
        mats = [dst.data.materials[i] for i in range(len(dst.data.materials))]
        old_mesh = dst.data
        dst.data = src.data.copy()
        dst.data.name = name
        dst.data.materials.clear()
        for mat in mats:
            dst.data.materials.append(mat)
        print(
            f"[sync] {name}: verts {len(old_mesh.vertices)} -> {len(dst.data.vertices)} "
            f"kept {len(mats)} bind materials"
        )
        bpy.data.objects.remove(src, do_unlink=True)
        if old_mesh.users == 0:
            bpy.data.meshes.remove(old_mesh)

    for mesh in list(bpy.data.meshes):
        if mesh not in before_meshes and mesh.users == 0:
            bpy.data.meshes.remove(mesh)

    restored = skin.restore_body_inherits_armature(arm)
    print(f"[sync] inherit armature: {restored or '(already)'}")
    skin.apply_body_preview("female")
    bb = getattr(bpy.context.scene, "bb_skins", None)
    if bb is not None and hasattr(bb, "body_preview"):
        bb.body_preview = "female"

    body = bpy.data.objects.get("Beta_Surface")
    if not skin.body_world_matches_armature(body, arm):
        raise SystemExit("Beta_Surface off-rig after sync")
    after = heel_y(body)
    print(f"[sync] bind female heel Y after={after:.5f} (hero.blend REST is -0.17174)")

    for name, mw in hats.items():
        hat = bpy.data.objects.get(name)
        if hat is None:
            continue
        skin.parent_keep_world_to_object(hat, arm)
        hat.matrix_world = mw
        skin.ensure_armature_modifier(hat, arm)
        print(f"[sync] hat {name!r} keep-world")

    arm.data.pose_position = prev
    bpy.context.view_layer.update()
    out = Path(bpy.data.filepath) if bpy.data.filepath else BIND
    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    print(f"[sync] saved {out}")
    print("[sync] Body Female visible, Body Male hidden. Reopen the bind file from disk.")


if __name__ == "__main__":
    main()
