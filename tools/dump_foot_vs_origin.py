"""Compare Mixamo mesh vs bones vs world origin in a .blend (REST)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import blender_export_skin as skin  # noqa: E402


def r3(v, n=5):
    return tuple(round(float(c), n) for c in v)


def mesh_world_pts(obj):
    import bpy

    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return pts


def main() -> None:
    import bpy

    arm = skin.find_armature()
    dummy = skin.find_surface()
    ybot = bpy.data.objects.get("YBot_Surface")
    print("FILE", bpy.data.filepath)
    print("pose_position", arm.data.pose_position, "frame", bpy.context.scene.frame_current)
    ad = arm.animation_data
    print("action", None if ad is None else getattr(ad.action, "name", None))
    print("visible collections", [c.name for c in bpy.data.collections if not c.hide_viewport])

    def dump_mesh(label, obj, arm_obj):
        if obj is None:
            print(label, "MISSING")
            return
        pts = mesh_world_pts(obj)
        ys = [p.y for p in pts]
        heel = min(pts, key=lambda p: p.y)
        print(label, obj.name, "parent", getattr(obj.parent, "name", None), obj.parent_type, "inherits", skin.body_world_matches_armature(obj, arm_obj))
        print(label, "heel Y", round(float(heel.y), 5), "minY", round(min(ys), 5), "maxY", round(max(ys), 5), "n", len(pts))

    print("--- as saved (no REST force) ---")
    bpy.context.view_layer.update()
    dump_mesh("female", dummy, arm)
    male_arm = bpy.data.objects.get("Armature_Male")
    dump_mesh("ybot", ybot, male_arm or arm)

    prev = arm.data.pose_position
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    skin.reveal_bind_dummies()
    bpy.context.view_layer.update()

    print("--- REST ---")
    print("cursor", r3(bpy.context.scene.cursor.location))
    print("Armature world", r3(arm.matrix_world.to_translation()), "scale", r3(arm.matrix_world.to_scale()))
    print("Dummy world", r3(dummy.matrix_world.to_translation()), "scale", r3(dummy.matrix_world.to_scale()), "inherits", skin.body_world_matches_armature(dummy, arm))
    print("Dummy local", r3(dummy.location), "parent_inv_t", r3(dummy.matrix_parent_inverse.to_translation()))

    pts = mesh_world_pts(dummy)
    xs, ys, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
    print("mesh bbox min", r3((min(xs), min(ys), min(zs))), "max", r3((max(xs), max(ys), max(zs))))
    # Ground plane is XY in Blender Z-up after Mixamo +X90: Y is depth (heel negative).
    heel = min(pts, key=lambda p: p.y)
    toe = max(pts, key=lambda p: p.y)
    print("heel (min Y) world", r3(heel), "dist_to_origin_Y", round(float(heel.y), 5))
    print("toe (max Y) world", r3(toe))

    for name in ("Hips", "LeftFoot", "RightFoot", "LeftToeBase", "Head", "Neck"):
        b = skin.find_bone(arm, name)
        w = skin.pose_bone_world(arm, b)
        print(f"bone {name:12} head_world={r3(w.to_translation())} head_local={r3(b.head)}")

    lfoot = skin.find_bone(arm, "LeftFoot")
    lf = skin.pose_bone_world(arm, lfoot).to_translation()
    # verts near the left foot (x>0 Mixamo? actually character X left-right, left foot is +X)
    left_pts = [p for p in pts if p.x > 0.05]
    if left_pts:
        left_heel = min(left_pts, key=lambda p: p.y)
        print("left heel world", r3(left_heel))
        print("left heel minus LeftFoot", r3((left_heel.x - lf.x, left_heel.y - lf.y, left_heel.z - lf.z)))
        print("left heel Y minus origin", round(float(left_heel.y), 5), "LeftFoot Y", round(float(lf.y), 5))

    head = skin.find_bone(arm, "Head")
    hw = skin.pose_bone_world(arm, head)
    inv = hw.inverted()
    skull = []
    for p in pts:
        loc = inv @ p
        if -6 <= loc.y <= 32 and loc.x * loc.x + loc.z * loc.z <= 400:
            skull.append(loc)
    if skull:
        nape = min(v.z for v in skull)
        face = max(v.z for v in skull)
        print("Head-local skull nape Z", round(nape, 4), "face Z", round(face, 4), "n", len(skull))

    arm.data.pose_position = prev


if __name__ == "__main__":
    main()
