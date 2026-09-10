"""
Workbench skins → public/cosmetics GLBs.

`rig` in Blender (Sidebar → Character → Skins) is the switch. This file is the fallback
when a mesh is not tagged yet.
  rigid   — one Mixamo bone per mesh (hat, pads, belt). L/R sets: same
            number of meshes and bones, in matching order.
  skinned — Mixamo weights. Default copies Beta_Surface; `keep_weights`
            keeps painted vertex groups instead.

Add a row here, then `pnpm export:skins`. Do not put these meshes in hero.blend.
"""

from __future__ import annotations

from pathlib import Path

BIND = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero_bind.blend")
BLENDER = Path(r"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe")

# id must match packages/shared/src/cosmetics.ts
SKINS: list[dict] = [
    {
        "id": "hat_wizard",
        "slot": "hat",
        "name": "Wizard Hat",
        "file": "hat_wizard.glb",
        "meshes": ["WizardHat"],
        "bones": ["Head"],
        "rig": "rigid",
    },
    {
        "id": "shoulders_set_1",
        "slot": "shoulders",
        "name": "Shoulder Set 1",
        "file": "shoulders_set_1.glb",
        # Object 1 sits on the character's right in the workbench.
        "meshes": ["Shoulder set 1 - 1", "Shoulder set 1 - 2"],
        "bones": ["RightShoulder", "LeftShoulder"],
        "rig": "rigid",
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
        "id": "pants_set_1",
        "slot": "legs",
        "name": "Pants Set 1",
        "file": "pants_set_1.glb",
        "meshes": ["Pants Set 1"],
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
        "rig": "rigid",
        # One mesh in the workbench; split into L/R then parent each to a forearm.
        "prep": "split_lr_forearms",
    },
    {
        "id": "belt_set_1",
        "slot": "belt",
        "name": "Sash Belt 1",
        "file": "belt_set_1.glb",
        "meshes": ["Belt set 1"],
        "bones": ["Hips"],
        "rig": "rigid",
        "optional": True,
    },    {
        "id": "head_set_2",
        "slot": "hat",
        "name": "Head Set 2",
        "file": "head_set_2.glb",
        "meshes": ["Head set 2"],
        "bones": ["Head"],
        "rig": "rigid",
    },
    {
        "id": "head_set_3",
        "slot": "hat",
        "name": "Head Set 3",
        "file": "head_set_3.glb",
        "meshes": ["Head set 3"],
        "bones": ["Head"],
        "rig": "rigid",
    },

]


def find_skin(item_id: str) -> dict | None:
    for row in SKINS:
        if row["id"] == item_id:
            return row
    return None
