"""Compare armature / dummy / Hips origins in hero_bind.blend vs hero.glb.

  blender hero_bind.blend --background --python tools/dump_origins.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import blender_export_skin as skin  # noqa: E402

HERO_GLB = Path(r"C:\solo\battlebeasts2\apps\web\public\hero.glb")
HERO_BLEND = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero.blend")


def r3(v):
    return tuple(round(float(c), 6) for c in v)


def eul_deg(mat):
    e = mat.to_euler("XYZ")
    return r3((math.degrees(e.x), math.degrees(e.y), math.degrees(e.z)))


def mesh_world_bbox(obj):
    import bpy

    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    if not pts:
        return None
    xs, ys, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
    mn = (min(xs), min(ys), min(zs))
    mx = (max(xs), max(ys), max(zs))
    ctr = ((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2)
    return mn, mx, ctr, len(pts)


def dump_one(label: str, arm, dummy) -> dict:
    import bpy

    hips = skin.find_bone(arm, "Hips")
    head = skin.find_bone(arm, "Head")
    prev = arm.data.pose_position
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()

    print(f"\n=== {label} REST ===")
    print("Armature", arm.name, "parent", getattr(arm.parent, "name", None))
    print("  local loc", r3(arm.location), "local scale", r3(arm.scale), "local eul_deg", eul_deg(arm.matrix_basis))
    print("  world loc", r3(arm.matrix_world.to_translation()), "world scale", r3(arm.matrix_world.to_scale()), "world eul_deg", eul_deg(arm.matrix_world))
    print("Hips world", r3(skin.pose_bone_world(arm, hips).to_translation()), "Hips head-local", r3(hips.head))
    print("Head world", r3(skin.pose_bone_world(arm, head).to_translation()))
    out = {
        "arm_world": arm.matrix_world.to_translation().copy(),
        "hips_world": skin.pose_bone_world(arm, hips).to_translation().copy(),
        "head_world": skin.pose_bone_world(arm, head).to_translation().copy(),
        "dummy_world": None,
        "dummy_center": None,
        "dummy_min": None,
        "dummy_max": None,
        "inherits": None,
    }
    if dummy:
        print(
            "Dummy", dummy.name,
            "parent", getattr(dummy.parent, "name", None), dummy.parent_type,
            "inherits", skin.body_world_matches_armature(dummy, arm),
        )
        print("  local loc", r3(dummy.location), "local scale", r3(dummy.scale))
        print("  world loc", r3(dummy.matrix_world.to_translation()), "world scale", r3(dummy.matrix_world.to_scale()))
        box = mesh_world_bbox(dummy)
        if box:
            mn, mx, ctr, n = box
            print("  eval verts", n)
            print("  eval world bbox min", r3(mn), "max", r3(mx))
            print("  eval world center", r3(ctr))
            print("  eval world XY (Blender ground) center", r3((ctr[0], ctr[1])), "Z height center", round(ctr[2], 6))
            print("  eval world XZ (Three.js ground after +X90) would swap Y/Z — raw XY here is the file's ground")
            out["dummy_center"] = ctr
            out["dummy_min"] = mn
            out["dummy_max"] = mx
        out["dummy_world"] = dummy.matrix_world.to_translation().copy()
        out["inherits"] = skin.body_world_matches_armature(dummy, arm)
    else:
        print("Dummy missing")
    arm.data.pose_position = prev
    bpy.context.view_layer.update()
    return out


def import_hero_glb():
    import bpy

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(HERO_GLB))
    new = [o for o in bpy.data.objects if o not in before]
    arm = None
    dummy = None
    for o in new:
        if o.type == "ARMATURE" and arm is None:
            arm = o
        if o.type == "MESH" and "beta_surface" in o.name.lower() and ".001" not in o.name:
            dummy = o
    if dummy is None:
        for o in new:
            if o.type == "MESH" and "beta_surface" in o.name.lower():
                dummy = o
                break
    return arm, dummy, new


def import_hero_blend():
    import bpy

    if not HERO_BLEND.is_file():
        return None, None
    before = set(bpy.data.objects)
    bpy.ops.wm.append(
        filepath=str(HERO_BLEND / "Object" / "Armature"),
        directory=str(HERO_BLEND / "Object") + "/",
        filename="Armature",
    )
    # appending armature may not pull Beta_Surface; link both collections instead
    after = [o for o in bpy.data.objects if o not in before]
    if after:
        return None, None
    return None, None


def main() -> None:
    import bpy

    print("bind file", bpy.data.filepath)
    print("hero.glb", HERO_GLB, "exists", HERO_GLB.is_file())
    print("hero.blend", HERO_BLEND, "exists", HERO_BLEND.is_file())

    bind_arm = skin.find_armature(None)
    bind_dummy = skin.find_surface(None)
    a = dump_one("hero_bind.blend", bind_arm, bind_dummy)

    glb_arm, glb_dummy, _ = import_hero_glb()
    if glb_arm is None:
        raise SystemExit("hero.glb import produced no armature")
    b = dump_one("hero.glb (imported into same scene)", glb_arm, glb_dummy)

    print("\n=== DELTA bind minus hero.glb (world metres) ===")
    for key, label in (
        ("arm_world", "Armature origin"),
        ("hips_world", "Hips bone"),
        ("head_world", "Head bone"),
        ("dummy_world", "Dummy object origin"),
    ):
        va, vb = a[key], b[key]
        if va is None or vb is None:
            print(f"{label}: missing")
            continue
        d = (va.x - vb.x, va.y - vb.y, va.z - vb.z)
        print(f"{label}: dx={d[0]:+.6f} dy={d[1]:+.6f} dz={d[2]:+.6f}")
    if a["dummy_center"] and b["dummy_center"]:
        ca, cb = a["dummy_center"], b["dummy_center"]
        print(
            "Dummy mesh AABB center:",
            f"dx={ca[0]-cb[0]:+.6f} dy={ca[1]-cb[1]:+.6f} dz={ca[2]-cb[2]:+.6f}",
        )
        print(
            "Dummy mesh AABB XY center only:",
            f"dx={ca[0]-cb[0]:+.6f} dy={ca[1]-cb[1]:+.6f}",
        )
    print("bind dummy inherits armature:", a["inherits"])
    print("glb dummy inherits armature:", b["inherits"])


if __name__ == "__main__":
    main()
