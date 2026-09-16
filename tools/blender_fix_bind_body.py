"""
Put the female Mixamo dummy back on the armature (same as hero.blend / hero.glb)
and object-parent hats to the armature (not Head bone) without moving them.

Bone-parent + Armature modifier double-applies Head in Idle, so helms sit
forward of Rest/export/game. Object-parent matches how Mixamo is bound.

    blender "C:/Users/deric/OneDrive/Documents/mage_trials/player/hero_bind.blend" `
        --background --python tools/blender_fix_bind_body.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import blender_export_skin as skin  # noqa: E402

BIND = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero_bind.blend")
HAT_MESHES = ("WizardHat", "Head set 2", "Head set 3", "Head Set 4", "Head Set 5")


def fmt(v, n=5):
    return tuple(round(float(x), n) for x in v)


def world_bounds(obj):
    import bpy

    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    xs, ys, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
    return {
        "min": fmt((min(xs), min(ys), min(zs))),
        "max": fmt((max(xs), max(ys), max(zs))),
        "size": fmt((max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))),
        "center": fmt(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)),
    }


def main() -> None:
    import bpy

    if "--" in sys.argv:
        extra = sys.argv[sys.argv.index("--") + 1 :]
    else:
        extra = []
    blend = BIND
    if extra:
        blend = Path(extra[0])
    if not bpy.data.filepath:
        bpy.ops.wm.open_mainfile(filepath=str(blend))

    arm = skin.find_armature()
    prev = arm.data.pose_position
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    skin.show_female_dummy()

    body = bpy.data.objects.get("Beta_Surface")
    if body is None:
        raise SystemExit("Beta_Surface missing")
    before = world_bounds(body)
    print(f"[fix] armature scale={fmt(arm.matrix_world.to_scale())} eul_x={math.degrees(arm.matrix_world.to_euler('XYZ').x):.2f}")
    print(f"[fix] Beta_Surface BEFORE parent={body.parent} type={body.parent_type} bounds={before}")

    restored = skin.restore_body_inherits_armature(arm)
    print(f"[fix] restored body inherit: {restored or '(already on rig)'}")
    if not skin.body_world_matches_armature(body, arm):
        raise SystemExit(
            f"Beta_Surface still off-rig world_scale={fmt(body.matrix_world.to_scale())}"
        )

    after = world_bounds(body)
    height = after["size"][2]
    print(f"[fix] Beta_Surface AFTER bounds={after}")
    if not (1.6 < height < 2.0):
        raise SystemExit(f"dummy height {height:.3f}m is not Mixamo (~1.81m)")

    for name in HAT_MESHES:
        hat = bpy.data.objects.get(name)
        if hat is None or hat.type != "MESH":
            continue
        mw_before = fmt(hat.matrix_world.to_translation())
        already = hat.parent == arm and hat.parent_type == "OBJECT"
        was_bone = hat.parent_type == "BONE"
        skin.parent_keep_world_to_object(hat, arm)
        skin.ensure_armature_modifier(hat, arm)
        mw_after = fmt(hat.matrix_world.to_translation())
        print(
            f"[fix] {name!r} object-parent Armature keep-world "
            f"{'(already)' if already else 'from ' + ('BONE' if was_bone else hat.parent_type)} "
            f"origin {mw_before} -> {mw_after} bounds={world_bounds(hat)} "
            f"vgroups={[skin.bone_suffix(vg.name) for vg in hat.vertex_groups]}"
        )

    arm.data.pose_position = prev
    bpy.context.view_layer.update()
    out = Path(bpy.data.filepath) if bpy.data.filepath else blend
    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    print(f"[fix] saved {out}")
    print("[fix] dummy on-rig. Hats object-parented (Idle no longer double-applies Head). Reopen the blend.")


if __name__ == "__main__":
    main()
