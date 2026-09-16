"""Compare bind dummy skull vs Head bone (REST). Run via Blender:

  blender hero_bind.blend --background --python tools/dump_head_vs_dummy.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import blender_export_skin as skin  # noqa: E402


def main() -> None:
    import bpy
    from mathutils import Vector

    arm = skin.find_armature(None)
    dummy = skin.find_surface(None)
    if dummy is None:
        raise SystemExit("Beta_Surface not in bind file")
    head = skin.find_bone(arm, "Head")
    prev = arm.data.pose_position
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()

    a_s = tuple(round(c, 5) for c in arm.matrix_world.to_scale())
    d_s = tuple(round(c, 5) for c in dummy.matrix_world.to_scale())
    a_l, a_r, _ = arm.matrix_world.decompose()
    d_l, d_r, _ = dummy.matrix_world.decompose()
    match = skin.body_world_matches_armature(dummy, arm)
    print(f"dummy={dummy.name!r} parent={getattr(dummy.parent, 'name', None)} parent_type={dummy.parent_type}")
    print(f"armature_world_scale={a_s} dummy_world_scale={d_s} inherits_armature={match}")
    print(f"armature_world_loc={tuple(round(c, 5) for c in a_l)}")
    print(f"dummy_world_loc   ={tuple(round(c, 5) for c in d_l)}")
    delta = d_l - a_l
    print(f"dummy_minus_arm_loc={tuple(round(c, 5) for c in delta)}")

    head_world = skin.pose_bone_world(arm, head)
    h_l, h_r, h_s = head_world.decompose()
    print(f"Head world loc={tuple(round(c, 5) for c in h_l)} scale={tuple(round(c, 5) for c in h_s)}")

    deps = bpy.context.evaluated_depsgraph_get()
    ev = dummy.evaluated_get(deps)
    mesh = ev.to_mesh()
    inv = head_world.inverted()
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    nape_z = 1e9
    face_z = -1e9
    skull_n = 0
    for v in mesh.vertices:
        w = ev.matrix_world @ v.co
        loc = inv @ w
        mins.x, mins.y, mins.z = min(mins.x, loc.x), min(mins.y, loc.y), min(mins.z, loc.z)
        maxs.x, maxs.y, maxs.z = max(maxs.x, loc.x), max(maxs.y, loc.y), max(maxs.z, loc.z)
        # Mixamo Head +Y is up the skull. Keep the cranium.
        if loc.y < -6 or loc.y > 32:
            continue
        if loc.x * loc.x + loc.z * loc.z > 20 * 20:
            continue
        skull_n += 1
        nape_z = min(nape_z, loc.z)
        face_z = max(face_z, loc.z)
    ev.to_mesh_clear()
    print(f"dummy Head-local all verts min={tuple(round(c, 4) for c in mins)} max={tuple(round(c, 4) for c in maxs)}")
    print(f"dummy skull n={skull_n} Head-local Z nape(min)={nape_z:.4f} face(max)={face_z:.4f} (cm)")
    print("hero.glb Mixamo skull nape Z=-9.97 face Z=+14.80 (cm). More negative Z = further back.")
    print("Head +Z is Mixamo face.")

    hat = bpy.data.objects.get("Head set 3")
    if hat is None:
        print("Head set 3 missing")
    else:
        print(
            f"hat parent={getattr(hat.parent, 'name', None)} type={hat.parent_type} "
            f"bone={hat.parent_bone!r} loc={tuple(round(c, 5) for c in hat.matrix_world.to_translation())}"
        )
        deps = bpy.context.evaluated_depsgraph_get()
        evh = hat.evaluated_get(deps)
        mh = evh.to_mesh()
        hmins = Vector((1e9, 1e9, 1e9))
        hmaxs = Vector((-1e9, -1e9, -1e9))
        for v in mh.vertices:
            loc = inv @ (evh.matrix_world @ v.co)
            hmins.x, hmins.y, hmins.z = min(hmins.x, loc.x), min(hmins.y, loc.y), min(hmins.z, loc.z)
            hmaxs.x, hmaxs.y, hmaxs.z = max(hmaxs.x, loc.x), max(hmaxs.y, loc.y), max(hmaxs.z, loc.z)
        evh.to_mesh_clear()
        print(f"bind hat Head-local min={tuple(round(c, 4) for c in hmins)} max={tuple(round(c, 4) for c in hmaxs)}")
        print(f"bind hat Head-local Z nape(min)={hmins.z:.4f} face(max)={hmaxs.z:.4f} (cm)")

    arm.data.pose_position = prev
    bpy.context.view_layer.update()


if __name__ == "__main__":
    main()
