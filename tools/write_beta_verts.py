"""Write REST world verts of Beta_Surface to a json next to the blend."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import blender_export_skin as skin  # noqa: E402


def main() -> None:
    import bpy

    arm = skin.find_armature()
    prev = arm.data.pose_position
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    obj = bpy.data.objects.get("Beta_Surface")
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    pts = [[round((ev.matrix_world @ v.co)[i], 6) for i in range(3)] for v in me.vertices]
    ev.to_mesh_clear()
    arm.data.pose_position = prev
    out = Path(r"C:\solo\battlebeasts2\tools") / (Path(bpy.data.filepath).stem + "_beta_verts.json")
    heel = min(pts, key=lambda p: p[1])
    payload = {
        "file": bpy.data.filepath,
        "pose_saved": prev,
        "cursor": [round(c, 5) for c in bpy.context.scene.cursor.location],
        "n": len(pts),
        "heel": heel,
        "min": [min(p[i] for p in pts) for i in range(3)],
        "max": [max(p[i] for p in pts) for i in range(3)],
        "pts": pts,
    }
    out.write_text(json.dumps(payload), encoding="utf-8")
    print("wrote", out, "heel", heel, "cursor", payload["cursor"], "saved_pose", prev)


if __name__ == "__main__":
    main()
