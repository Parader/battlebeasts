"""Dump gear meshes in the bind workbench: parent, modifiers, vertex groups."""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> None:
    import bpy

    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    blend = Path(argv[0]) if argv else None
    if blend:
        bpy.ops.wm.open_mainfile(filepath=str(blend.resolve()))

    skip = {"beta_surface", "beta_joints", "beta_core"}
    print("=== objects ===")
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            if obj.type == "ARMATURE":
                print(f"ARMATURE {obj.name!r} scale={tuple(round(s, 5) for s in obj.scale)} world_scale={tuple(round(s, 5) for s in obj.matrix_world.to_scale())}")
            continue
        if obj.name.lower() in skip:
            continue
        parent = obj.parent.name if obj.parent else "-"
        pbone = obj.parent_bone if obj.parent_type == "BONE" else ""
        mods = [m.type for m in obj.modifiers]
        vgs = [g.name for g in obj.vertex_groups]
        nverts = len(obj.data.vertices)
        print(
            f"MESH {obj.name!r} parent={parent} parent_type={obj.parent_type} "
            f"bone={pbone!r} mods={mods} vgroups={len(vgs)} verts={nverts}"
        )
        if vgs:
            print(f"  groups: {', '.join(vgs[:12])}{' ...' if len(vgs) > 12 else ''}")


if __name__ == "__main__":
    main()
