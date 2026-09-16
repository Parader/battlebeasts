"""List actions and T-Pose vs REST heel on the open file."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import blender_export_skin as skin  # noqa: E402


def heel_y(obj):
    import bpy

    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    ys = [(ev.matrix_world @ v.co).y for v in me.vertices]
    ev.to_mesh_clear()
    return min(ys)


def apply_action(arm, name: str) -> str | None:
    import bpy

    action = bpy.data.actions.get(name)
    if action is None:
        for a in bpy.data.actions:
            if name.lower() in a.name.lower():
                action = a
                break
    if action is None:
        return None
    arm.animation_data_create()
    arm.animation_data.action = action
    slots = getattr(action, "slots", None)
    if slots and len(slots) > 0 and hasattr(arm.animation_data, "action_slot"):
        arm.animation_data.action_slot = slots[0]
    bpy.context.scene.frame_set(int(round(action.frame_range[0])))
    bpy.context.view_layer.update()
    return action.name


def main() -> None:
    import bpy

    arm = skin.find_armature()
    obj = bpy.data.objects.get("Beta_Surface")
    print("FILE", bpy.data.filepath)
    print("pose_position", arm.data.pose_position)
    print("actions", [a.name for a in bpy.data.actions][:30])
    ad = arm.animation_data
    print("current action", None if ad is None else getattr(ad.action, "name", None))

    prev = arm.data.pose_position
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    print("REST heelY", round(heel_y(obj), 5))

    arm.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    print("POSE (current action) heelY", round(heel_y(obj), 5))
    applied = apply_action(arm, "T-Pose")
    print("applied", applied, "heelY", round(heel_y(obj), 5) if applied else None)
    arm.data.pose_position = prev


if __name__ == "__main__":
    main()
