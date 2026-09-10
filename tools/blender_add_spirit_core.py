"""
Add a smaller inner core under Beta_Surface so Mixamo gaps show energy.

Duplicate keeps the Mixamo weights / armature. Shrinks along normals.
Does not touch hero.blend or hero.glb.

    blender hero_bind.blend --background --python tools/blender_add_spirit_core.py -- `
        --out hero_bind.blend
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

CORE_NAME = "Beta_Core"


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Duplicate Beta_Surface as an inner emissive core")
    p.add_argument("--blend", type=Path, default=None)
    p.add_argument("--out", type=Path, default=None)
    p.add_argument(
        "--inset",
        type=float,
        default=0.015,
        help="Inset as a fraction of body height (default 0.015 = 1.5%)",
    )
    return p.parse_args(argv)


def find_surface():
    import bpy

    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.name.lower() == "beta_surface":
            return obj
    raise RuntimeError("Beta_Surface not found")


def mesh_height(obj) -> float:
    import bpy

    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    corners = [obj.matrix_world @ v.co for v in ev.data.vertices]
    ys = [c.z for c in corners]  # glTF/Y-up bind is still Z-up in Blender
    return max(ys) - min(ys)


def build_core_material():
    import bpy

    mat = bpy.data.materials.get("SpiritCore") or bpy.data.materials.new("SpiritCore")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (280, 0)
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.location = (40, 0)
    emit.inputs["Color"].default_value = (0.45, 0.82, 1.0, 1.0)
    emit.inputs["Strength"].default_value = 8.0
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    if hasattr(mat, "blend_method"):
        mat.blend_method = "OPAQUE"
    return mat


def main() -> None:
    import bpy

    args = parse_args(sys.argv)
    if args.blend:
        blend = Path(args.blend)
        if not blend.is_file():
            raise SystemExit(f"Blend not found: {blend}")
        bpy.ops.wm.open_mainfile(filepath=str(blend))

    if not bpy.data.filepath:
        raise SystemExit("No .blend is open.")

    existing = bpy.data.objects.get(CORE_NAME)
    if existing:
        bpy.data.objects.remove(existing, do_unlink=True)
        print(f"[core] replaced existing {CORE_NAME}")

    body = find_surface()
    height = mesh_height(body)
    inset = max(height * args.inset, 0.008)
    print(f"[core] {body.name} height={height:.3f}  inset={inset:.4f}")

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.duplicate()
    core = bpy.context.active_object
    core.name = CORE_NAME
    core.data.name = CORE_NAME

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.transform.shrink_fatten(value=-inset, use_even_offset=True)
    bpy.ops.object.mode_set(mode="OBJECT")

    mat = build_core_material()
    core.data.materials.clear()
    core.data.materials.append(mat)

    # Draw under the shell so rims still belong to Beta_Surface.
    core.pass_index = 1
    print(f"[core] armature parent={core.parent.name if core.parent else 'none'}")
    print(f"[core] modifiers={[m.type for m in core.modifiers]}")

    out = Path(args.out) if args.out else Path(bpy.data.filepath)
    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    print(f"[core] saved {out}")
    print("[core] Reload bind file. Gaps should show a cyan inner body. Delete Beta_Core if you hate it.")


if __name__ == "__main__":
    main()
