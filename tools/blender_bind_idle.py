"""
Copy the game's Mixamo `idle` onto hero_bind so clipping can be judged in the
same stance players see. Export still bakes REST (tools/blender_export_skin.py).

    blender hero_bind.blend --background --python tools/blender_bind_idle.py

Source of truth: apps/web/public/hero.glb animation named `idle`.
"""

from __future__ import annotations

import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

BIND = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero_bind.blend")
HERO_GLB = Path(r"C:\solo\battlebeasts2\apps\web\public\hero.glb")
HERO_BLEND = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero.blend")
IDLE_NAME = "idle"
GAME_IDLE_NAME = "idle_game"
TPOSE_NAME = "T-Pose"


def assign_action(arm, action) -> None:
    arm.animation_data_create()
    ad = arm.animation_data
    ad.action = action
    slots = getattr(action, "slots", None)
    if slots and len(slots) > 0 and hasattr(ad, "action_slot"):
        ad.action_slot = slots[0]


def action_frames(action) -> tuple[int, int]:
    a, b = action.frame_range
    return int(round(a)), int(round(b))


def find_idle_action():
    import bpy

    exact = bpy.data.actions.get(IDLE_NAME)
    if exact:
        return exact
    for action in bpy.data.actions:
        if action.name.split("|")[0].strip().lower() == IDLE_NAME:
            return action
    return None


def _is_hips_or_root_location(data_path: str) -> bool:
    path = data_path.replace(" ", "").lower()
    if "location" not in path:
        return False
    return "hips" in path or '["root"]' in path or ".root." in path or path.endswith("root].location")


def iter_action_fcurves(action):
    """Blender 4: action.fcurves. Blender 5: layered channelbags."""
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        yield from legacy
        return
    for layer in getattr(action, "layers", []) or []:
        for strip in getattr(layer, "strips", []) or []:
            bags = getattr(strip, "channelbags", None)
            if bags is None:
                continue
            for bag in bags:
                yield from bag.fcurves


def strip_action_hips_xz(action) -> int:
    """Same as the game's stripHorizontalRootMotion — plant idle on the origin."""
    n = 0
    for fc in iter_action_fcurves(action):
        if not _is_hips_or_root_location(fc.data_path):
            continue
        if fc.array_index == 1:
            continue
        for kp in fc.keyframe_points:
            kp.co[1] = 0.0
            kp.handle_left[1] = 0.0
            kp.handle_right[1] = 0.0
        n += 1
    return n


def ensure_game_idle_action(glb: Path = HERO_GLB):
    """hero.glb idle with hips XZ zeroed so Blender matches in-game planted stance."""
    import bpy

    src, imported = ensure_idle_action(glb)
    existing = bpy.data.actions.get(GAME_IDLE_NAME)
    if existing is not None:
        existing.use_fake_user = True
        strip_action_hips_xz(existing)
        return existing, imported
    dst = src.copy()
    dst.name = GAME_IDLE_NAME
    dst.use_fake_user = True
    moved = strip_action_hips_xz(dst)
    print(f"[idle] {GAME_IDLE_NAME} planted hips XZ ({moved} curves) imported_src={imported}")
    return dst, imported


def bind_armatures():
    import bpy

    arms = []
    for name in ("Armature", "Armature_Male"):
        obj = bpy.data.objects.get(name)
        if obj is not None and obj.type == "ARMATURE":
            arms.append(obj)
    if not arms:
        arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    return arms


def import_idle_from_hero_glb(glb: Path):
    import bpy

    if not glb.is_file():
        raise RuntimeError(f"hero.glb missing: {glb}")
    before_obj = set(bpy.data.objects)
    before_act = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    new_acts = [a for a in bpy.data.actions if a not in before_act]
    idle = None
    for action in new_acts:
        stem = action.name.split("|")[0].strip()
        if stem == IDLE_NAME or action.name == IDLE_NAME:
            idle = action
            break
    if idle is None:
        names = [a.name for a in new_acts]
        for obj in list(bpy.data.objects):
            if obj not in before_obj:
                bpy.data.objects.remove(obj, do_unlink=True)
        raise RuntimeError(f"No {IDLE_NAME!r} clip in {glb.name}. Imported: {names[:20]}")

    idle.use_fake_user = True
    if idle.name != IDLE_NAME:
        idle.name = IDLE_NAME
    for action in new_acts:
        if action is not idle:
            bpy.data.actions.remove(action)
    for obj in list(bpy.data.objects):
        if obj not in before_obj:
            bpy.data.objects.remove(obj, do_unlink=True)
    return idle


def ensure_idle_action(glb: Path = HERO_GLB):
    idle = find_idle_action()
    if idle is not None:
        idle.use_fake_user = True
        return idle, False
    return import_idle_from_hero_glb(glb), True


def find_tpose_action():
    import bpy

    exact = bpy.data.actions.get(TPOSE_NAME)
    if exact:
        return exact
    for action in bpy.data.actions:
        stem = action.name.split("|")[0].strip().lower().replace(" ", "")
        if stem in ("t-pose", "tpose"):
            return action
    return None


def ensure_tpose_action(blend: Path = HERO_BLEND):
    """Mixamo T-Pose clip from hero.blend (1.55cm hips vs Rest). Not used for export."""
    import bpy

    existing = find_tpose_action()
    if existing is not None:
        existing.use_fake_user = True
        return existing, False
    if not blend.is_file():
        raise RuntimeError(f"hero.blend missing: {blend}")
    before = set(bpy.data.actions)
    with bpy.data.libraries.load(str(blend), link=False) as (src, dst):
        names = [n for n in (src.actions or []) if n == TPOSE_NAME]
        if not names:
            names = [
                n
                for n in (src.actions or [])
                if n.split("|")[0].strip().lower().replace(" ", "") in ("t-pose", "tpose")
            ][:1]
        dst.actions = names
    new = [a for a in bpy.data.actions if a not in before]
    action = find_tpose_action() or (new[0] if new else None)
    if action is None:
        raise RuntimeError(f"No {TPOSE_NAME!r} action in {blend.name}")
    action.use_fake_user = True
    if action.name != TPOSE_NAME:
        action.name = TPOSE_NAME
    return action, True


def apply_pose_preview(mode: str, glb: Path = HERO_GLB) -> str:
    """mode: 'rest' | 'idle' | 'tpose'. Export still snapshots REST."""
    import bpy
    import blender_export_skin as skin

    arms = bind_armatures()
    if not arms:
        raise RuntimeError("No armature in this file")
    skin.sync_workbench_bodies()
    mode = (mode or "rest").lower()
    if mode == "rest":
        for arm in arms:
            arm.data.pose_position = "REST"
        bpy.context.view_layer.update()
        return "REST"
    if mode in ("tpose", "t-pose"):
        action, _ = ensure_tpose_action()
        start, end = action_frames(action)
        scene = bpy.context.scene
        scene.frame_start = start
        scene.frame_end = end
        for arm in arms:
            assign_action(arm, action)
            arm.data.pose_position = "POSE"
        scene.frame_set(start)
        bpy.context.view_layer.update()
        return f"{TPOSE_NAME} frames {start}-{end}"
    idle, _imported = ensure_game_idle_action(glb)
    start, end = action_frames(idle)
    scene = bpy.context.scene
    scene.frame_start = start
    scene.frame_end = end
    for arm in arms:
        assign_action(arm, idle)
        arm.data.pose_position = "POSE"
    scene.frame_set(start)
    bpy.context.view_layer.update()
    return f"{GAME_IDLE_NAME} frames {start}-{end}"


def _ensure_armature_mod(obj, arm) -> None:
    mod = None
    for existing in obj.modifiers:
        if existing.type == "ARMATURE":
            mod = existing
            break
    if mod is None:
        mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True
    mod.use_bone_envelopes = False
    mod.show_viewport = True
    mod.show_render = True


def _bind_rigid_preview(obj, arm, bone_name: str, *, force: bool) -> str | None:
    import blender_export_skin as skin

    already = (
        obj.parent == arm
        and obj.parent_type == "BONE"
        and skin.bone_suffix(obj.parent_bone or "") == skin.bone_suffix(bone_name)
    )
    if already and not force:
        return None
    for mod in list(obj.modifiers):
        if mod.type == "ARMATURE":
            obj.modifiers.remove(mod)
    skin.parent_keep_world_to_bone(obj, arm, bone_name)
    obj["bb_game_preview"] = "rigid"
    return f"{obj.name} → bone {bone_name}"


def _bind_skinned_preview(
    obj, arm, body: str, *, keep: bool, force: bool, slot: str = ""
) -> str | None:
    import bpy
    import blender_export_skin as skin

    has_mod = any(m.type == "ARMATURE" and m.object == arm for m in obj.modifiers)
    has_w = skin.weighted_vert_count(obj) > 0
    object_parented = obj.parent == arm and obj.parent_type == "OBJECT"
    if has_mod and has_w and object_parented and not force:
        return None
    skin.parent_keep_world_to_object(obj, arm)
    bpy.context.view_layer.update()
    if not keep or not has_w or force:
        surface = skin.find_surface("male" if body == "male" else None)
        if surface is None:
            raise RuntimeError(f"No dummy to copy weights from for {obj.name}")
        n = skin.transfer_weights_from_body(obj, surface)
        print(f"[idle] {obj.name!r} Mixamo weights {n}/{len(obj.data.vertices)}")
        follow = skin.SLOT_FOLLOW_SUFFIXES.get(slot)
        if follow:
            moved = skin.prune_vgroups_to_suffixes(obj, follow)
            print(
                f"[idle] {obj.name!r} kept {sorted(follow)} groups "
                f"(reassigned {moved})"
            )
    _ensure_armature_mod(obj, arm)
    obj["bb_game_preview"] = "skinned"
    return f"{obj.name} → armature {arm.name}"


def bind_skins_for_game_preview(*, force: bool = False) -> list[str]:
    """Same rig the game uses: Mixamo weights + Armature modifier on every piece."""
    import bpy
    import blender_export_skin as skin
    import blender_export_skins as batch

    batch.ensure_skin_rna()
    preview = skin.scene_body_preview()
    skin.reveal_bind_dummies()
    skin.restore_body_inherits_armature(skin.find_armature())
    skin.align_male_armature_to_host()
    for arm in bind_armatures():
        arm.data.pose_position = "REST"
    bpy.context.view_layer.update()

    notes: list[str] = []
    for job in batch.collect_jobs(""):
        rig = job.get("rig") or "rigid"
        body = job.get("body") or "any"
        try:
            arm = skin.find_armature("male" if body == "male" else None)
        except RuntimeError:
            continue
        meshes = list(job.get("meshes") or [])
        bones = list(job.get("bones") or [])
        keep = bool(job.get("keep_weights"))
        for i, name in enumerate(meshes):
            obj = bpy.data.objects.get(name)
            if obj is None or obj.type != "MESH":
                continue
            try:
                if rig == "skinned":
                    note = _bind_skinned_preview(
                        obj, arm, body, keep=keep, force=force, slot=job.get("slot") or ""
                    )
                else:
                    bone = bones[i] if i < len(bones) else (bones[0] if bones else "Head")
                    note = _bind_rigid_preview(obj, arm, bone, force=force)
            except Exception as exc:
                print(f"[idle] skip {name!r}: {exc}")
                continue
            if note:
                notes.append(note)
    bpy.context.view_layer.update()
    skin.apply_body_preview(preview)
    bpy.context.view_layer.update()
    return notes


def main() -> None:
    import bpy

    blend = BIND
    if "--" in sys.argv:
        extra = sys.argv[sys.argv.index("--") + 1 :]
        if extra:
            blend = Path(extra[0])
    if not bpy.data.filepath:
        if not blend.is_file():
            raise SystemExit(f"Missing {blend}")
        bpy.ops.wm.open_mainfile(filepath=str(blend))

    notes = bind_skins_for_game_preview(force=True)
    info = apply_pose_preview("idle")
    idle = find_idle_action() or bpy.data.actions.get(GAME_IDLE_NAME)
    print(f"[idle] action={getattr(idle, 'name', None)!r} {info}")
    print(f"[idle] game-rigged {len(notes)} mesh(es)")
    for line in notes:
        print(f"  {line}")
    for arm in bind_armatures():
        print(f"[idle] {arm.name}: pose_position={arm.data.pose_position} action={arm.animation_data.action.name if arm.animation_data and arm.animation_data.action else None}")
    out = Path(bpy.data.filepath) if bpy.data.filepath else blend
    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    print(f"[idle] saved {out}")
    print("[idle] Sidebar → Character → Skins → Pose: Rest to place, Idle to match the game.")
    print("[idle] Spacebar plays the breathing loop. Export still uses bind/T-pose.")


if __name__ == "__main__":
    main()
