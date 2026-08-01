"""
Add a V Rising–style ChestProxy bone and bake it from Mixamo chest (Spine1/Spine2).

ChestProxy is a *root-level* bone (sibling of Hips, not under the pelvis). While
constrained, it mirrors the chest world transform. After bake, cast actions carry
that intended chest pose without inheriting loco hip twist.

Usage (Blender 3.6+/4/5):
  blender hero.blend --background --python tools/blender_add_chest_proxy.py -- \\
    --actions "magic_1h,Standing 1H Magic Attack 02,Standing 1H Magic Attack 03" \\
    --chest Spine1 --out-blend hero_proxy.blend

Then re-export GLB and verify casts in-game (ChestProxy).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROXY_NAME = "ChestProxy"
CHEST_CANDIDATES = (
    "mixamorig:Spine1",
    "mixamorig_Spine1",
    "Spine1",
    "mixamorig:Spine2",
    "mixamorig_Spine2",
    "Spine2",
)


def default_bake_actions_json() -> Path:
    """Resolve tools/spell_cast_bake_actions.json (works in --python and Text Editor)."""
    candidates: list[Path] = []
    try:
        candidates.append(Path(__file__).resolve().parent / "spell_cast_bake_actions.json")
    except NameError:
        pass
    candidates.extend(
        [
            Path(r"C:\solo\battlebeasts2\tools\spell_cast_bake_actions.json"),
            Path.cwd() / "tools" / "spell_cast_bake_actions.json",
            Path.cwd() / "spell_cast_bake_actions.json",
        ]
    )
    for p in candidates:
        if p.is_file():
            return p
    return candidates[0]


BAKE_ACTIONS_JSON = default_bake_actions_json()


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Add + bake ChestProxy from Mixamo chest")
    p.add_argument("--blend", type=Path, default=None, help="Open this .blend first")
    p.add_argument("--out-blend", type=Path, default=None)
    p.add_argument(
        "--actions",
        type=str,
        default="",
        help="Comma-separated action names (default: tools/spell_cast_bake_actions.json)",
    )
    p.add_argument(
        "--actions-json",
        type=Path,
        default=None,
        help="Override path to spell_cast_bake_actions.json",
    )
    p.add_argument(
        "--chest",
        type=str,
        default="",
        help="Chest bone name (default: first Spine1/Spine2 match)",
    )
    p.add_argument(
        "--keep-constraint",
        action="store_true",
        help="Leave Copy Transforms on after bake (usually off for export)",
    )
    p.add_argument("--dry-run", action="store_true")
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


def resolve_chest_bone(arm, requested: str) -> str:
    names = {b.name for b in arm.data.bones}
    if requested:
        if requested in names:
            return requested
        # Allow bare Spine1 vs mixamorig:Spine1
        for n in names:
            if n.endswith(requested) or requested in n:
                return n
        raise RuntimeError(f"Chest bone not found: {requested}")
    for n in CHEST_CANDIDATES:
        if n in names:
            return n
    for b in arm.data.bones:
        low = b.name.lower()
        if "spine1" in low or low.endswith("spine1"):
            return b.name
    for b in arm.data.bones:
        if "spine2" in b.name.lower():
            return b.name
    raise RuntimeError("No Spine1/Spine2 chest bone found")


def ensure_proxy_bone(arm, chest_name: str) -> str:
    import bpy

    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    ebones = arm.data.edit_bones
    chest = ebones.get(chest_name)
    if not chest:
        bpy.ops.object.mode_set(mode="OBJECT")
        raise RuntimeError(f"Edit bone missing: {chest_name}")

    existing = ebones.get(PROXY_NAME)
    if existing:
        existing.parent = None
        existing.use_connect = False
        existing.head = chest.head.copy()
        existing.tail = chest.tail.copy()
        existing.roll = chest.roll
    else:
        proxy = ebones.new(PROXY_NAME)
        proxy.parent = None
        proxy.use_connect = False
        proxy.head = chest.head.copy()
        proxy.tail = chest.tail.copy()
        proxy.roll = chest.roll

    bpy.ops.object.mode_set(mode="OBJECT")
    return PROXY_NAME


def clear_proxy_constraints(arm, proxy_name: str) -> None:
    pb = arm.pose.bones.get(proxy_name)
    if not pb:
        return
    for c in list(pb.constraints):
        pb.constraints.remove(c)


def add_copy_transforms(arm, proxy_name: str, chest_name: str) -> None:
    import bpy

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    clear_proxy_constraints(arm, proxy_name)
    pb = arm.pose.bones[proxy_name]
    c = pb.constraints.new("COPY_TRANSFORMS")
    c.name = "ChestProxy_CopyTransforms"
    c.target = arm
    c.subtarget = chest_name
    c.mix_mode = "REPLACE"
    c.target_space = "WORLD"
    c.owner_space = "WORLD"
    bpy.ops.object.mode_set(mode="OBJECT")


def action_frame_range(action) -> tuple[int, int]:
    if action.frame_range:
        a, b = action.frame_range
        return int(round(a)), int(round(b))
    return 1, 40


def channelbag_for(action):
    """Blender 4.4+/5 slotted Actions store fcurves on channelbags, not action.fcurves."""
    layers = getattr(action, "layers", None)
    if not layers:
        return None
    strips = layers[0].strips
    if not strips:
        return None
    bags = strips[0].channelbags
    return bags[0] if bags else None


def iter_action_fcurves(action):
    """Yield fcurves for Blender 5 channelbags or legacy action.fcurves."""
    bag = channelbag_for(action)
    if bag is not None:
        for fc in bag.fcurves:
            yield bag, fc
        return
    fcurves = getattr(action, "fcurves", None)
    if fcurves is None:
        return
    for fc in fcurves:
        yield action, fc


def remove_fcurves_with_prefix(action, path_prefix: str) -> int:
    removed = 0
    bag = channelbag_for(action)
    if bag is not None:
        for fc in list(bag.fcurves):
            if fc.data_path.startswith(path_prefix):
                bag.fcurves.remove(fc)
                removed += 1
        return removed
    fcurves = getattr(action, "fcurves", None)
    if fcurves is None:
        return 0
    for fc in list(fcurves):
        if fc.data_path.startswith(path_prefix):
            fcurves.remove(fc)
            removed += 1
    return removed


def assign_action(arm, action) -> None:
    """Assign action (+ first slot on Blender 4.4+/5)."""
    arm.animation_data_create()
    ad = arm.animation_data
    ad.action = action
    slots = getattr(action, "slots", None)
    if slots and len(slots) > 0 and hasattr(ad, "action_slot"):
        ad.action_slot = slots[0]


# Default: combat magic/cast only. Prefer tools/spell_cast_bake_actions.json.
# Heuristic fallback if the JSON is missing (skips dance / loco / sports / melee).
DEFAULT_CAST_SUBSTRINGS = (
    "magic",
    "spell",
    "casting",
    "1h cast",
    "2h magic",
)
DEFAULT_CAST_EXCLUDE = (
    "dance",
    "dancing",
    "idle",
    "walk",
    "run",
    "jog",
    "strafe",
    "baseball",
    "frisbee",
    "goalkeeper",
    "throw in",
    "melee",
    "sword",
    "jump attack",
    "death",
    "hit",
    "crouch",
)


def load_bake_action_entries(json_path: Path | None) -> list[dict]:
    import json

    path = Path(json_path) if json_path else default_bake_actions_json()
    if not path.is_file():
        print(f"[ChestProxy] bake list not found: {path}")
        return []
    print(f"[ChestProxy] bake list: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    return list(data.get("actions") or [])


def resolve_action_by_name_or_alias(entry: dict):
    import bpy

    candidates = [entry["name"], *(entry.get("aliases") or [])]
    for name in candidates:
        a = bpy.data.actions.get(name)
        if a:
            return a, name
    return None, candidates[0]


def select_cast_actions(explicit: str, actions_json: Path | None = None):
    import bpy

    if explicit.strip():
        names = [n.strip() for n in explicit.split(",") if n.strip()]
        out = []
        for n in names:
            a = bpy.data.actions.get(n)
            if not a:
                raise RuntimeError(f"Action not found: {n}")
            out.append(a)
        return out

    entries = load_bake_action_entries(actions_json)
    if entries:
        out = []
        seen = set()
        for entry in entries:
            action, resolved = resolve_action_by_name_or_alias(entry)
            spells = ", ".join(entry.get("spells") or []) or "?"
            if not action:
                print(
                    f"[ChestProxy] ! missing action {entry['name']!r} "
                    f"(aliases={entry.get('aliases')}) spells=[{spells}]"
                )
                continue
            if action.name in seen:
                continue
            seen.add(action.name)
            print(f"[ChestProxy]   {action.name} ← [{spells}]")
            out.append(action)
        if out:
            return out
        print("[ChestProxy] bake JSON matched no actions — falling back to heuristic")

    out = []
    for a in bpy.data.actions:
        low = a.name.lower()
        if any(x in low for x in DEFAULT_CAST_EXCLUDE):
            continue
        if any(x in low for x in DEFAULT_CAST_SUBSTRINGS):
            out.append(a)
    return out


def bake_proxy_into_action(arm, action, proxy_name: str, chest_name: str) -> int:
    """Sample chest world pose into ChestProxy local keys on `action`."""
    import bpy

    scene = bpy.context.scene
    start, end = action_frame_range(action)
    assign_action(arm, action)

    # Ensure quaternion mode for clean glTF export
    proxy_pb = arm.pose.bones[proxy_name]
    chest_pb = arm.pose.bones[chest_name]
    proxy_pb.rotation_mode = "QUATERNION"

    # Drop old ChestProxy fcurves on this action (Blender 5: channelbag)
    path_prefix = f'pose.bones["{proxy_name}"]'
    remove_fcurves_with_prefix(action, path_prefix)

    keyed = 0
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()

        # World matrix of chest pose bone
        chest_world = arm.matrix_world @ chest_pb.matrix
        # Root-level proxy: local = armature-space
        proxy_local = arm.matrix_world.inverted() @ chest_world

        loc, rot, _sca = proxy_local.decompose()
        proxy_pb.location = loc
        proxy_pb.rotation_quaternion = rot

        proxy_pb.keyframe_insert(data_path="location", frame=frame, group=proxy_name)
        proxy_pb.keyframe_insert(
            data_path="rotation_quaternion", frame=frame, group=proxy_name
        )
        keyed += 1

    # Linear interpolation on proxy curves
    for _owner, fc in iter_action_fcurves(action):
        if fc.data_path.startswith(path_prefix):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"

    return keyed


def main() -> int:
    import bpy

    args = parse_args(sys.argv)

    if args.blend:
        bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()))

    arm = find_armature()
    chest_name = resolve_chest_bone(arm, args.chest)
    actions = select_cast_actions(args.actions, args.actions_json)

    print(f"[ChestProxy] armature={arm.name} chest={chest_name} actions={len(actions)}")
    for a in actions:
        print(f"  - {a.name}")

    if args.dry_run:
        return 0

    ensure_proxy_bone(arm, chest_name)
    add_copy_transforms(arm, PROXY_NAME, chest_name)

    total = 0
    for action in actions:
        n = bake_proxy_into_action(arm, action, PROXY_NAME, chest_name)
        print(f"[ChestProxy] baked {n} frames → {action.name}")
        total += n

    if not args.keep_constraint:
        clear_proxy_constraints(arm, PROXY_NAME)
        print("[ChestProxy] cleared Copy Transforms (baked keys remain)")

    out = args.out_blend
    if out:
        out = out.resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(out))
        print(f"[ChestProxy] saved {out}")
    elif bpy.app.background:
        bpy.ops.wm.save_mainfile()
        print("[ChestProxy] saved current blend")
    else:
        print("[ChestProxy] done in editor — File → Save (or Save As) to keep changes")

    print(f"[ChestProxy] done — {total} keyframes across {len(actions)} actions")
    print("Next: export GLB and verify casts in-game (ChestProxy)")
    return 0


if __name__ == "__main__":
    # Do NOT raise SystemExit — that quits the Blender GUI when Run Script is used.
    try:
        main()
    except Exception as e:
        print(f"[ChestProxy] ERROR: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc()
