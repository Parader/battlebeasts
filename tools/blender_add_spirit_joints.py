"""
Place emissive orbs on Mixamo joint bones so the gaps read as energy.

Parented to bones (no new weights). Idempotent: replaces spirit_joint_* objects.

    blender hero_bind.blend --background --python tools/blender_add_spirit_joints.py -- `
        --out hero_bind.blend
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PREFIX = "spirit_joint_"

# Parent bone suffix → orb radius as a fraction of body height.
# Parented to the bone TAIL (Blender bone-parent origin), which is the joint.
JOINTS = (
    ("Neck", 0.028),
    ("LeftShoulder", 0.026),
    ("RightShoulder", 0.026),
    ("LeftArm", 0.030),  # elbow
    ("RightArm", 0.030),
    ("LeftForeArm", 0.022),  # wrist
    ("RightForeArm", 0.022),
    ("Spine1", 0.024),
    ("Spine2", 0.022),
    ("LeftUpLeg", 0.032),  # knee
    ("RightUpLeg", 0.032),
    ("LeftLeg", 0.022),  # ankle
    ("RightLeg", 0.022),
    ("Head", 0.018),
)


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Add spirit joint orbs on Mixamo bones")
    p.add_argument("--blend", type=Path, default=None)
    p.add_argument("--out", type=Path, default=None)
    p.add_argument("--scale", type=float, default=0.48, help="Multiply all orb sizes")
    return p.parse_args(argv)


def find_armature():
    import bpy

    preferred = bpy.data.objects.get("Armature")
    if preferred and preferred.type == "ARMATURE":
        return preferred
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("No armature")
    return arms[0]


def find_surface():
    import bpy

    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.name.lower() == "beta_surface":
            return obj
    raise RuntimeError("Beta_Surface not found")


def mesh_height(obj) -> float:
    corners = [obj.matrix_world @ v.co for v in obj.data.vertices]
    zs = [c.z for c in corners]
    return max(zs) - min(zs)


def bone_by_suffix(arm, suffix: str):
    needle = suffix.lower().replace(":", "")
    for b in arm.data.bones:
        n = b.name.lower().replace("mixamorig:", "").replace("mixamorig", "").replace(":", "")
        if n == needle or n.endswith(needle):
            return b
    return None


def joint_material():
    import bpy

    mat = bpy.data.materials.get("SpiritJoint") or bpy.data.materials.new("SpiritJoint")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (280, 0)
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.location = (40, 0)
    emit.inputs["Color"].default_value = (0.35, 0.85, 1.0, 1.0)
    emit.inputs["Strength"].default_value = 12.0
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def clear_old_joints():
    import bpy

    for obj in list(bpy.data.objects):
        if obj.name.startswith(PREFIX):
            bpy.data.objects.remove(obj, do_unlink=True)


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

    arm = find_armature()
    body = find_surface()
    height = mesh_height(body)
    arm_scale = max(arm.matrix_world.to_scale().x, 1e-8)
    mat = joint_material()
    clear_old_joints()

    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    if arm.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    print(f"[joints] armature={arm.name} height={height:.3f} arm_scale={arm_scale:.5f}")

    placed = []
    for suffix, frac in JOINTS:
        bone = bone_by_suffix(arm, suffix)
        if not bone:
            print(f"[joints] !! no bone matching {suffix}")
            continue
        radius_world = height * frac * args.scale
        radius = radius_world / arm_scale
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=(0, 0, 0))
        orb = bpy.context.active_object
        orb.name = f"{PREFIX}{suffix}"
        orb.data.name = orb.name
        orb.data.materials.append(mat)

        # Parent to bone, keep the orb on the bone tail (the joint).
        orb.parent = arm
        orb.parent_type = "BONE"
        orb.parent_bone = bone.name
        orb.location = (0.0, 0.0, 0.0)
        orb.rotation_euler = (0.0, 0.0, 0.0)
        orb.scale = (1.0, 1.0, 1.0)
        placed.append(f"{orb.name} → {bone.name} r_world={radius_world:.3f} r_local={radius:.2f}")

    out = Path(args.out) if args.out else Path(bpy.data.filepath)
    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    print(f"[joints] placed {len(placed)}")
    for line in placed:
        print(f"  {line}")
    print(f"[joints] saved {out}")
    print("[joints] Reload bind file. Orbs sit in the gaps. Scale them in Object Mode if huge/tiny.")


if __name__ == "__main__":
    main()
