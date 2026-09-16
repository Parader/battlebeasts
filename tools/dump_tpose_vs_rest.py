"""Head-local skull in the file's saved pose vs REST."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import blender_export_skin as skin  # noqa: E402


def skull(arm, dummy):
    import bpy

    bpy.context.view_layer.update()
    head = skin.find_bone(arm, "Head")
    hw = skin.pose_bone_world(arm, head)
    deps = bpy.context.evaluated_depsgraph_get()
    ev = dummy.evaluated_get(deps)
    me = ev.to_mesh()
    inv = hw.inverted()
    nape, face, n = 1e9, -1e9, 0
    heel_y = 1e9
    for v in me.vertices:
        w = ev.matrix_world @ v.co
        heel_y = min(heel_y, w.y)
        loc = inv @ w
        if loc.y < -6 or loc.y > 32:
            continue
        if loc.x * loc.x + loc.z * loc.z > 400:
            continue
        n += 1
        nape = min(nape, loc.z)
        face = max(face, loc.z)
    ev.to_mesh_clear()
    hips = skin.pose_bone_world(arm, skin.find_bone(arm, "Hips")).to_translation()
    head_w = hw.to_translation()
    return {
        "nape": nape,
        "face": face,
        "n": n,
        "heel_y": heel_y,
        "hips_y": hips.y,
        "head_y": head_w.y,
        "head_z": head_w.z,
    }


def main() -> None:
    import bpy

    arm = skin.find_armature()
    dummy = skin.find_surface()
    print("FILE", bpy.data.filepath)
    print("pose_position", arm.data.pose_position, "action", getattr(getattr(arm.animation_data, "action", None), "name", None))
    a = skull(arm, dummy)
    print(
        f"SAVED  heelY={a['heel_y']:.5f} hipsY={a['hips_y']:.5f} headY={a['head_y']:.5f} "
        f"nape={a['nape']:.4f} face={a['face']:.4f}"
    )
    prev = arm.data.pose_position
    arm.data.pose_position = "REST"
    b = skull(arm, dummy)
    print(
        f"REST   heelY={b['heel_y']:.5f} hipsY={b['hips_y']:.5f} headY={b['head_y']:.5f} "
        f"nape={b['nape']:.4f} face={b['face']:.4f}"
    )
    print(
        f"DELTA saved-rest heelY={a['heel_y']-b['heel_y']:+.5f}m "
        f"headY={a['head_y']-b['head_y']:+.5f}m "
        f"nape={a['nape']-b['nape']:+.4f}cm"
    )
    arm.data.pose_position = prev


if __name__ == "__main__":
    main()
