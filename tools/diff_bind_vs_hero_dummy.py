"""Append hero.blend Beta_Surface into bind and diff REST world verts 1:1."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import blender_export_skin as skin  # noqa: E402

HERO = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero.blend")


def world_verts(obj):
    import bpy

    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return pts


def main() -> None:
    import bpy
    from mathutils import Vector

    arm = skin.find_armature()
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    bind = bpy.data.objects.get("Beta_Surface")
    print("bind cursor", tuple(round(c, 5) for c in bpy.context.scene.cursor.location))

    before = set(bpy.data.objects)
    with bpy.data.libraries.load(str(HERO), link=False) as (src, dst):
        dst.objects = ["Armature", "Beta_Surface"]
    hero_obj = next(o for o in bpy.data.objects if o not in before and o.type == "MESH" and "Beta_Surface" in o.name)
    hero_arm = next((o for o in bpy.data.objects if o not in before and o.type == "ARMATURE"), None)
    if hero_arm is not None:
        hero_arm.data.pose_position = "REST"
    bpy.context.view_layer.update()

    a = world_verts(bind)
    b = world_verts(hero_obj)
    print("bind verts", len(a), "hero verts", len(b), "hero obj", hero_obj.name, "hero parent", getattr(hero_obj.parent, "name", None))
    n = min(len(a), len(b))
    max_d = 0.0
    acc = Vector((0, 0, 0))
    worst = 0
    for i in range(n):
        d = a[i] - b[i]
        acc += d
        L = d.length
        if L > max_d:
            max_d = L
            worst = i
    mean = acc / n
    print(f"mean delta bind-hero (m) {tuple(round(c, 6) for c in mean)}")
    print(f"max |delta| {max_d*100:.4f} cm  at vert {worst} bind={tuple(round(c,5) for c in a[worst])} hero={tuple(round(c,5) for c in b[worst])}")
    print(f"bind heel Y {min(p.y for p in a):.5f}  hero heel Y {min(p.y for p in b):.5f}")
    print(f"bind heel-to-origin {abs(min(p.y for p in a))*100:.2f} cm   hero heel-to-origin {abs(min(p.y for p in b))*100:.2f} cm")


if __name__ == "__main__":
    main()
