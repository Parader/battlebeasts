"""
Export Mixamo Y Bot (or similar) as a body-only skinned GLB.

Animations stay on hero.glb. Runtime rebinds this mesh onto the live Mixamo
armature — same path as skinned chest/boots.

    blender --background --factory-startup --python tools/blender_export_vessel.py -- `
        --fbx "C:/Users/deric/OneDrive/Documents/mage_trials/player/Y Bot.fbx" `
        --out apps/web/public/ybot.glb
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

REPO_PUBLIC = Path(r"C:\solo\battlebeasts2\apps\web\public")


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Export Mixamo vessel body GLB")
    p.add_argument("--fbx", type=Path, required=True)
    p.add_argument("--out", type=Path, default=REPO_PUBLIC / "ybot.glb")
    return p.parse_args(argv)


def glb_skin_count(path: Path) -> int:
    data = path.read_bytes()
    chunk_len, _chunk_type = struct.unpack_from("<I4s", data, 12)
    js = data[20 : 20 + chunk_len].rstrip(b"\x00").decode("utf-8")
    return len(json.loads(js).get("skins") or [])


def main() -> None:
    args = parse_args(sys.argv)
    fbx = args.fbx.expanduser().resolve()
    if not fbx.is_file():
        raise SystemExit(f"Missing FBX: {fbx}")

    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(fbx))

    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not arms:
        raise SystemExit("No armature in FBX — Mixamo export must include the rig")
    arm = arms[0]

    meshes = []
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        bound = obj.parent is arm or any(
            m.type == "ARMATURE" and m.object is arm for m in obj.modifiers
        )
        if bound:
            meshes.append(obj)

    if not meshes:
        raise SystemExit("No skinned mesh on the armature")

    surface = None
    for obj in meshes:
        low = obj.name.lower()
        if "joint" in low:
            obj.hide_set(True)
            obj.hide_render = True
            continue
        if surface is None or "surface" in low:
            surface = obj

    if surface is None:
        surface = meshes[0]
    surface.name = "Beta_Surface"
    if surface.data:
        surface.data.name = "Beta_Surface"

    # Drop leftover cameras / empties so the GLB is mesh + armature.
    keep = {arm, surface, *meshes}
    for obj in list(bpy.context.scene.objects):
        if obj not in keep and obj.type != "ARMATURE":
            if obj.type == "MESH" and "joint" in obj.name.lower():
                continue
            bpy.data.objects.remove(obj, do_unlink=True)

    out = args.out.expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        use_selection=False,
        export_apply=False,
        export_animations=False,
        export_skins=True,
        export_yup=True,
        export_texcoords=True,
        export_rest_position_armature=True,
        export_all_influences=True,
    )
    skins = glb_skin_count(out)
    if skins < 1:
        raise SystemExit(f"Wrote {out} without skins — Mixamo file is mesh-only")
    print(f"[vessel] wrote {out} ({out.stat().st_size} bytes, {skins} skin(s))")


if __name__ == "__main__":
    main()
