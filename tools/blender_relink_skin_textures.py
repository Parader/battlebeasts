"""
Collect gear albedos into the bind workbench `textures/` folder, relink + pack
them in hero_bind.blend, then save.

Sources (first match wins per filename):
  1. mage_trials/fantasykingdom/character/gear
  2. Downloads/assets/textures (bracers + chestplate; skips PT_ map pack)
  3. tools/skin_textures

    blender "C:/Users/deric/OneDrive/Documents/mage_trials/player/hero_bind.blend" `
        --background --python tools/blender_relink_skin_textures.py
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import blender_export_skin as skin  # noqa: E402

BIND = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\player\hero_bind.blend")
FK_GEAR = Path(r"C:\Users\deric\OneDrive\Documents\mage_trials\fantasykingdom\character\gear")
DOWNLOADS_TEX = Path(r"C:\Users\deric\Downloads\assets\textures")
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tga"}
SKIP_PREFIXES = ("pt_",)  # Poly Terrain / map pack, not wearable gear


def is_gear_texture(path: Path) -> bool:
    if path.suffix.lower() not in IMAGE_EXTS:
        return False
    return not path.name.lower().startswith(SKIP_PREFIXES)


def collect_textures(dest: Path) -> None:
    dest.mkdir(exist_ok=True)
    sources = (FK_GEAR, DOWNLOADS_TEX, TOOLS / "skin_textures")
    seen: set[str] = set()
    for folder in sources:
        if not folder.is_dir():
            continue
        for src in folder.iterdir():
            if not src.is_file() or not is_gear_texture(src):
                continue
            key = src.name.lower()
            if key in seen:
                continue
            seen.add(key)
            target = dest / src.name
            shutil.copy2(src, target)
            print(f"[relink] {src.name} ← {folder}")


def main() -> None:
    import bpy

    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    blend = Path(argv[0]).resolve() if argv else Path(bpy.data.filepath).resolve()
    if not blend.is_file():
        blend = BIND
        bpy.ops.wm.open_mainfile(filepath=str(blend))
    elif Path(bpy.data.filepath).resolve() != blend:
        bpy.ops.wm.open_mainfile(filepath=str(blend))

    collect_textures(blend.parent / "textures")
    skin.relink_all_missing_images(force=True)
    old_gear = blend.parent / "gear"
    if old_gear.is_dir():
        shutil.rmtree(old_gear)
        print(f"[relink] removed leftover {old_gear}")
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_mainfile()
    print(f"[relink] saved {blend}")
    for img in bpy.data.images:
        print(
            f"  {img.name!r} size={tuple(img.size)} packed={img.packed_file is not None} fp={img.filepath!r}"
        )


if __name__ == "__main__":
    main()
