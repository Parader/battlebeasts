"""
Migrate embedded hero gear to bone-attached GLBs and author a belt.

Opens the bind-pose workbench, writes apps/web/public/cosmetics/*.glb.
Legs/pants are authored later as a skinned piece — this script does not
invent greaves.

    blender "C:/Users/deric/OneDrive/Documents/mage_trials/player/hero_bind.blend" `
        --background --python tools/blender_migrate_cosmetics.py -- `
        --save
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import blender_export_skin as skin  # noqa: E402

BIND = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero_bind.blend")
GEN_BELT = "Belt set 1"


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Migrate / author cosmetic GLBs from hero_bind")
    p.add_argument("--blend", type=Path, default=BIND)
    p.add_argument("--out-dir", type=Path, default=None)
    p.add_argument("--save", action="store_true", help="Write generated belt into the .blend")
    p.add_argument("--no-save", action="store_true")
    return p.parse_args(argv)


def delete_object(name: str) -> None:
    import bpy

    obj = bpy.data.objects.get(name)
    if obj:
        bpy.data.objects.remove(obj, do_unlink=True)


def copy_materials(src, dest) -> None:
    dest.data.materials.clear()
    if src is None:
        return
    for mat in src.data.materials:
        dest.data.materials.append(mat)


def centroid_world(obj):
    from mathutils import Vector

    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    acc = Vector((0.0, 0.0, 0.0))
    for p in pts:
        acc += p
    return acc / max(len(pts), 1)


def nearest_bone(arm, world_pt, names: tuple[str, ...]) -> str:
    best = names[0]
    best_d = 1e9
    for name in names:
        bone = skin.find_bone(arm, name)
        loc = skin.pose_bone_world(arm, bone).to_translation()
        d = (loc - world_pt).length
        if d < best_d:
            best_d = d
            best = name
    return best


def separate_loose(obj) -> list:
    import bpy

    skin.ensure_object_mode()
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    parts.sort(key=lambda o: len(o.data.vertices), reverse=True)
    return parts


def split_by_world_x(obj) -> list:
    import bmesh
    import bpy

    def half(keep_positive: bool, name: str):
        dup = obj.copy()
        dup.data = obj.data.copy()
        dup.name = name
        bpy.context.scene.collection.objects.link(dup)
        bm = bmesh.new()
        bm.from_mesh(dup.data)
        mw = dup.matrix_world
        doomed = []
        for v in bm.verts:
            x = (mw @ v.co).x
            if keep_positive and x < -1e-5:
                doomed.append(v)
            if not keep_positive and x > 1e-5:
                doomed.append(v)
        bmesh.ops.delete(bm, geom=doomed, context="VERTS")
        bm.to_mesh(dup.data)
        bm.free()
        dup.data.update()
        return dup

    left = half(True, f"{obj.name}_L")
    right = half(False, f"{obj.name}_R")
    bpy.data.objects.remove(obj, do_unlink=True)
    return [left, right]


def source_material_obj():
    import bpy

    for name in ("Chest Set 1", "WizardHat", "Boot1"):
        obj = bpy.data.objects.get(name)
        if obj and obj.data.materials:
            return obj
    return None


def hip_radius(arm, surface) -> float:
    hips = skin.find_bone(arm, "Hips")
    origin = skin.pose_bone_world(arm, hips).to_translation()
    radii = []
    for v in surface.data.vertices:
        w = surface.matrix_world @ v.co
        if abs(w.z - origin.z) < 0.07:
            radii.append(math.hypot(w.x - origin.x, w.y - origin.y))
    return max(radii) * 1.06 if radii else 0.17


def parent_keep_world(obj, arm, bone_name: str) -> None:
    bone = skin.find_bone(arm, bone_name)
    mw = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone.name
    obj.matrix_world = mw


def make_belt(arm, surface, mat_src):
    import bpy

    delete_object(GEN_BELT)
    hips = skin.find_bone(arm, "Hips")
    loc = skin.pose_bone_world(arm, hips).to_translation()
    r = hip_radius(arm, surface)
    bpy.ops.mesh.primitive_torus_add(
        align="WORLD",
        location=loc,
        major_radius=r,
        minor_radius=max(0.018, r * 0.09),
        major_segments=36,
        minor_segments=10,
    )
    obj = bpy.context.active_object
    obj.name = GEN_BELT
    obj.scale.z = 0.42
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    copy_materials(mat_src, obj)
    parent_keep_world(obj, arm, "Hips")
    return obj


def export_one(label: str, mesh_obj, bone: str, out: Path) -> None:
    arm = skin.find_armature()
    snap = skin.snapshot_in_rest(mesh_obj, arm)
    short = skin.export_rigid_glb(snap, bone, out, arm=arm)
    size_kb = out.stat().st_size / 1024
    print(f"[migrate] {label}: {out.name} → {short} ({size_kb:.1f} KB)")


def export_pair(label: str, items: list, out: Path) -> None:
    shorts = skin.export_set(items, out)
    size_kb = out.stat().st_size / 1024
    print(f"[migrate] {label}: {out.name} → {shorts} ({size_kb:.1f} KB)")


def existing_mesh(name: str):
    import bpy

    return bpy.data.objects.get(name)


def main() -> None:
    import bpy

    args = parse_args(sys.argv)
    blend = args.blend.resolve()
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    out_dir = args.out_dir or skin.repo_cosmetics_dir()
    out_dir.mkdir(parents=True, exist_ok=True)

    arm = skin.find_armature()
    surface = bpy.data.objects.get("Beta_Surface")
    if surface is None:
        raise SystemExit("Beta_Surface missing")
    mat_src = source_material_obj()

    jobs_single = [
        ("hat", "WizardHat", "Head", out_dir / "hat_wizard.glb"),
    ]
    for label, mesh_name, bone, dest in jobs_single:
        mesh = skin.find_mesh(mesh_name)
        export_one(label, mesh, bone, dest)

    chest = skin.find_mesh("Chest Set 1")
    skin.export_skinned_glb([chest], out_dir / "chest_set_1.glb")
    size_kb = (out_dir / "chest_set_1.glb").stat().st_size / 1024
    print(f"[migrate] chest (skinned): chest_set_1.glb ({size_kb:.1f} KB)")

    export_pair(
        "shoulders",
        [
            (skin.find_mesh("Shoulder set 1 - 1"), "RightShoulder"),
            (skin.find_mesh("Shoulder set 1 - 2"), "LeftShoulder"),
        ],
        out_dir / "shoulders_set_1.glb",
    )
    export_pair(
        "boots",
        [
            (skin.find_mesh("Boot1"), "LeftFoot"),
            (skin.find_mesh("Boot2"), "RightFoot"),
        ],
        out_dir / "shoes_set_1.glb",
    )

    bracers = skin.find_mesh("Bracers set 1")
    snap = skin.snapshot_in_rest(bracers, arm, "Bracers_split")
    parts = separate_loose(snap)
    if len(parts) < 2:
        print(f"[migrate] bracers loose parts={len(parts)}; splitting on X")
        leftover = parts[0] if parts else snap
        parts = split_by_world_x(leftover)
    else:
        extras = parts[2:]
        parts = parts[:2]
        for extra in extras:
            bpy.data.objects.remove(extra, do_unlink=True)

    assigned = []
    for part in parts:
        bone = nearest_bone(arm, centroid_world(part), ("LeftForeArm", "RightForeArm"))
        assigned.append((part, bone))
    if len({b for _, b in assigned}) < 2:
        print("[migrate] bracer parts mapped to the same bone; using world X")
        assigned.sort(key=lambda pair: centroid_world(pair[0]).x, reverse=True)
        assigned = [(assigned[0][0], "LeftForeArm"), (assigned[1][0], "RightForeArm")]
        for extra in parts[2:]:
            bpy.data.objects.remove(extra, do_unlink=True)

    export_pair("bracers", assigned, out_dir / "bracers_set_1.glb")
    for part, _bone in assigned:
        try:
            bpy.data.objects.remove(part, do_unlink=True)
        except ReferenceError:
            pass

    belt = existing_mesh(GEN_BELT) or make_belt(arm, surface, mat_src)
    export_one("belt", belt, "Hips", out_dir / "belt_set_1.glb")

    leftover_legs = out_dir / "legs_set_1.glb"
    if leftover_legs.is_file():
        leftover_legs.unlink()
        print("[migrate] removed placeholder legs_set_1.glb (pants come later)")

    do_save = args.save and not args.no_save
    if do_save:
        bpy.ops.wm.save_mainfile()
        print(f"[migrate] saved workbench {blend}")

    print("\n[migrate] done. Catalog already lists these files in packages/shared/src/cosmetics.ts")


if __name__ == "__main__":
    main()
