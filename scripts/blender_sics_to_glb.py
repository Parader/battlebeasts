"""Convert staged SICS FBX files into GLBs for the prop library.

Keeps LOD0 only, assigns the Unity albedo atlas, and leaves that atlas as one
shared file next to the pack instead of embedding it in every mesh.

Run:
  blender --background --python scripts/blender_sics_to_glb.py -- [--only slug] [--limit N]
"""

from __future__ import annotations

import json
import os
import re
import struct
import sys

import bpy

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
LOD0 = re.compile(r"LOD0", re.I)
SKIP = re.compile(r"LOD[1-9]|MeshCollider|UCX_|Collider", re.I)


def after_dash(argv: list[str]) -> list[str]:
    return argv[argv.index("--") + 1 :] if "--" in argv else []


def parse_args(argv: list[str]) -> dict:
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    jobs = os.path.join(root, ".tmp", "sics-jobs.json")
    only = None
    limit = None
    i = 0
    while i < len(argv):
        if argv[i] == "--jobs" and i + 1 < len(argv):
            jobs = argv[i + 1]
            i += 2
            continue
        if argv[i] == "--only" and i + 1 < len(argv):
            only = argv[i + 1]
            i += 2
            continue
        if argv[i] == "--limit" and i + 1 < len(argv):
            limit = int(argv[i + 1])
            i += 2
            continue
        i += 1
    return {"jobs": jobs, "only": only, "limit": limit}


def pad4(n: int) -> int:
    return (4 - (n % 4)) % 4


def pack_glb(gltf: dict, bin_bytes: bytes) -> bytes:
    # Images stay external. The BIN chunk is geometry only.
    payload = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_pad = pad4(len(payload))
    bin_pad = pad4(len(bin_bytes))
    json_len = len(payload) + json_pad
    bin_len = len(bin_bytes) + bin_pad
    total = 12 + 8 + json_len + (8 + bin_len if bin_bytes else 0)
    out = bytearray(total)
    struct.pack_into("<III", out, 0, GLB_MAGIC, 2, total)
    struct.pack_into("<II", out, 12, json_len, CHUNK_JSON)
    out[20 : 20 + len(payload)] = payload
    out[20 + len(payload) : 20 + json_len] = b" " * json_pad
    if bin_bytes:
        off = 12 + 8 + json_len
        struct.pack_into("<II", out, off, bin_len, CHUNK_BIN)
        out[off + 8 : off + 8 + len(bin_bytes)] = bin_bytes
        out[off + 8 + len(bin_bytes) : off + 8 + bin_len] = b"\x00" * bin_pad
    return bytes(out)


def sock(node, *names):
    for name in names:
        if name in node.inputs:
            return node.inputs[name]
    return None


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def convert_textures(converts: list[dict]) -> None:
    seen = set()
    for job in converts:
        src = job["src"]
        dst = job["dst"]
        if dst in seen or os.path.exists(dst):
            continue
        seen.add(dst)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        try:
            img = bpy.data.images.load(src, check_existing=False)
            # Large TGAs report no data until something touches the pixels.
            _ = len(img.pixels)
            img.filepath_raw = dst
            img.file_format = "PNG"
            img.save()
            print(f"  png {os.path.basename(dst)}")
            bpy.data.images.remove(img)
        except Exception as err:  # noqa: BLE001 — a bad source must not stop the pack
            print(f"  skip {os.path.basename(src)}: {err}")


def keep_meshes() -> list:
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    lod0 = [o for o in meshes if LOD0.search(o.name or "")]
    if lod0:
        return lod0
    return [o for o in meshes if not SKIP.search(o.name or "")]


def bake(obj) -> None:
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = world
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)


def mesh_has_colors(mat) -> bool:
    for obj in bpy.data.objects:
        if obj.type != "MESH" or mat.name not in {s.name for s in obj.material_slots if s.material}:
            continue
        cols = getattr(obj.data, "color_attributes", None)
        if cols and len(cols):
            return True
    return False


def wire_material(mat, info: dict) -> None:
    albedo = info.get("albedo")
    if not albedo or not os.path.exists(albedo):
        return
    if not mat.node_tree:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return
    # The importer's own image node would fight the atlas we assign.
    for node in list(nt.nodes):
        if node.type == "TEX_IMAGE":
            nt.nodes.remove(node)
    img = bpy.data.images.load(albedo, check_existing=True)
    img.colorspace_settings.name = "sRGB"
    img.name = os.path.basename(albedo)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.name = img.name
    color_out = tex.outputs["Color"]
    # These kits paint variation into vertex colors and the atlas supplies the
    # pattern. Leaving the colors unused drops them from the GLB.
    if mesh_has_colors(mat):
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        factor = mix.inputs.get("Factor")
        if factor is not None and not factor.is_linked:
            factor.default_value = 1.0
        vc = nt.nodes.new("ShaderNodeVertexColor")
        nt.links.new(vc.outputs["Color"], mix.inputs["A"])
        nt.links.new(color_out, mix.inputs["B"])
        color_out = mix.outputs["Result"]
    color = sock(bsdf, "Base Color", "BaseColor")
    if color:
        nt.links.new(color_out, color)
    alpha = info.get("alpha")
    if alpha in ("MASK", "BLEND"):
        a = sock(bsdf, "Alpha")
        if a:
            nt.links.new(tex.outputs["Alpha"], a)
        if hasattr(mat, "blend_method"):
            mat.blend_method = "CLIP" if alpha == "MASK" else "BLEND"
        if hasattr(mat, "use_backface_culling"):
            mat.use_backface_culling = False
    rough = sock(bsdf, "Roughness")
    if rough and not rough.is_linked:
        rough.default_value = 1.0
    metal = sock(bsdf, "Metallic")
    if metal and not metal.is_linked:
        metal.default_value = 0.0


def export_one(item: dict, materials: dict) -> None:
    reset_scene()
    bpy.ops.import_scene.fbx(filepath=item["fbx"], use_anim=False)
    kept = keep_meshes()
    if not kept:
        raise RuntimeError("no mesh")
    for obj in list(bpy.data.objects):
        obj.select_set(False)
    for obj in kept:
        bake(obj)
    for mat in bpy.data.materials:
        info = materials.get(mat.name)
        if info:
            wire_material(mat, info)

    glb_path = item["glb"]
    os.makedirs(os.path.dirname(glb_path), exist_ok=True)
    tmp_dir = glb_path + ".tmp"
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_gltf = os.path.join(tmp_dir, "mesh.gltf")
    for obj in kept:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = kept[0]
    bpy.ops.export_scene.gltf(
        filepath=tmp_gltf,
        export_format="GLTF_SEPARATE",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_lights=False,
        export_cameras=False,
    )

    with open(tmp_gltf, encoding="utf-8") as f:
        gltf = json.load(f)
    buf = (gltf.get("buffers") or [{}])[0]
    bin_uri = buf.get("uri")
    bin_bytes = b""
    if bin_uri:
        with open(os.path.join(tmp_dir, bin_uri), "rb") as f:
            bin_bytes = f.read()
        del buf["uri"]
        buf["byteLength"] = len(bin_bytes)

    by_base = {}
    for info in materials.values():
        albedo = info.get("albedo")
        if not albedo:
            continue
        rel = os.path.relpath(albedo, os.path.dirname(glb_path)).replace("\\", "/")
        by_base[os.path.basename(albedo)] = rel
    for img in gltf.get("images") or []:
        base = os.path.basename(img.get("uri") or img.get("name") or "")
        if base in by_base:
            img["uri"] = by_base[base]
            img.pop("bufferView", None)

    for mat in gltf.get("materials") or []:
        info = materials.get(mat.get("name") or "")
        if not info:
            continue
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        pbr["metallicFactor"] = 0
        pbr["roughnessFactor"] = 1
        if info.get("alpha") == "MASK":
            mat["alphaMode"] = "MASK"
            mat["alphaCutoff"] = 0.5
            mat["doubleSided"] = True
        elif info.get("alpha") == "BLEND":
            mat["alphaMode"] = "BLEND"
            mat["doubleSided"] = True
        # The glTF exporter writes the unlinked alpha socket. These kits leave
        # that socket at 0 and put the real alpha in the atlas, which makes
        # every masked fragment fail the cutoff.
        factor = pbr.get("baseColorFactor")
        if factor and len(factor) > 3 and factor[3] < 0.01 and "baseColorTexture" in pbr:
            factor[3] = 1.0

    with open(glb_path, "wb") as f:
        f.write(pack_glb(gltf, bin_bytes))

    for fn in os.listdir(tmp_dir):
        try:
            os.remove(os.path.join(tmp_dir, fn))
        except OSError:
            pass
    try:
        os.rmdir(tmp_dir)
    except OSError:
        pass


def main() -> None:
    args = parse_args(after_dash(sys.argv))
    with open(args["jobs"], encoding="utf-8") as f:
        jobs = json.load(f)
    done = 0
    failed = 0
    for pack in jobs:
        if args["only"] and pack.get("biome") != args["only"]:
            continue
        print(f"\n== {pack['biome']}  {len(pack['items'])} models")
        convert_textures(pack.get("convert") or [])
        materials = pack.get("materials") or {}
        for item in pack["items"]:
            if args["limit"] is not None and done >= args["limit"]:
                print(f"limit {args['limit']} reached")
                return
            if os.path.exists(item["glb"]) and os.path.getsize(item["glb"]) > 0:
                done += 1
                continue
            try:
                export_one(item, materials)
                done += 1
                if done % 25 == 0:
                    print(f"  {done} written")
            except Exception as err:  # noqa: BLE001 — keep going through the pack
                failed += 1
                print(f"  FAIL {os.path.basename(item['fbx'])}: {err}")
    print(f"\nwritten-or-skipped {done}  failed {failed}")


if __name__ == "__main__":
    main()
