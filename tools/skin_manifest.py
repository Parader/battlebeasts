"""
Workbench skins → public/cosmetics GLBs.

`rig` in Blender (Sidebar → Character → Skins) is the switch. This file is the fallback
when a mesh is not tagged yet. Every live piece is `skinned` (Mixamo weights,
remounted on the hero skeleton). Default copies Beta_Surface; `keep_weights`
keeps painted vertex groups instead. Hats keep the workbench Armature
weights so the game matches hero_bind.blend.

Add a row here, then `pnpm export:skins`. Do not put these meshes in hero.blend.
"""

from __future__ import annotations

from pathlib import Path

BIND = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero_bind.blend")
BLENDER = Path(r"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe")

# Longer prefixes first. `pants_set_2` must match `pants`, not fail `pant_`.
_SLOT_PREFIXES: tuple[tuple[str, str], ...] = (
    ("shoulders", "shoulders"),
    ("shoulder", "shoulders"),
    ("bracers", "gloves"),
    ("bracer", "gloves"),
    ("gloves", "gloves"),
    ("glove", "gloves"),
    ("boots", "shoes"),
    ("boot", "shoes"),
    ("shoes", "shoes"),
    ("shoe", "shoes"),
    ("chest", "chest"),
    ("pants", "legs"),
    ("pant", "legs"),
    ("legs", "legs"),
    ("leg", "legs"),
    ("belt", "belt"),
    ("sash", "belt"),
    ("head", "hat"),
    ("helm", "hat"),
    ("hood", "hat"),
    ("hat", "hat"),
)

BONES_FOR_SLOT: dict[str, list[str]] = {
    "hat": ["Head"],
    "shoulders": ["LeftShoulder", "RightShoulder"],
    "chest": ["Spine", "Spine1", "Spine2"],
    "gloves": ["LeftForeArm", "RightForeArm"],
    "belt": ["Hips"],
    "legs": ["Hips", "LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg"],
    "shoes": ["LeftLeg", "LeftFoot", "LeftToeBase", "RightLeg", "RightFoot", "RightToeBase"],
}


def slot_from_id(cid: str) -> str | None:
    key = (cid or "").strip().lower().replace("-", "_")
    if not key:
        return None
    for prefix, slot in _SLOT_PREFIXES:
        if key == prefix or key.startswith(f"{prefix}_") or key.startswith(prefix):
            return slot
    return None


def bones_for_slot(slot: str, existing: list[str] | None = None) -> list[str]:
    if existing:
        return list(existing)
    return list(BONES_FOR_SLOT.get(slot) or BONES_FOR_SLOT["chest"])

# id must match packages/shared/src/cosmetics.ts
SKINS: list[dict] = [
    {
        "id": "hat_wizard",
        "slot": "hat",
        "name": "Wizard Hat",
        "file": "hat_wizard.glb",
        "meshes": ["WizardHat"],
        "bones": ["Head"],
        "rig": "skinned",
    },
    {
        "id": "shoulders_set_1",
        "slot": "shoulders",
        "name": "Shoulder Set 1",
        "file": "shoulders_set_1.glb",
        # Object 1 sits on the character's right in the workbench.
        "meshes": ["Shoulder set 1 - 1", "Shoulder set 1 - 2"],
        "bones": ["RightShoulder", "LeftShoulder"],
        "rig": "skinned",
    },
    {
        "id": "shoulders_set_2",
        "slot": "shoulders",
        "name": "Shoulder Set 2",
        "file": "shoulders_set_2.glb",
        "meshes": ["Shoulder set 2"],
        "bones": ["LeftShoulder", "RightShoulder", "Spine1", "Spine2"],
        "rig": "skinned",
    },
    {
        "id": "chest_set_1",
        "slot": "chest",
        "name": "Chest Set 1",
        "file": "chest_set_1.glb",
        "meshes": ["Chest Set 1"],
        "bones": ["Spine", "Spine1", "Spine2"],
        "rig": "skinned",
    },
    {
        "id": "chest_set_2",
        "slot": "chest",
        "name": "Chest Set 2",
        "file": "chest_set_2.glb",
        "meshes": ["Chest Set 2"],
        "bones": ["Spine", "Spine1", "Spine2"],
        "rig": "skinned",
    },
    {
        "id": "chest_set_3",
        "slot": "chest",
        "name": "Chest Set 3",
        "file": "chest_set_3.glb",
        "meshes": ["Chest Set 3"],
        "bones": ["Spine", "Spine1", "Spine2"],
        "rig": "skinned",
    },
    {
        "id": "chest_set_4",
        "slot": "chest",
        "name": "Chest Set 4",
        "file": "chest_set_4.glb",
        "meshes": ["Chest Set 4"],
        "bones": ["Spine", "Spine1", "Spine2"],
        "rig": "skinned",
    },
    {
        "id": "chest_set_5",
        "slot": "chest",
        "name": "Chest Set 5",
        "file": "chest_set_5.glb",
        "meshes": ["Chest Set 5"],
        "bones": ["Spine", "Spine1", "Spine2"],
        "rig": "skinned",
    },
    {
        "id": "chest_set_6",
        "slot": "chest",
        "name": "Chest Set 6",
        "file": "chest_set_6.glb",
        "meshes": ["Chest Set 6"],
        "bones": ["Spine", "Spine1", "Spine2"],
        "rig": "skinned",
    },
    {
        "id": "pants_set_1",
        "slot": "legs",
        "name": "Pants Set 1",
        "file": "pants_set_1.glb",
        "meshes": ["Pants Set 1"],
        "bones": ["Hips", "LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg"],
        "rig": "skinned",
    },
    {
        "id": "pants_set_2",
        "slot": "legs",
        "name": "Pants Set 2",
        "file": "pants_set_2.glb",
        "meshes": ["Pants Set 2"],
        "bones": ["Hips", "LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg"],
        "rig": "skinned",
    },
    {
        "id": "shoes_set_1",
        "slot": "shoes",
        "name": "Boot Set 1",
        "file": "shoes_set_1.glb",
        "meshes": ["Boot Set 1"],
        "bones": [
            "LeftLeg",
            "LeftFoot",
            "LeftToeBase",
            "RightLeg",
            "RightFoot",
            "RightToeBase",
        ],
        "rig": "skinned",
    },
    {
        "id": "bracers_set_1",
        "slot": "gloves",
        "name": "Bracer Set 1",
        "file": "bracers_set_1.glb",
        "meshes": ["Bracers set 1"],
        "bones": ["LeftForeArm", "RightForeArm"],
        "rig": "skinned",
    },
    {
        "id": "bracers_set_2",
        "slot": "gloves",
        "name": "Bracers Set 2",
        "file": "bracers_set_2.glb",
        "meshes": ["Bracers Set 2"],
        "bones": ["LeftForeArm", "RightForeArm"],
        "rig": "skinned",
    },
    # Parked — Sash Belt 1 is out of the live catalog for now.
    # {
    #     "id": "belt_set_1",
    #     "slot": "belt",
    #     "name": "Sash Belt 1",
    #     "file": "belt_set_1.glb",
    #     "meshes": ["Belt set 1"],
    #     "bones": ["Hips"],
    #     "rig": "skinned",
    #     "optional": True,
    # },
    {
        "id": "head_set_2",
        "slot": "hat",
        "name": "Head Set 2",
        "file": "head_set_2.glb",
        "meshes": ["Head set 2"],
        "bones": ["Head"],
        "rig": "skinned",
    },
    {
        "id": "head_set_3",
        "slot": "hat",
        "name": "Head Set 3",
        "file": "head_set_3.glb",
        "meshes": ["Head set 3"],
        "bones": ["Head"],
        "rig": "skinned",
    },
    {
        "id": "head_set_4",
        "slot": "hat",
        "name": "Head Set 4",
        "file": "head_set_4.glb",
        "meshes": ["Head Set 4"],
        "bones": ["Head"],
        "rig": "skinned",
    },
    {
        "id": "head_set_5",
        "slot": "hat",
        "name": "Head Set 5",
        "file": "head_set_5.glb",
        "meshes": ["Head Set 5"],
        "bones": ["Head"],
        "rig": "skinned",
    },
    {
        "id": "head_set_6",
        "slot": "hat",
        "name": "Head Set 6",
        "file": "head_set_6.glb",
        "meshes": ["Head set 6"],
        "bones": ["Head"],
        "rig": "skinned",
    },
    {
        "id": "boots_set_2",
        "slot": "shoes",
        "name": "Boots Set 2",
        "file": "boots_set_2.glb",
        "meshes": ["Boots Set 2"],
        "bones": [
            "LeftLeg",
            "LeftFoot",
            "LeftToeBase",
            "RightLeg",
            "RightFoot",
            "RightToeBase",
        ],
        "rig": "skinned",
    },
    {
        "id": "shoulder_set_3",
        "slot": "shoulders",
        "name": "Shoulder Set 3",
        "file": "shoulder_set_3.glb",
        "meshes": ["Shoulder set 3"],
        "bones": ["LeftShoulder", "RightShoulder"],
        "rig": "skinned",
    },
    {
        "id": "shoulder_set_4",
        "slot": "shoulders",
        "name": "Shoulder Set 4",
        "file": "shoulder_set_4.glb",
        "meshes": ["Shoulders Set 4"],
        "bones": ["LeftShoulder", "RightShoulder"],
        "rig": "skinned",
    },
    {
        "id": "shoulder_set_5",
        "slot": "shoulders",
        "name": "Shoulder Set 5",
        "file": "shoulder_set_5.glb",
        "meshes": ["Shoulders Set 5"],
        "bones": ["LeftShoulder", "RightShoulder"],
        "rig": "skinned",
    },

]


def find_skin(item_id: str) -> dict | None:
    for row in SKINS:
        if row["id"] == item_id:
            return row
    return None
