"""
Battle Beasts skin tags — View3D → Sidebar (N) → Character → Skins.

Mark a mesh:
  Rig = Skinned   → Mixamo weights, remounted on the live hero skeleton
  Rig = One bone  → leftover bake (export still ships skinned)

Export from this panel (all tagged, or only new/changed), or `pnpm export:skins`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from bpy.props import BoolProperty, EnumProperty, PointerProperty, StringProperty
from bpy.types import Operator, Panel, PropertyGroup

bl_info = {
    "name": "Battle Beasts Skins",
    "author": "Battle Beasts",
    "version": (1, 6, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > Character > Skins",
    "category": "Character",
}

SLOTS = (
    ("hat", "Hat", ""),
    ("shoulders", "Shoulders", ""),
    ("chest", "Chest", ""),
    ("gloves", "Bracers", ""),
    ("belt", "Belt", ""),
    ("legs", "Legs", ""),
    ("shoes", "Boots", ""),
)

BODIES = (
    ("any", "Any", "One cut for both vessels; skinned weights from Beta_Surface"),
    ("female", "Female", "Female cut — Beta_Surface / Armature"),
    ("male", "Male", "Male cut — Y Bot. Same catalog id writes *_male.glb"),
)

COL_FEMALE = "Body Female"
COL_MALE = "Body Male"


def _tools_dir() -> Path:
    here = Path(__file__).resolve().parent
    if (here / "blender_export_skin.py").is_file():
        return here
    repo = Path(r"C:\solo\battlebeasts2\tools")
    if (repo / "blender_export_skin.py").is_file():
        return repo
    raise RuntimeError("tools/blender_export_skin.py not found")


def _ensure_tools_path() -> Path:
    tools = _tools_dir()
    if str(tools) not in sys.path:
        sys.path.insert(0, str(tools))
    return tools


def _set_collection_visible(name: str, visible: bool) -> None:
    col = bpy.data.collections.get(name)
    if col is None:
        return
    col.hide_viewport = not visible
    col.hide_render = not visible

    def walk(lc) -> bool:
        if lc.collection == col:
            lc.hide_viewport = not visible
            return True
        for child in lc.children:
            if walk(child):
                return True
        return False

    walk(bpy.context.view_layer.layer_collection)


def _on_body_preview(self, context):
    try:
        _ensure_tools_path()
        import importlib
        import blender_export_skin as skin

        importlib.reload(skin)
        skin.reveal_bind_dummies()
        skin.align_male_armature_to_host()
        skin.apply_body_preview(self.body_preview)
    except Exception as exc:
        print(f"[skins] body preview failed: {exc}")


def _on_pose_preview(self, context):
    try:
        _ensure_tools_path()
        import importlib
        import blender_bind_idle as idle
        import blender_export_skin as skin

        importlib.reload(skin)
        importlib.reload(idle)
        idle.apply_pose_preview(self.pose_preview)
        skin.apply_body_preview(self.body_preview)
    except Exception as exc:
        print(f"[skins] pose preview failed: {exc}")


class BB_SceneSettings(PropertyGroup):
    body_preview: EnumProperty(
        name="Body",
        description="Show female dummy, Y Bot, or both",
        items=(
            ("female", "Female", "Beta_Surface"),
            ("male", "Male", "Y Bot"),
            ("both", "Both", "Both bodies at the origin"),
        ),
        default="female",
        update=_on_body_preview,
    )
    pose_preview: EnumProperty(
        name="Pose",
        description="Rest = export. T-Pose = hero.blend Mixamo clip. Idle = game. Does not change Female/Male.",
        items=(
            ("rest", "Rest", "Armature bind — what export bakes"),
            ("tpose", "T-Pose", "hero.blend Mixamo T-Pose (1.55cm vs Rest)"),
            ("idle", "Idle", "hero.glb idle — how hats sit in game"),
        ),
        default="tpose",
        update=_on_pose_preview,
    )


def _bone_items(self, context):
    items = [("NONE", "(none)", "Leave empty when Rig is Skinned")]
    try:
        _ensure_tools_path()
        import blender_export_skin as skin

        arm = skin.find_armature()
    except Exception:
        return items
    seen = {"NONE"}
    for bone in arm.data.bones:
        short = skin.bone_short_name(bone.name)
        if short in seen:
            continue
        seen.add(short)
        items.append((short, short, bone.name))
    return items


SKINNED_SLOTS = frozenset({"hat", "shoulders", "chest", "gloves", "belt", "legs", "shoes"})


def _on_catalog_id(self, context):
    try:
        _ensure_tools_path()
        from skin_manifest import slot_from_id

        slot = slot_from_id(self.catalog_id)
    except Exception:
        return
    if not slot:
        return
    obj = getattr(self, "id_data", None)

    def apply():
        try:
            settings = obj.bb_skin if obj is not None else self
            settings.slot = slot
            if slot in SKINNED_SLOTS:
                settings.rig = "skinned"
        except Exception:
            pass
        return None

    try:
        bpy.app.timers.register(apply, first_interval=0.0)
    except Exception:
        apply()


class BB_SkinSettings(PropertyGroup):
    export: BoolProperty(
        name="Export this mesh",
        description="Include in Export all tagged / Export new & changed",
        default=False,
    )
    catalog_id: StringProperty(
        name="Catalog ID",
        description="Must match cosmetics.ts (shoes_set_1). Same ID on L/R meshes = one GLB",
        default="",
        update=_on_catalog_id,
    )
    body: EnumProperty(
        name="Body",
        description="Male cut uses Y Bot and writes <id>_male.glb (fileMale on the same shop SKU)",
        items=BODIES,
        default="any",
    )
    slot: EnumProperty(name="Slot", items=SLOTS, default="hat")
    rig: EnumProperty(
        name="Rig",
        items=(
            (
                "skinned",
                "Skinned",
                "Copy Mixamo weights and remount on the live hero skeleton",
            ),
            (
                "rigid",
                "One bone",
                "Leftover bake — export still ships skinned",
            ),
        ),
        default="skinned",
    )
    keep_weights: BoolProperty(
        name="Keep painted weights",
        description="Skip copying the body. Use this for baggy cloth — body-copied weights hug the dummy and clip",
        default=False,
    )
    bone: EnumProperty(
        name="Bone",
        description="Mixamo bone for One bone rig. Unused when Skinned (weights come from the body)",
        items=_bone_items,
    )
    file: StringProperty(
        name="GLB file",
        description="Written to apps/web/public/cosmetics/",
        default="",
    )
    prep: EnumProperty(
        name="Prep",
        items=(
            ("none", "None", ""),
            ("split_lr_forearms", "Split L/R forearms", "One mesh → two bracers"),
        ),
        default="none",
    )
    export_fp: StringProperty(
        name="Export fingerprint",
        description="Filled after a successful export; used by Export new & changed",
        default="",
        options={"HIDDEN"},
    )


def _active_mesh(context):
    obj = context.object
    if obj is not None and obj.type == "MESH":
        return obj
    return None


def _stamp_object(obj, spec: dict, bone: str) -> None:
    s = obj.bb_skin
    keep = s.keep_weights
    s.export = True
    s.catalog_id = spec["id"]
    s.slot = spec.get("slot", "hat")
    s.rig = spec.get("rig", "skinned")
    s.file = spec.get("file", f"{spec['id']}.glb")
    s.prep = spec.get("prep") or "none"
    s.keep_weights = keep or bool(spec.get("keep_weights"))
    try:
        s.body = spec.get("body") or "any"
    except TypeError:
        pass
    if bone and bone != "NONE":
        try:
            s.bone = bone
        except TypeError:
            pass


class BB_OT_bind_game_rig(Operator):
    bl_idname = "bb.bind_game_rig"
    bl_label = "Follow bones (game rig)"
    bl_description = "Bone-parent rigid skins and copy Mixamo weights onto skinned skins so Idle deforms like the game"

    def execute(self, context):
        try:
            _ensure_tools_path()
            import importlib
            import blender_bind_idle as idle
            import blender_export_skin as skin

            importlib.reload(skin)
            importlib.reload(idle)
            notes = idle.bind_skins_for_game_preview(force=True)
            idle.apply_pose_preview(getattr(context.scene.bb_skins, "pose_preview", "idle") or "idle")
            skin.apply_body_preview(getattr(context.scene.bb_skins, "body_preview", "female") or "female")
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            print(f"[skins] follow bones failed: {exc}")
            return {"CANCELLED"}
        self.report({"INFO"}, f"Rigged {len(notes)} mesh(es) like the game")
        return {"FINISHED"}


class BB_OT_stamp_known_skins(Operator):
    bl_idname = "bb.stamp_known_skins"
    bl_label = "Tag known skins"
    bl_description = "Fill tags on meshes that already match the catalog (Boot Set 1, Chest Set 1, …)"

    def execute(self, context):
        _ensure_tools_path()
        from skin_manifest import SKINS

        tagged = 0
        for spec in SKINS:
            meshes = list(spec["meshes"])
            bones = list(spec.get("bones") or [])
            for i, name in enumerate(meshes):
                obj = bpy.data.objects.get(name)
                if obj is None or obj.type != "MESH":
                    continue
                bone = bones[i] if spec.get("rig") == "rigid" and i < len(bones) else "NONE"
                _stamp_object(obj, spec, bone)
                tagged += 1
        self.report({"INFO"}, f"Tagged {tagged} mesh(es)")
        return {"FINISHED"}


class BB_OT_export_skins(Operator):
    bl_idname = "bb.export_skins"
    bl_label = "Export skins"
    bl_description = "Write public/cosmetics GLBs from tagged meshes"

    only_active: BoolProperty(default=False)
    only_stale: BoolProperty(default=False)

    def execute(self, context):
        try:
            return self._export(context)
        except Exception as exc:
            import traceback

            traceback.print_exc()
            self.report({"ERROR"}, str(exc))
            print(f"[skins] export failed: {exc}")
            return {"CANCELLED"}

    def _export(self, context):
        _ensure_tools_path()
        import importlib
        import blender_export_skin as skin
        import blender_export_skins as batch

        importlib.reload(skin)
        importlib.reload(batch)

        only = ""
        if self.only_active:
            obj = _active_mesh(context)
            if obj is None or not obj.bb_skin.catalog_id.strip():
                self.report({"ERROR"}, "Select a tagged mesh")
                return {"CANCELLED"}
            only = obj.bb_skin.catalog_id.strip()
        jobs = batch.collect_jobs(only)
        if not jobs:
            self.report({"ERROR"}, "No tagged skins. Enable Export this mesh, or Tag known skins.")
            return {"CANCELLED"}
        out_dir = skin.repo_cosmetics_dir()
        if self.only_stale:
            jobs = batch.filter_stale_jobs(jobs, out_dir)
            if not jobs:
                self.report({"INFO"}, "Nothing new or changed")
                return {"FINISHED"}
        failed = batch.run_jobs(jobs, out_dir)
        if failed:
            self.report({"ERROR"}, failed[0])
            return {"CANCELLED"}
        self.report({"INFO"}, f"Exported {len(jobs)} skin(s)")
        return {"FINISHED"}


class BB_PT_skins(Panel):
    bl_label = "Skins"
    bl_idname = "BB_PT_skins"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Character"

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        if hasattr(scene, "bb_skins"):
            row = layout.row(align=True)
            row.prop(scene.bb_skins, "body_preview", expand=True)
            row = layout.row(align=True)
            row.prop(scene.bb_skins, "pose_preview", expand=True)
            layout.label(text="Rest = place. Idle = game (planted hips). Gender stays put.")
            layout.operator("bb.bind_game_rig", icon="ARMATURE_DATA")

        box = layout.box()
        col = box.column(align=True)
        col.scale_y = 1.55
        op = col.operator("bb.export_skins", text="Export all tagged", icon="EXPORT")
        op.only_active = False
        op.only_stale = False
        op = col.operator("bb.export_skins", text="Export new & changed", icon="FILE_REFRESH")
        op.only_active = False
        op.only_stale = True
        this = col.row(align=True)
        this.enabled = bool(_active_mesh(context) and _active_mesh(context).bb_skin.catalog_id.strip())
        op = this.operator("bb.export_skins", text="Export this set", icon="MESH_DATA")
        op.only_active = True
        op.only_stale = False

        obj = _active_mesh(context)
        if obj is None:
            layout.label(text="Select a gear mesh to tag it")
            layout.operator("bb.stamp_known_skins", icon="BOOKMARKS")
            return

        s = obj.bb_skin
        layout.label(text=obj.name, icon="MESH_DATA")
        layout.prop(s, "export")
        layout.prop(s, "catalog_id")
        layout.prop(s, "body")
        layout.prop(s, "slot")
        layout.prop(s, "rig")
        if s.rig == "rigid":
            layout.prop(s, "bone")
        else:
            layout.prop(s, "keep_weights")
            if not s.keep_weights:
                src = "YBot_Surface" if getattr(s, "body", "any") == "male" else "Beta_Surface"
                layout.label(text=f"Otherwise copies {src} weights (weld UV seams)")
        layout.prop(s, "file")
        if s.slot == "gloves":
            layout.prop(s, "prep")
        layout.operator("bb.stamp_known_skins", icon="BOOKMARKS")


classes = (
    BB_SceneSettings,
    BB_SkinSettings,
    BB_OT_stamp_known_skins,
    BB_OT_bind_game_rig,
    BB_OT_export_skins,
    BB_PT_skins,
)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Object.bb_skin = PointerProperty(type=BB_SkinSettings)
    bpy.types.Scene.bb_skins = PointerProperty(type=BB_SceneSettings)


def unregister():
    del bpy.types.Scene.bb_skins
    del bpy.types.Object.bb_skin
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    try:
        unregister()
    except Exception:
        pass
    register()
