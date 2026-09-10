"""
Install the Skins sidebar into Blender and tag meshes in hero_bind.blend.

    blender --background --python tools/blender_install_skin_panel.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy

TOOLS = Path(__file__).resolve().parent
SRC = TOOLS / "blender_skin_panel.py"
BIND = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero_bind.blend")


def install_addon() -> Path:
    bpy.ops.preferences.addon_install(filepath=str(SRC.resolve()), overwrite=True)
    bpy.ops.preferences.addon_enable(module="blender_skin_panel")
    bpy.ops.wm.save_userpref()
    addons = Path(bpy.utils.user_resource("SCRIPTS", path="addons"))
    dest = addons / SRC.name
    print(f"[skins] addon enabled ← {dest}")
    return dest


def stamp_and_save(blend: Path) -> None:
    if str(TOOLS) not in sys.path:
        sys.path.insert(0, str(TOOLS))
    bpy.ops.wm.open_mainfile(filepath=str(blend.resolve()))
    bpy.ops.bb.stamp_known_skins()
    bpy.ops.wm.save_mainfile()
    print(f"[skins] tagged + saved {blend}")


def main() -> None:
    install_addon()
    stamp = "--stamp" in sys.argv
    if stamp and BIND.is_file():
        stamp_and_save(BIND)
    else:
        print("[skins] restart Blender to load the new Skins buttons (blend file left untouched)")


if __name__ == "__main__":
    main()
