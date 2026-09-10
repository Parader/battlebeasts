"""
Export a skin from the bind-pose workbench as a GLB.

Rigid (default): bake each mesh into bone-local space. A set (L/R shoulders)
goes in one file, objects named after Mixamo bones.

Skinned (`--rig skinned`): keep Mixamo weights and export the armature so the
piece bends on Spine / legs at runtime.

    blender hero_bind.blend --background --python tools/blender_export_skin.py -- `
        --mesh "Chest Set 1" --rig skinned --id chest_set_1 --slot chest

Usage (from the repo root, Blender 5):

    blender "C:/Users/deric/OneDrive/Documents/mage_trials/player/hero_bind.blend" `
        --background --python tools/blender_export_skin.py -- `
        --mesh "Shoulder set 1 - 1,Shoulder set 1 - 2" `
        --bone "RightShoulder,LeftShoulder" --id shoulders_set_1

Drops the GLB in apps/web/public/cosmetics/ and prints a COSMETIC_CATALOG snippet.

Batch export (preferred): `pnpm export:skins` — jobs live in tools/skin_manifest.py
(`rig: "rigid"` = one bone per mesh, `rig: "skinned"` = Mixamo weights).

Albedo maps live in the workbench `player/textures/` folder (packed into
the GLB on export). Source pack: `fantasykingdom/character/gear`. If Blender
shows pink, drop the PNG there and re-run tools/blender_relink_skin_textures.py.
Placement: author on the bind-pose dummy, then nudge in the stand Fit panel
and paste offset/rotation/scale onto the catalog item.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_PUBLIC = Path(r"C:\solo\battlebeasts2\apps\web\public\cosmetics")
PLAYER_WORKBENCH = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player")
TEXTURE_SEARCH_DIRS = (
    PLAYER_WORKBENCH / "textures",
    Path(__file__).resolve().parent / "skin_textures",
    Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\fantasykingdom\character\gear"),
    Path(r"C:\Users\deric\Downloads\assets\textures"),
)

SLOT_FROM_BONE = (
    (("head", "headtop"), "hat"),
    (("shoulder",), "shoulders"),
    (("spine", "chest", "neck"), "chest"),
    (("forearm", "hand", "arm"), "gloves"),
    (("hips",), "belt"),
    (("upleg", "leg"), "legs"),
    (("foot", "toe"), "shoes"),
)


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Export a rigid bone-attached skin GLB")
    p.add_argument("--blend", type=Path, default=None, help="Open this .blend first")
    p.add_argument("--mesh", type=str, default="", help="Mesh object name (default: selection)")
    p.add_argument("--bone", type=str, default="", help="Mixamo bone short name, e.g. Head")
    p.add_argument("--slot", type=str, default="", help="Catalog slot (hat, chest, …)")
    p.add_argument("--id", type=str, default="", help="Catalog id (default: from output stem)")
    p.add_argument("--name", type=str, default="", help="Display name")
    p.add_argument(
        "--allow-skinned",
        action="store_true",
        help="Freeze armature deform at rest, then export as rigid",
    )
    p.add_argument(
        "--rig",
        choices=("rigid", "skinned"),
        default="rigid",
        help="rigid = bone-parented meshes; skinned = live Mixamo weights (chest, pants)",
    )
    p.add_argument(
        "--keep-weights",
        action="store_true",
        help="Skinned export: keep this mesh's painted groups instead of copying the body",
    )
    p.add_argument(
        "--body",
        choices=("any", "female", "male"),
        default="any",
        help="male = Y Bot armature / YBot_Surface, writes <id>_male.glb",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output .glb (default: apps/web/public/cosmetics/<id>.glb)",
    )
    return p.parse_args(argv)


def repo_cosmetics_dir() -> Path:
    here = Path(__file__).resolve().parent
    candidate = here.parent / "apps" / "web" / "public" / "cosmetics"
    if candidate.parent.is_dir():
        return candidate
    return REPO_PUBLIC


def _image_filename(img) -> str:
    import bpy

    raw = (bpy.path.abspath(img.filepath) if img.filepath else "") or img.name
    return Path(raw).name


def _safe_texture_stem(img, hint: str = "") -> str:
    raw = _image_filename(img)
    stem = Path(raw).stem
    generic = not stem or stem.lower().startswith("image")
    if generic:
        parts = [p for p in (hint, img.name) if p]
        stem = "_".join(parts) if parts else "skin"
    return re.sub(r"[^a-zA-Z0-9]+", "_", stem).strip("_") or "skin"


def find_texture_file(name: str) -> Path | None:
    stem = Path(name).stem.lower()
    for folder in TEXTURE_SEARCH_DIRS:
        if not folder.is_dir():
            continue
        direct = folder / name
        if direct.is_file():
            return direct
        for cand in folder.iterdir():
            if cand.is_file() and cand.stem.lower() == stem:
                return cand
    return None


def _workbench_textures_dir():
    import bpy

    if not bpy.data.filepath:
        return None
    blend = Path(bpy.data.filepath).resolve()
    if not blend.parent.is_dir():
        return None
    tex_dir = blend.parent / "textures"
    tex_dir.mkdir(exist_ok=True)
    return tex_dir


def pack_image(img, found: Path | None = None) -> bool:
    import bpy

    if found is not None:
        # Prefer a path next to the blend (`//textures/...`) so Material Preview stays stable.
        tex_dir = _workbench_textures_dir()
        if tex_dir is not None:
            tex_copy = tex_dir / found.name
            if tex_copy.resolve() != found.resolve():
                tex_copy.write_bytes(found.read_bytes())
            img.filepath = bpy.path.relpath(str(tex_copy))
        else:
            img.filepath = str(found)
        img.source = "FILE"
        try:
            img.reload()
        except RuntimeError:
            pass
    if tuple(img.size)[0] <= 0:
        return False
    try:
        img.pack()
    except RuntimeError:
        return False
    return True


def ensure_image_on_disk(img, hint: str = "") -> bool:
    """Khronos GLB export drops packed images that have no filepath (Image_0.001)."""
    import bpy

    tex_dir = _workbench_textures_dir()
    fp = (bpy.path.abspath(img.filepath) if img.filepath else "") or ""
    on_disk = bool(fp) and Path(fp).is_file()
    if on_disk and tuple(img.size)[0] > 0:
        try:
            img.pack()
        except RuntimeError:
            pass
        return True

    if tuple(img.size)[0] <= 0:
        name = _image_filename(img)
        found = find_texture_file(name)
        if found is None:
            print(f"[skin] missing texture {img.name!r} ({name})")
            return False
        ok = pack_image(img, found)
        if ok:
            print(f"[skin] packed {img.name!r} ← {found.name} {tuple(img.size)}")
        else:
            print(f"[skin] failed to load {found}")
        return ok

    if tex_dir is None:
        print(f"[skin] cannot save {img.name!r}: blend has no path")
        return False

    out = tex_dir / f"{_safe_texture_stem(img, hint)}.png"
    try:
        img.file_format = "PNG"
        try:
            img.save(filepath=str(out))
        except TypeError:
            img.filepath_raw = str(out)
            img.save()
        img.source = "FILE"
        img.filepath = bpy.path.relpath(str(out))
        if tuple(img.size)[0] <= 0:
            img.reload()
        img.pack()
        print(f"[skin] wrote {out.name} from packed {img.name!r} {tuple(img.size)}")
        return tuple(img.size)[0] > 0
    except RuntimeError as exc:
        print(f"[skin] failed to save {img.name!r} → {out.name}: {exc}")
        return False


def relink_images(images, *, force: bool = False) -> None:
    """Find missing albedos on disk, point Blender at them, and pack."""
    for img in images:
        if tuple(img.size)[0] > 0 and not force:
            ensure_image_on_disk(img)
            continue
        if not ensure_image_on_disk(img):
            name = _image_filename(img)
            found = find_texture_file(name)
            if found is None:
                continue
            if pack_image(img, found):
                print(f"[skin] packed {img.name!r} ← {found.name} {tuple(img.size)}")
            else:
                print(f"[skin] failed to load {found}")


def relink_and_pack_images(objects: list) -> None:
    """Workbench images are often missing on disk; find them and pack into the GLB."""
    seen = set()
    for obj in objects:
        mats = list(getattr(obj.data, "materials", []) or [])
        if obj.type == "ARMATURE":
            continue
        for mat in mats:
            if not mat or not getattr(mat, "node_tree", None):
                continue
            for node in mat.node_tree.nodes:
                if node.type != "TEX_IMAGE" or not node.image:
                    continue
                if id(node.image) in seen:
                    continue
                seen.add(id(node.image))
                label = (getattr(node, "label", "") or "").strip()
                hint = f"{obj.name}_{label}" if label else obj.name
                ensure_image_on_disk(node.image, hint)


def relink_all_missing_images(*, force: bool = False) -> None:
    import bpy

    skip = {"beta_ao", "beta_roughness"}
    images = [
        img
        for img in bpy.data.images
        if img.name.lower() not in skip and Path(img.filepath).stem.lower() not in {"beta_cavity", "beta_ao", "beta_roughness"}
    ]
    relink_images(images, force=force)


def apply_visual_transform(obj) -> None:
    import bpy

    ensure_object_mode()
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def glb_skin_count(path: Path) -> int:
    import json
    import struct

    data = Path(path).read_bytes()
    chunk_len, _chunk_type = struct.unpack_from("<I4s", data, 12)
    js = data[20 : 20 + chunk_len].rstrip(b"\x00").decode("utf-8")
    return len(json.loads(js).get("skins") or [])


def gltf_export(
    filepath: str,
    *,
    skins: bool,
    yup: bool = True,
    active_collection: bool = False,
) -> None:
    import bpy

    export_kw: dict = {
        "filepath": filepath,
        "export_format": "GLB",
        "use_selection": not active_collection,
        "use_active_collection": active_collection,
        "export_apply": False,
        "export_animations": False,
        "export_skins": skins,
        "export_yup": yup,
        "export_extras": True,
        "export_materials": "EXPORT",
        "export_image_format": "AUTO",
        "export_texcoords": True,
        "export_rest_position_armature": True,
        "export_def_bones": False,
        "export_influence_nb": 8,
    }
    # Never drop export_skins — omitting it used to write mesh-only GLBs.
    optional = (
        "export_all_influences",
        "export_keep_originals",
        "export_extras",
        "export_materials",
        "export_image_format",
        "export_texcoords",
        "export_rest_position_armature",
        "export_def_bones",
        "export_influence_nb",
        "use_active_collection",
    )
    if skins:
        export_kw["export_all_influences"] = True
    while True:
        try:
            bpy.ops.export_scene.gltf(**export_kw)
            return
        except TypeError as exc:
            dropped = False
            for key in optional:
                if key in export_kw:
                    print(f"[skin] glTF dropped {key} ({exc})")
                    export_kw.pop(key)
                    dropped = True
                    break
            if not dropped:
                raise


def with_rest_pose(arm, fn):
    prev = arm.data.pose_position
    arm.data.pose_position = "REST"
    import bpy

    bpy.context.view_layer.update()
    try:
        return fn()
    finally:
        arm.data.pose_position = prev
        bpy.context.view_layer.update()


def bone_suffix(name: str) -> str:
    n = name.lower().replace("mixamorig:", "").replace("mixamorig", "")
    return re.sub(r"[^a-z0-9]", "", n)


def bone_short_name(name: str) -> str:
    short = name.replace("mixamorig:", "").replace("mixamorig", "")
    if short.startswith("_"):
        short = short[1:]
    return short


def guess_slot(bone: str) -> str:
    key = bone_suffix(bone)
    for needles, slot in SLOT_FROM_BONE:
        if any(n in key for n in needles):
            return slot
    return "hat"


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return s or "skin"


def find_armature(body: str | None = None):
    import bpy

    if body == "male":
        male = bpy.data.objects.get("Armature_Male")
        if male and male.type == "ARMATURE":
            return male
        raise RuntimeError(
            "Armature_Male not found — run `pnpm workbench:ybot` to put Y Bot in the bind file"
        )
    preferred = bpy.data.objects.get("Armature")
    if preferred and preferred.type == "ARMATURE":
        return preferred
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("No armature in this file")
    return arms[0]


def find_bone(arm, needle: str):
    want = bone_suffix(needle)
    for b in arm.data.bones:
        if bone_suffix(b.name) == want:
            return b
    names = ", ".join(b.name for b in arm.data.bones)
    raise RuntimeError(f"Bone {needle!r} not found. Bones: {names}")


def find_mesh(name: str):
    import bpy

    if name:
        obj = bpy.data.objects.get(name)
        if obj and obj.type == "MESH":
            return obj
        raise RuntimeError(f"Mesh object {name!r} not found")
    sel = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    if len(sel) == 1:
        return sel[0]
    if bpy.context.view_layer.objects.active and bpy.context.view_layer.objects.active.type == "MESH":
        return bpy.context.view_layer.objects.active
    raise RuntimeError("Pass --mesh or select exactly one mesh")


def is_skinned(obj) -> bool:
    if obj.parent_type == "ARMATURE":
        return True
    for mod in obj.modifiers:
        if mod.type == "ARMATURE":
            return True
    return False


def pose_bone_world(arm, bone):
    pb = arm.pose.bones.get(bone.name)
    if pb is None:
        return arm.matrix_world @ bone.matrix_local
    return arm.matrix_world @ pb.matrix


def ensure_object_mode() -> None:
    import bpy

    try:
        if bpy.context.object and bpy.context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
    except RuntimeError:
        pass


def snapshot_evaluated(obj, name: str | None = None):
    """New mesh object with modifiers/armature applied, original left untouched."""
    import bpy

    deps = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(deps)
    mesh = bpy.data.meshes.new_from_object(
        eval_obj, preserve_all_data_layers=True, depsgraph=deps
    )
    snap = bpy.data.objects.new(name or f"{obj.name}_export", mesh)
    bpy.context.scene.collection.objects.link(snap)
    snap.matrix_world = eval_obj.matrix_world.copy()
    for mat in obj.data.materials:
        if mat and mat.name not in [m.name for m in snap.data.materials if m]:
            snap.data.materials.append(mat)
    if not snap.data.materials and obj.data.materials:
        for mat in obj.data.materials:
            snap.data.materials.append(mat)
    return snap


def bake_to_bone_local(mesh_obj, bone_name: str, arm=None) -> str:
    """Unparent, bake verts into bone space, identity transform, name the object after the bone."""
    import bpy
    from mathutils import Matrix

    arm = arm or find_armature()
    bone = find_bone(arm, bone_name)
    short = bone_short_name(bone.name)

    ensure_object_mode()
    bone_world = pose_bone_world(arm, bone)
    local: Matrix = bone_world.inverted() @ mesh_obj.matrix_world
    mesh_obj.parent = None
    mesh_obj.parent_type = "OBJECT"
    mesh_obj.parent_bone = ""
    for mod in list(mesh_obj.modifiers):
        mesh_obj.modifiers.remove(mod)
    while mesh_obj.vertex_groups:
        mesh_obj.vertex_groups.remove(mesh_obj.vertex_groups[0])
    mesh_obj.matrix_world = local

    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    ensure_object_mode()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    mesh_obj.name = short
    mesh_obj["bb_bone"] = short
    return short


def export_objects_glb(objects: list, out_path: Path) -> None:
    import bpy

    if not objects:
        raise RuntimeError("Nothing to export")
    out_path = out_path.resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    relink_and_pack_images(objects)
    ensure_object_mode()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    # Bone-local meshes already match Mixamo bone axes. export_yup would
    # rotate verts as if they were world Z-up and twist them on the live rig.
    gltf_export(str(out_path), skins=False, yup=False)


def export_rigid_glb(mesh_obj, bone_name: str, out_path: Path, arm=None) -> str:
    """Bake one mesh into bone-local space and write a mesh-only GLB. Deletes mesh_obj."""
    import bpy

    arm = arm or find_armature()

    def _run() -> str:
        short = bake_to_bone_local(mesh_obj, bone_name, arm)
        export_objects_glb([mesh_obj], out_path)
        bpy.data.objects.remove(mesh_obj, do_unlink=True)
        return short

    return with_rest_pose(arm, _run)


def find_surface(body: str | None = None):
    import bpy

    want = "ybot_surface" if body == "male" else "beta_surface"
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.name.lower() == want:
            return obj
    return None


def prune_empty_vgroups(obj) -> None:
    used = {g.group for v in obj.data.vertices for g in v.groups}
    unused = [vg.name for vg in obj.vertex_groups if vg.index not in used]
    for name in unused:
        obj.vertex_groups.remove(obj.vertex_groups[name])


def _eval_visibility_state(obj):
    """Snapshot hide/exclude flags so Data Transfer can sample a body-preview dummy."""
    import bpy

    state = {
        "hide_viewport": obj.hide_viewport,
        "hide_get": obj.hide_get(),
        "collections": [],
    }
    want = set(obj.users_collection)
    seen: set[int] = set()

    def walk(lc, stack):
        path = stack + [lc]
        if lc.collection in want:
            for node in path:
                nid = id(node)
                if nid in seen:
                    continue
                seen.add(nid)
                state["collections"].append(
                    {
                        "lc": node,
                        "exclude": bool(getattr(node, "exclude", False)),
                        "hide_viewport": node.hide_viewport,
                        "col_hide": node.collection.hide_viewport,
                    }
                )
        for child in lc.children:
            walk(child, path)

    walk(bpy.context.view_layer.layer_collection, [])
    return state


def _reveal_for_eval(obj, state) -> None:
    import bpy

    obj.hide_viewport = False
    obj.hide_set(False)
    for row in state["collections"]:
        lc = row["lc"]
        if hasattr(lc, "exclude"):
            lc.exclude = False
        lc.hide_viewport = False
        lc.collection.hide_viewport = False
    bpy.context.view_layer.update()


def _restore_eval_visibility(obj, state) -> None:
    import bpy

    obj.hide_viewport = state["hide_viewport"]
    obj.hide_set(state["hide_get"])
    for row in state["collections"]:
        lc = row["lc"]
        if hasattr(lc, "exclude"):
            lc.exclude = row["exclude"]
        lc.hide_viewport = row["hide_viewport"]
        lc.collection.hide_viewport = row["col_hide"]
    bpy.context.view_layer.update()


def _fill_unweighted_from_source(dest, src) -> int:
    """Copy groups onto dest verts that the modifier missed (nearest source vert)."""
    from mathutils import kdtree

    src_verts = src.data.vertices
    if not src_verts:
        return 0
    tree = kdtree.KDTree(len(src_verts))
    smw = src.matrix_world
    for i, v in enumerate(src_verts):
        tree.insert(smw @ v.co, i)
    tree.balance()

    for vg in src.vertex_groups:
        if dest.vertex_groups.get(vg.name) is None:
            dest.vertex_groups.new(name=vg.name)

    src_index_to_name = {vg.index: vg.name for vg in src.vertex_groups}
    dmw = dest.matrix_world
    filled = 0
    for dv in dest.data.vertices:
        if dv.groups:
            continue
        _co, idx, _dist = tree.find(dmw @ dv.co)
        sv = src_verts[idx]
        assigned = False
        for g in sv.groups:
            name = src_index_to_name.get(g.group)
            if not name or g.weight <= 0:
                continue
            dest.vertex_groups[name].add([dv.index], g.weight, "REPLACE")
            assigned = True
        if assigned:
            filled += 1
    return filled


def _assign_fallback_bone(dest, src) -> int:
    name = None
    for cand in (
        "mixamorig:Spine2",
        "mixamorig:Spine1",
        "mixamorig:Spine",
        "mixamorig:Hips",
        "Spine2",
        "Hips",
    ):
        if dest.vertex_groups.get(cand) or src.vertex_groups.get(cand):
            name = cand
            break
    if name is None and src.vertex_groups:
        name = src.vertex_groups[0].name
    if name is None:
        return 0
    vg = dest.vertex_groups.get(name) or dest.vertex_groups.new(name=name)
    leftover = [v.index for v in dest.data.vertices if not v.groups]
    if leftover:
        vg.add(leftover, 1.0, "REPLACE")
    return len(leftover)


def transfer_weights_from_body(dest, src) -> int:
    """Copy Mixamo vertex groups from the body onto dest. Returns weighted vert count."""
    import bpy

    ensure_object_mode()
    vis = _eval_visibility_state(src)
    try:
        _reveal_for_eval(src, vis)
        # object.data_transfer often finishes with 0 weights; the modifier does the job.
        dest.modifiers.clear()
        mod = dest.modifiers.new("WeightTransfer", "DATA_TRANSFER")
        mod.object = src
        mod.use_vert_data = True
        mod.data_types_verts = {"VGROUP_WEIGHTS"}
        mod.vert_mapping = "NEAREST"
        mod.layers_vgroup_select_src = "ALL"
        mod.layers_vgroup_select_dst = "NAME"
        if hasattr(mod, "mix_mode"):
            mod.mix_mode = "REPLACE"
        if hasattr(mod, "use_max_distance"):
            mod.use_max_distance = False
        if hasattr(mod, "use_object_transform"):
            mod.use_object_transform = True

        bpy.ops.object.select_all(action="DESELECT")
        dest.select_set(True)
        bpy.context.view_layer.objects.active = dest
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except RuntimeError as exc:
            print(f"[skin] weight modifier apply failed ({exc}); filling from nearest verts")
            if dest.modifiers.get(mod.name):
                dest.modifiers.remove(dest.modifiers[mod.name])

        filled = _fill_unweighted_from_source(dest, src)
        if filled:
            print(f"[skin] filled {filled} leftover verts from nearest {src.name}")
        leftover = _assign_fallback_bone(dest, src)
        if leftover:
            print(f"[skin] assigned {leftover} isolated verts to a spine/hips group")
        prune_empty_vgroups(dest)
        return weighted_vert_count(dest)
    finally:
        _restore_eval_visibility(src, vis)


def weighted_vert_count(obj) -> int:
    return sum(1 for v in obj.data.vertices if v.groups)


def _activate_collection(col) -> None:
    import bpy

    def find_lc(lc, name):
        if lc.collection.name == name:
            return lc
        for child in lc.children:
            found = find_lc(child, name)
            if found:
                return found
        return None

    layer = find_lc(bpy.context.view_layer.layer_collection, col.name)
    if layer is None:
        raise RuntimeError(f"Collection {col.name!r} is not in the view layer")
    bpy.context.view_layer.active_layer_collection = layer


def export_skinned_glb(
    mesh_objs: list,
    out_path: Path,
    arm=None,
    *,
    keep_weights: bool = False,
    body: str = "any",
) -> list[str]:
    """Export mesh(es) + Mixamo armature with weights. Does not freeze to one bone."""
    import bpy

    body_key = "male" if body == "male" else None
    arm = arm or find_armature(body_key)
    surface = find_surface(body_key)
    if not keep_weights and surface is None:
        need = "YBot_Surface" if body == "male" else "Beta_Surface"
        raise RuntimeError(f"{need} required to transfer Mixamo weights")

    prev_pose = arm.data.pose_position
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()

    snaps = []
    export_arm = None
    export_col = None
    try:
        export_col = bpy.data.collections.new("_bb_skin_export")
        bpy.context.scene.collection.children.link(export_col)
        # Own armature object (same bones) so the glTF tree is just clothing + rig.
        # Selecting the live Armature pulls in Beta_Surface/boots and Khronos
        # drops skins ("Armature must be the parent of skinned mesh").
        # Duplicate data — sharing Armature_Male while it sits in a hidden
        # collection made Khronos write scale 1 and the shop preview shrank
        # the mesh to a speck. Match the female Mixamo object transform (0.01)
        # so runtime rebind onto hero.glb stays in the same space as ybot.glb.
        host_arm = find_armature(None)
        export_arm = arm.copy()
        export_arm.data = arm.data.copy()
        export_arm.name = "Armature_export"
        export_col.objects.link(export_arm)
        export_arm.matrix_world = host_arm.matrix_world.copy()
        bpy.context.view_layer.update()
        print(
            f"[skin] export armature {export_arm.name!r} "
            f"scale={tuple(round(c, 4) for c in export_arm.scale)}"
        )

        for mesh in mesh_objs:
            snap = mesh.copy()
            snap.data = mesh.data.copy()
            snap.name = mesh.name
            export_col.objects.link(snap)
            # Bone-parented armor is in meters; unparent so transfer uses world space.
            mw = mesh.matrix_world.copy()
            snap.parent = None
            snap.parent_type = "OBJECT"
            snap.parent_bone = ""
            snap.matrix_world = mw
            bpy.context.view_layer.update()
            nverts = len(snap.data.vertices)
            if keep_weights:
                for mod in list(snap.modifiers):
                    snap.modifiers.remove(mod)
                weighted = weighted_vert_count(snap)
                print(f"[skin] {mesh.name!r} kept painted weights on {weighted}/{nverts} verts")
                if weighted == 0:
                    raise RuntimeError(
                        f"{mesh.name!r} has no painted vertex groups. "
                        "Weight paint it, or turn off Keep painted weights."
                    )
            else:
                weighted = transfer_weights_from_body(snap, surface)
                print(f"[skin] {mesh.name!r} transferred weights onto {weighted}/{nverts} verts")
                if weighted < nverts:
                    raise RuntimeError(
                        f"{mesh.name!r} weight transfer incomplete ({weighted}/{nverts})"
                    )
            # Bake object scale/placement into verts so Mixamo 0.01 isn't lost.
            apply_visual_transform(snap)
            world = snap.matrix_world.copy()
            snap.parent = export_arm
            snap.parent_type = "OBJECT"
            snap.parent_bone = ""
            snap.matrix_world = world
            bpy.context.view_layer.update()
            apply_visual_transform(snap)
            arm_mod = snap.modifiers.new("Armature", "ARMATURE")
            arm_mod.object = export_arm
            arm_mod.use_vertex_groups = True
            arm_mod.show_viewport = True
            arm_mod.show_render = True
            snaps.append(snap)

        relink_and_pack_images(snaps)
        ensure_object_mode()
        _activate_collection(export_col)
        bpy.ops.object.select_all(action="DESELECT")
        export_arm.select_set(True)
        for snap in snaps:
            vgs = [vg.name for vg in snap.vertex_groups]
            mods = [m.type for m in snap.modifiers]
            print(
                f"[skin] export {snap.name!r} parent={getattr(snap.parent, 'name', None)} "
                f"mods={mods} groups={len(vgs)} {vgs[:8]}"
            )
            snap.select_set(True)
        bpy.context.view_layer.objects.active = export_arm

        out_path = out_path.resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        gltf_export(str(out_path), skins=True, yup=True, active_collection=True)
        nskins = glb_skin_count(out_path)
        if nskins < 1:
            raise RuntimeError(
                f"{out_path.name} wrote 0 skins (mesh-only). "
                "Armature + vertex groups must be in the export selection."
            )
    finally:
        for snap in snaps:
            bpy.data.objects.remove(snap, do_unlink=True)
        export_data = export_arm.data if export_arm is not None else None
        if export_arm is not None:
            bpy.data.objects.remove(export_arm, do_unlink=True)
        if export_data is not None and export_data.users == 0:
            bpy.data.armatures.remove(export_data)
        if export_col is not None:
            bpy.data.collections.remove(export_col)
        arm.data.pose_position = prev_pose
        bpy.context.view_layer.update()

    return [m.name for m in mesh_objs]


def export_set(items: list, out_path: Path, arm=None) -> list[str]:
    """Bake many (mesh, bone) pairs into one GLB. Objects named after bones."""
    import bpy

    arm = arm or find_armature()

    def _run() -> list[str]:
        baked = []
        shorts: list[str] = []
        for src, bone_name in items:
            snap = snapshot_evaluated(src)
            shorts.append(bake_to_bone_local(snap, bone_name, arm))
            baked.append(snap)
        export_objects_glb(baked, out_path)
        for obj in baked:
            bpy.data.objects.remove(obj, do_unlink=True)
        return shorts

    return with_rest_pose(arm, _run)


def export_named_mesh(mesh_name: str, bone_name: str, out_path: Path, allow_skinned: bool = False) -> str:
    mesh = find_mesh(mesh_name)
    if is_skinned(mesh) and not allow_skinned:
        raise SystemExit(
            f"{mesh.name!r} is skinned (Armature parent/modifier). "
            "Re-run with --allow-skinned to freeze rest pose, or parent to a bone."
        )
    snap = snapshot_evaluated(mesh)
    return export_rigid_glb(snap, bone_name, out_path)


def print_catalog_snippet(
    item_id: str,
    slot: str,
    display: str,
    file_name: str,
    bones: list[str],
    rig: str = "rigid",
    body: str = "any",
) -> None:
    if body == "male":
        print("[skin] male cut — add on the existing catalog row (same shop SKU):\n")
        print(f'    fileMale: "{file_name}",')
        print("\n[skin] or a male-only item:\n")
        print(f"  {item_id}: {{")
        print(f'    id: "{item_id}",')
        print(f'    slot: "{slot}",')
        print(f'    name: "{display}",')
        print(f'    file: "{file_name}",')
        print('    body: "male",')
        if rig == "skinned":
            print('    rig: "skinned",')
            if bones:
                listed = ", ".join(f'"{b}"' for b in bones)
                print(f"    bones: [{listed}],")
        elif len(bones) == 1:
            print(f'    bone: "{bones[0]}",')
        elif bones:
            listed = ", ".join(f'"{b}"' for b in bones)
            print(f"    bones: [{listed}],")
        print("  },")
        print("\n[skin] do not add this mesh to hero.glb / hero.blend.")
        return

    print("[skin] catalog snippet — paste into packages/shared/src/cosmetics.ts:\n")
    print(f"  {item_id}: {{")
    print(f'    id: "{item_id}",')
    print(f'    slot: "{slot}",')
    print(f'    name: "{display}",')
    print(f'    file: "{file_name}",')
    if rig == "skinned":
        print('    rig: "skinned",')
        if bones:
            listed = ", ".join(f'"{b}"' for b in bones)
            print(f"    bones: [{listed}],")
    elif len(bones) == 1:
        print(f'    bone: "{bones[0]}",')
    elif bones:
        listed = ", ".join(f'"{b}"' for b in bones)
        print(f"    bones: [{listed}],")
    print("  },")
    print("\n[skin] do not add this mesh to hero.glb / hero.blend.")


def main() -> None:
    import bpy

    args = parse_args(sys.argv)
    if args.blend:
        bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()))

    mesh_names = [s.strip() for s in args.mesh.split(",") if s.strip()] if args.mesh else []
    bone_names = [s.strip() for s in args.bone.split(",") if s.strip()] if args.bone else []
    if not mesh_names:
        mesh_names = [find_mesh("").name]

    item_id = slug(args.id or (args.out.stem if args.out else mesh_names[0]))
    display = args.name or item_id.replace("_", " ")
    body = args.body
    default_name = f"{item_id}_male.glb" if body == "male" else f"{item_id}.glb"
    out = args.out or (repo_cosmetics_dir() / default_name)
    if out.suffix.lower() != ".glb":
        out = out.with_suffix(".glb")

    if args.rig == "skinned":
        meshes = [find_mesh(m) for m in mesh_names]
        export_skinned_glb(meshes, out, keep_weights=args.keep_weights, body=body)
        slot = args.slot or "chest"
        size_kb = out.stat().st_size / 1024
        print(f"\n[skin] wrote skinned {out} ({size_kb:.1f} KB)")
        print_catalog_snippet(
            item_id,
            slot,
            display,
            out.name,
            bone_names or ["Spine", "Spine1", "Spine2"],
            rig="skinned",
            body=body,
        )
        return

    if len(mesh_names) > 1:
        if len(bone_names) != len(mesh_names):
            raise SystemExit("--bone must list one bone per --mesh (comma-separated)")
        slot = args.slot or guess_slot(bone_names[0])
        items = [(find_mesh(m), b) for m, b in zip(mesh_names, bone_names)]
        shorts = export_set(items, out, arm=find_armature("male" if body == "male" else None))
        size_kb = out.stat().st_size / 1024
        print(f"\n[skin] wrote {out} ({size_kb:.1f} KB) bones={shorts}")
        print_catalog_snippet(item_id, slot, display, out.name, shorts, body=body)
        return

    mesh = find_mesh(mesh_names[0])
    bone_name = bone_names[0] if bone_names else ""
    if not bone_name:
        if mesh.parent_type == "BONE" and mesh.parent_bone:
            bone_name = mesh.parent_bone
        else:
            raise SystemExit("Pass --bone (e.g. Head, Spine2, LeftArm)")

    slot = args.slot or guess_slot(bone_name)
    arm = find_armature("male" if body == "male" else None)
    if is_skinned(mesh) and not args.allow_skinned:
        raise SystemExit(
            f"{mesh.name!r} is skinned (Armature parent/modifier). "
            "Re-run with --allow-skinned to freeze rest pose, or parent to a bone."
        )
    snap = snapshot_evaluated(mesh)
    short = export_rigid_glb(snap, bone_name, out, arm=arm)
    size_kb = out.stat().st_size / 1024
    print(f"\n[skin] wrote {out} ({size_kb:.1f} KB)")
    print_catalog_snippet(item_id, slot, display, out.name, [short], body=body)


if __name__ == "__main__":
    main()
