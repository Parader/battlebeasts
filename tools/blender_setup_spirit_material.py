"""
Build the bound-spirit material on the hero bind-pose workbench.

Uses UVBake + cavity / roughness PNGs next to the .blend. Does not touch
hero.blend or the game's hero.glb.

Usage (from the repo root):

    blender "C:/Users/deric/OneDrive/Documents/mage_trials/player/hero_bind.blend" `
        --background --python tools/blender_setup_spirit_material.py -- `
        --out "C:/Users/deric/OneDrive/Documents/mage_trials/player/hero_bind.blend"
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Wire bound-spirit PBR on Beta_Surface")
    p.add_argument("--blend", type=Path, default=None)
    p.add_argument("--out", type=Path, default=None)
    p.add_argument(
        "--cavity",
        type=Path,
        default=None,
        help="Override cavity PNG (default: Beta_Cavity.png beside the blend)",
    )
    p.add_argument(
        "--roughness",
        type=Path,
        default=None,
        help="Override roughness PNG (default: Beta_Roughness.png beside the blend)",
    )
    p.add_argument("--emission", type=float, default=7.0, help="Principled emission strength")
    return p.parse_args(argv)


def find_body():
    import bpy

    for obj in bpy.data.objects:
        if obj.type == "MESH" and "beta_surface" in obj.name.lower():
            return obj
    raise RuntimeError("Beta_Surface not found")


def ensure_uvbake(obj) -> str:
    names = [uv.name for uv in obj.data.uv_layers]
    if "UVBake" not in names:
        raise RuntimeError(
            f"UVBake missing on {obj.name} (have {names}). Finish the unique unwrap first."
        )
    obj.data.uv_layers["UVBake"].active = True
    obj.data.uv_layers["UVBake"].active_render = True
    return "UVBake"


def load_image(path: Path, non_color: bool):
    import bpy

    img = bpy.data.images.load(str(path), check_existing=True)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    img.alpha_mode = "NONE"
    return img


def new_tex_node(nodes, img, loc):
    n = nodes.new("ShaderNodeTexImage")
    n.location = loc
    n.image = img
    n.interpolation = "Linear"
    n.projection = "FLAT"
    n.extension = "EXTEND"
    return n


def build_spirit_material(obj, cavity_path: Path, rough_path: Path, emission: float):
    import bpy

    mat = obj.active_material
    if mat is None:
        mat = bpy.data.materials.new("SpiritVessel")
        if obj.data.materials:
            obj.data.materials[0] = mat
        else:
            obj.data.materials.append(mat)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    nodes.clear()

    cavity_img = load_image(cavity_path, non_color=True)
    rough_img = load_image(rough_path, non_color=True)

    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (1100, 80)

    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (780, 80)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["IOR"].default_value = 1.45
    if "Alpha" in bsdf.inputs:
        bsdf.inputs["Alpha"].default_value = 1.0
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    uv = nodes.new("ShaderNodeUVMap")
    uv.location = (-720, 40)
    uv.uv_map = "UVBake"

    cavity = new_tex_node(nodes, cavity_img, (-480, 220))
    cavity.label = "Cavity"
    rough = new_tex_node(nodes, rough_img, (-480, -80))
    rough.label = "Roughness"
    links.new(uv.outputs["UV"], cavity.inputs["Vector"])
    links.new(uv.outputs["UV"], rough.inputs["Vector"])

    # Pale albedo so hide tint still works later; cavity dirties creases.
    tint = nodes.new("ShaderNodeRGB")
    tint.location = (-220, 360)
    tint.label = "Hide preview"
    tint.outputs[0].default_value = (0.82, 0.90, 1.0, 1.0)

    mul = nodes.new("ShaderNodeMix")
    mul.location = (40, 260)
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.clamp_factor = True
    mul.inputs["Factor"].default_value = 0.55
    links.new(tint.outputs[0], mul.inputs["A"])
    links.new(cavity.outputs["Color"], mul.inputs["B"])
    links.new(mul.outputs["Result"], bsdf.inputs["Base Color"])

    links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])

    # Mixamo "joints" are empty gaps between pieces — cavity cannot light air.
    # Fresnel rims each capsule so the gap reads as energy.
    layer = nodes.new("ShaderNodeLayerWeight")
    layer.location = (-220, -160)
    layer.label = "Rim"
    layer.inputs["Blend"].default_value = 0.38

    rim_ramp = nodes.new("ShaderNodeValToRGB")
    rim_ramp.location = (40, -160)
    rim_ramp.label = "Rim glow"
    rim_ramp.color_ramp.interpolation = "EASE"
    rim_ramp.color_ramp.elements[0].position = 0.05
    rim_ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    rim_ramp.color_ramp.elements[1].position = 0.55
    rim_ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
    links.new(layer.outputs["Fresnel"], rim_ramp.inputs["Fac"])

    fold_ramp = nodes.new("ShaderNodeValToRGB")
    fold_ramp.location = (40, -380)
    fold_ramp.label = "Fold glow"
    fold_ramp.color_ramp.interpolation = "EASE"
    fold_ramp.color_ramp.elements[0].position = 0.0
    fold_ramp.color_ramp.elements[0].color = (0.65, 0.65, 0.65, 1.0)
    fold_ramp.color_ramp.elements[1].position = 0.55
    fold_ramp.color_ramp.elements[1].color = (0.0, 0.0, 0.0, 1.0)
    links.new(cavity.outputs["Color"], fold_ramp.inputs["Fac"])

    add_glow = nodes.new("ShaderNodeMix")
    add_glow.location = (280, -240)
    add_glow.data_type = "RGBA"
    add_glow.blend_type = "ADD"
    add_glow.clamp_factor = True
    add_glow.inputs["Factor"].default_value = 1.0
    links.new(rim_ramp.outputs["Color"], add_glow.inputs["A"])
    links.new(fold_ramp.outputs["Color"], add_glow.inputs["B"])

    emit_mix = nodes.new("ShaderNodeMix")
    emit_mix.location = (500, -180)
    emit_mix.data_type = "RGBA"
    emit_mix.blend_type = "MULTIPLY"
    emit_mix.clamp_factor = True
    emit_mix.inputs["Factor"].default_value = 1.0
    links.new(tint.outputs[0], emit_mix.inputs["A"])
    links.new(add_glow.outputs["Result"], emit_mix.inputs["B"])

    # Principled Emission Color / Strength (Blender 4/5 names).
    emit_color = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
    emit_str = bsdf.inputs.get("Emission Strength")
    if emit_color is None:
        raise RuntimeError("Principled BSDF has no Emission input")
    links.new(emit_mix.outputs["Result"], emit_color)
    if emit_str is not None:
        emit_str.default_value = emission

    mat.name = "SpiritVessel"
    print(f"[spirit] material {mat.name} on {obj.name}")
    print(f"[spirit] cavity={cavity_path.name}  roughness={rough_path.name}  emission={emission}")


def main() -> None:
    import bpy

    args = parse_args(sys.argv)
    if args.blend:
        blend = Path(args.blend)
        if not blend.is_file():
            raise SystemExit(f"Blend not found: {blend}")
        bpy.ops.wm.open_mainfile(filepath=str(blend))

    if not bpy.data.filepath:
        raise SystemExit("No .blend is open.")

    src = Path(bpy.data.filepath)
    folder = src.parent
    cavity = args.cavity or folder / "Beta_Cavity.png"
    rough = args.roughness or folder / "Beta_Roughness.png"
    if not cavity.is_file():
        cavity = folder / "Beta_AO.png"
    if not cavity.is_file():
        raise SystemExit(f"Cavity PNG not found next to {src}")
    if not rough.is_file():
        raise SystemExit(f"Roughness PNG not found: {rough}")

    body = find_body()
    ensure_uvbake(body)
    build_spirit_material(body, cavity, rough, args.emission)

    world = bpy.data.worlds[0] if bpy.data.worlds else None
    if world and world.use_nodes:
        bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
        if bg and "Strength" in bg.inputs:
            bg.inputs["Strength"].default_value = 0.12
            print("[spirit] darkened world so emission reads")

    scene = bpy.context.scene
    if hasattr(scene.eevee, "use_bloom"):
        scene.eevee.use_bloom = True
        print("[spirit] Eevee bloom on")

    out = Path(args.out) if args.out else src
    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    print(f"[spirit] saved {out}")
    print("[spirit] Open in Cycles Rendered. Tweak RGB 'Hide preview' and Emission Strength.")


if __name__ == "__main__":
    main()
