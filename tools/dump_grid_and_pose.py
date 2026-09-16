"""Scene units, 3D view grid, and as-opened vs REST heel."""
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
    zs = [(ev.matrix_world @ v.co).z for v in me.vertices]
    ev.to_mesh_clear()
    return min(ys), min(zs), max(zs) - min(zs)


def main() -> None:
    import bpy

    u = bpy.context.scene.unit_settings
    print("FILE", bpy.data.filepath)
    print("units", u.system, "scale_length", u.scale_length)
    print("cursor", tuple(round(c, 5) for c in bpy.context.scene.cursor.location))
    arm = skin.find_armature()
    obj = bpy.data.objects.get("Beta_Surface")
    print("armature pose_position", arm.data.pose_position)
    ad = arm.animation_data
    print("action", None if ad is None else getattr(ad.action, "name", None))
    hy, zmin, h = heel_y(obj)
    print(f"AS-OPENED inherits={skin.body_world_matches_armature(obj, arm)} heelY={hy:.5f} zmin={zmin:.5f} height={h:.5f} world_scale={tuple(round(x,5) for x in obj.matrix_world.to_scale())}")

    prev = arm.data.pose_position
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    hy2, zmin2, h2 = heel_y(obj)
    print(f"REST      inherits={skin.body_world_matches_armature(obj, arm)} heelY={hy2:.5f} zmin={zmin2:.5f} height={h2:.5f}")
    arm.data.pose_position = prev

    n = 0
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            for space in area.spaces:
                if space.type != "VIEW_3D":
                    continue
                n += 1
                print(
                    f"view {screen.name!r} grid_scale={space.overlay.grid_scale} "
                    f"show_floor={space.overlay.show_floor} show_axis_y={space.overlay.show_axis_y} "
                    f"clip_start={space.clip_start:.4f} dist={space.region_3d.view_distance:.4f} "
                    f"ortho={space.region_3d.is_orthographic_side_view} persp={space.region_3d.view_perspective}"
                )
    print("view3d count", n)


if __name__ == "__main__":
    main()
