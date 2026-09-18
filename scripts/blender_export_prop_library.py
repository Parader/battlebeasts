"""
Export each mesh in a catalog .blend as its own centered GLB into the prop library.

Usage (PowerShell, from repo root):

  & "C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe" `
    "C:\\Users\\deric\\OneDrive\\Documents\\mage_trials\\New folder\\desert_1.blend" `
    --background --python .\\scripts\\blender_export_prop_library.py -- `
    --out-dir .\\apps\\web\\public\\assets\\props\\desert `
    --biome desert

Each mesh is centered (ground-plane midpoint, lowest point at Z=0) and written
as a GLB. Shared images go in <out-dir>/textures/ so the atlas is not embedded
53 times. Does not save the .blend. Then: pnpm gen:props
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import struct
import sys

import bpy
from mathutils import Matrix, Vector

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

SKIP_NAME_RE = re.compile(r"^(YBot|Armature)", re.IGNORECASE)


def parse_args(argv: list[str]) -> dict:
    out_dir = None
    biome = "desert"
    prefix = "PP"
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--out-dir" and i + 1 < len(argv):
            out_dir = argv[i + 1]
            i += 2
            continue
        if a == "--biome" and i + 1 < len(argv):
            biome = argv[i + 1].strip().lower()
            i += 2
            continue
        if a == "--prefix" and i + 1 < len(argv):
            prefix = argv[i + 1].strip()
            i += 2
            continue
        i += 1
    return {"out_dir": out_dir, "biome": biome, "prefix": prefix}


def after_dash(argv: list[str]) -> list[str]:
    return argv[argv.index("--") + 1 :] if "--" in argv else []


def library_name(obj_name: str, prefix: str) -> str:
    base, dot, suffix = obj_name.partition(".")
    variant = 1
    if dot and suffix.isdigit():
        variant = int(suffix) + 1
    words = re.sub(r"[^A-Za-z0-9]+", " ", base).strip().title().split()
    family = "_".join(words) or "Prop"
    return f"{prefix}_{family}_{variant:02d}"


def should_skip(obj) -> bool:
    if obj.type != "MESH" or obj.data is None:
        return True
    if SKIP_NAME_RE.match(obj.name or ""):
        return True
    # Armature / YBot are scale reference only — never export them or their meshes.
    parent = obj.parent
    while parent is not None:
        if parent.type == "ARMATURE" or SKIP_NAME_RE.match(parent.name or ""):
            return True
        parent = parent.parent
    if obj.hide_get() or obj.hide_viewport or obj.hide_render:
        return True
    return False


def unique_name(desired: str, used: set[str]) -> str:
    if desired not in used:
        used.add(desired)
        return desired
    n = 2
    while f"{desired}_{n:02d}" in used:
        n += 1
    alt = f"{desired}_{n:02d}"
    used.add(alt)
    return alt


def centered_mesh(src, depsgraph):
    """World-space mesh with origin at ground-plane centre, lowest point at Z=0."""
    eval_obj = src.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(eval_obj, preserve_all_data_layers=True, depsgraph=depsgraph)
    mesh.transform(eval_obj.matrix_world)
    if not mesh.vertices:
        bpy.data.meshes.remove(mesh)
        return None
    xs = [v.co.x for v in mesh.vertices]
    ys = [v.co.y for v in mesh.vertices]
    zs = [v.co.z for v in mesh.vertices]
    cx = (min(xs) + max(xs)) * 0.5
    cy = (min(ys) + max(ys)) * 0.5
    zmin = min(zs)
    mesh.transform(Matrix.Translation(Vector((-cx, -cy, -zmin))))
    mesh.update()
    return mesh


def pack_glb(gltf: dict, bin_bytes: bytes) -> bytes:
    json_bytes = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    json_chunk = json_bytes + (b" " * json_pad)
    bin_pad = (4 - (len(bin_bytes) % 4)) % 4
    bin_chunk = bin_bytes + (b"\x00" * bin_pad)
    total = 12 + 8 + len(json_chunk) + (8 + len(bin_chunk) if bin_bytes else 0)
    out = bytearray()
    out += struct.pack("<III", GLB_MAGIC, 2, total)
    out += struct.pack("<II", len(json_chunk), CHUNK_JSON)
    out += json_chunk
    if bin_bytes:
        out += struct.pack("<II", len(bin_chunk), CHUNK_BIN)
        out += bin_chunk
    return bytes(out)


def rewrite_image_uris(gltf: dict, aliases: dict[str, str]) -> None:
    for img in gltf.get("images") or []:
        uri = img.get("uri")
        if not uri or uri.startswith("data:"):
            continue
        base = os.path.basename(uri.replace("\\", "/"))
        img["uri"] = "textures/" + aliases.get(base, base)


def file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def dedupe_textures(tex_dir: str) -> dict[str, str]:
    """Keep one file per content hash. Returns any basename -> kept basename."""
    aliases: dict[str, str] = {}
    if not os.path.isdir(tex_dir):
        return aliases
    by_hash: dict[str, str] = {}
    for name in sorted(os.listdir(tex_dir)):
        path = os.path.join(tex_dir, name)
        if not os.path.isfile(path):
            continue
        digest = file_sha256(path)
        kept = by_hash.get(digest)
        if kept:
            aliases[name] = kept
            os.remove(path)
            continue
        by_hash[digest] = name
        aliases[name] = name
    return aliases


def pack_separate_gltf(gltf_path: str, glb_path: str, aliases: dict[str, str]) -> None:
    """Turn a .gltf + .bin into a GLB that still points at shared texture files."""
    with open(gltf_path, "r", encoding="utf-8") as f:
        gltf = json.load(f)
    folder = os.path.dirname(gltf_path)
    bin_bytes = b""
    buffers = gltf.get("buffers") or []
    if buffers:
        uri = buffers[0].get("uri")
        if uri and not uri.startswith("data:"):
            with open(os.path.join(folder, uri), "rb") as f:
                bin_bytes = f.read()
        buffers[0].pop("uri", None)
        buffers[0]["byteLength"] = len(bin_bytes)
    rewrite_image_uris(gltf, aliases)
    with open(glb_path, "wb") as f:
        f.write(pack_glb(gltf, bin_bytes))
    for leftover in (gltf_path, os.path.splitext(gltf_path)[0] + ".bin"):
        try:
            os.remove(leftover)
        except FileNotFoundError:
            pass


def export_gltf_separate(obj, gltf_path: str) -> None:
    view = bpy.context.view_layer
    for o in view.objects:
        o.select_set(False)
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.hide_render = False
    obj.select_set(True)
    view.objects.active = obj

    wm = bpy.context.window_manager
    window = wm.windows[0] if wm.windows else None
    override = {"window": window, "screen": window.screen} if window else {}

    def do_export():
        bpy.ops.export_scene.gltf(
            filepath=gltf_path,
            use_selection=True,
            export_format="GLTF_SEPARATE",
            export_texture_dir="textures",
            export_keep_originals=False,
            export_unused_images=False,
            export_unused_textures=False,
            export_apply=True,
            export_yup=True,
            export_animations=False,
            export_skins=False,
            export_morph=False,
            export_cameras=False,
            export_lights=False,
            export_extras=False,
        )

    if override:
        with bpy.context.temp_override(**override):
            do_export()
    else:
        do_export()


def main():
    opts = parse_args(after_dash(sys.argv))
    blend_dir = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd()
    out_dir = os.path.abspath(opts["out_dir"] or os.path.join(blend_dir, "export"))
    prefix = opts["prefix"] or "PP"
    os.makedirs(out_dir, exist_ok=True)

    depsgraph = bpy.context.evaluated_depsgraph_get()
    used: set[str] = set()
    written = 0
    skipped = 0

    sources = [obj for obj in bpy.context.scene.objects if not should_skip(obj)]
    sources.sort(key=lambda o: o.name.lower())

    pending: list[tuple[str, str]] = []

    for src in sources:
        name = unique_name(library_name(src.name, prefix), used)
        mesh = centered_mesh(src, depsgraph)
        if mesh is None:
            print(f"[prop-export] skip empty {src.name!r}")
            skipped += 1
            continue
        tmp = bpy.data.objects.new(f"{name}__export", mesh)
        bpy.context.scene.collection.objects.link(tmp)
        tmp.matrix_world = Matrix.Identity(4)
        gltf_path = os.path.join(out_dir, f"{name}.gltf")
        glb_path = os.path.join(out_dir, f"{name}.glb")
        try:
            export_gltf_separate(tmp, gltf_path)
            pending.append((src.name, name))
        finally:
            bpy.data.objects.remove(tmp, do_unlink=True)
            bpy.data.meshes.remove(mesh)

    aliases = dedupe_textures(os.path.join(out_dir, "textures"))
    unique_tex = len(set(aliases.values()))
    print(f"[prop-export] shared textures: {unique_tex} files")
    for src_name, name in pending:
        gltf_path = os.path.join(out_dir, f"{name}.gltf")
        glb_path = os.path.join(out_dir, f"{name}.glb")
        pack_separate_gltf(gltf_path, glb_path, aliases)
        size_kb = os.path.getsize(glb_path) / 1024
        print(f"[prop-export] {src_name!r} → {name}.glb ({size_kb:.0f} KB)")
        written += 1

    print(f"[prop-export] done written={written} skipped={skipped} dir={out_dir}")


if __name__ == "__main__":
    main()
