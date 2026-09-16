"""Import Mixamo T-Pose from hero.blend onto hero_bind and switch to that pose.

Export still bakes REST.

    blender hero_bind.blend --background --python tools/blender_bind_tpose.py
"""
from __future__ import annotations

import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import blender_bind_idle as idle  # noqa: E402
import blender_export_skin as skin  # noqa: E402

BIND = idle.BIND


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

    blend = BIND
    if "--" in sys.argv:
        extra = sys.argv[sys.argv.index("--") + 1 :]
        if extra:
            blend = Path(extra[0])
    if not bpy.data.filepath:
        bpy.ops.wm.open_mainfile(filepath=str(blend))

    action, imported = idle.ensure_tpose_action()
    info = idle.apply_pose_preview("tpose")
    bb = getattr(bpy.context.scene, "bb_skins", None)
    if bb is not None and hasattr(bb, "pose_preview"):
        try:
            bb.pose_preview = "tpose"
        except TypeError:
            pass
    body = bpy.data.objects.get("Beta_Surface")
    print(f"[tpose] imported={imported} action={action.name!r} {info}")
    print(f"[tpose] female heel Y={heel_y(body):.5f} (hero.blend T-Pose is -0.18729)")
    for arm in idle.bind_armatures():
        act = arm.animation_data.action if arm.animation_data else None
        print(f"[tpose] {arm.name}: pose={arm.data.pose_position} action={getattr(act, 'name', None)}")
    out = Path(bpy.data.filepath) if bpy.data.filepath else blend
    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    print(f"[tpose] saved {out}")
    print("[tpose] Sidebar → Character → Skins → Pose: T-Pose. Export still uses Rest.")


if __name__ == "__main__":
    main()
