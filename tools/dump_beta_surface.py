"""Diff female Beta_Surface in the open .blend: local mesh vs object vs evaluated."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import blender_export_skin as skin  # noqa: E402


def r3(v, n=6):
    return tuple(round(float(c), n) for c in v)


def local_bbox(mesh):
    xs = [v.co.x for v in mesh.vertices]
    ys = [v.co.y for v in mesh.vertices]
    zs = [v.co.z for v in mesh.vertices]
    return (
        (min(xs), min(ys), min(zs)),
        (max(xs), max(ys), max(zs)),
    )


def vert_digest(mesh, n=32):
    h = hashlib.sha1()
    for i, v in enumerate(mesh.vertices):
        if i >= n and i % 97 != 0:
            continue
        h.update(f"{v.co.x:.6f},{v.co.y:.6f},{v.co.z:.6f};".encode())
    return h.hexdigest()[:12]


def main() -> None:
    import bpy

    obj = bpy.data.objects.get("Beta_Surface")
    arm = skin.find_armature()
    print("FILE", bpy.data.filepath)
    print("pose", arm.data.pose_position)
    print("object loc", r3(obj.location), "scale", r3(obj.scale), "rot_eul_deg", r3(tuple(__import__("math").degrees(a) for a in obj.rotation_euler)))
    print("world loc", r3(obj.matrix_world.to_translation()), "world scale", r3(obj.matrix_world.to_scale()))
    print("parent", getattr(obj.parent, "name", None), obj.parent_type, "inherits", skin.body_world_matches_armature(obj, arm))
    print("parent_inv loc", r3(obj.matrix_parent_inverse.to_translation()), "parent_inv scale", r3(obj.matrix_parent_inverse.to_scale()))
    print("hide", obj.hide_get(), "hide_viewport", obj.hide_viewport)
    print("collections", [f"{c.name}:hide={c.hide_viewport}" for c in obj.users_collection])
    print("modifiers", [(m.name, m.type, getattr(getattr(m, "object", None), "name", None)) for m in obj.modifiers])
    print("dimensions (object)", r3(obj.dimensions))
    mn, mx = local_bbox(obj.data)
    print("LOCAL mesh bbox min", r3(mn), "max", r3(mx))
    print("LOCAL size", r3((mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2])))
    print("verts", len(obj.data.vertices), "digest", vert_digest(obj.data))
    print("v0 local", r3(obj.data.vertices[0].co), "vlast", r3(obj.data.vertices[-1].co))

    prev = arm.data.pose_position
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    xs, ys, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
    print("EVAL REST world min", r3((min(xs), min(ys), min(zs))), "max", r3((max(xs), max(ys), max(zs))))
    print("EVAL REST size", r3((max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))))
    print("EVAL REST heel Y", round(min(ys), 6), "height Z", round(max(zs) - min(zs), 6))
    arm.data.pose_position = prev


if __name__ == "__main__":
    main()
