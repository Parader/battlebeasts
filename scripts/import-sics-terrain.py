#!/usr/bin/env python3
"""Extract SICS terrain layers into the painted-ground library.

The prop importer skips Terrain folders. Those textures are the ground the
packs were authored against, so they belong next to the props.

Writes JPEGs under apps/web/public/ground_textures/sics and the catalog
module packages/shared/src/maps/groundMaterials.sics.ts.

Usage:
  python scripts/import-sics-terrain.py
"""

from __future__ import annotations

import io
import os
import re
import tarfile

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STORE = os.path.join(os.environ.get("APPDATA", ""), "Unity", "Asset Store-5.x", "SICS Games")
OUT_DIR = os.path.join(ROOT, "apps", "web", "public", "ground_textures", "sics")
OUT_TS = os.path.join(ROOT, "packages", "shared", "src", "maps", "groundMaterials.sics.ts")
SIZE = 512

PACKS = {
    "Toon Enchanted Meadow.unitypackage": ("Enchanted Meadow", "meadow"),
    "Toon Golden Valley.unitypackage": ("Golden Valley", "valley"),
    "Toon Deserted Temples.unitypackage": ("Deserted Temples", "temples"),
    "ToonScapes Spring Isles.unitypackage": ("Spring Isles", "isles"),
    "ToonScapes Underworld.unitypackage": ("Underworld", "underworld"),
    "EXPLORER - Stone Age.unitypackage": ("Stone Age", "stoneage"),
}

TILE_RE = re.compile(r"m_TileSize:\s*\{x:\s*([0-9.]+)")
GUID_RE = re.compile(r"guid:\s*([0-9a-f]{32})")


def pathnames(tar: tarfile.TarFile) -> dict[str, str]:
    out: dict[str, str] = {}
    for member in tar:
        if not member.name.endswith("/pathname"):
            continue
        handle = tar.extractfile(member)
        if not handle:
            continue
        path = handle.read().decode("utf-8", "replace").split("\n")[0].replace("\x00", "").strip()
        out[member.name.split("/")[0]] = path
    return out


def read_text(tar: tarfile.TarFile, guid: str) -> str | None:
    try:
        handle = tar.extractfile(guid + "/asset")
    except KeyError:
        return None
    if not handle:
        return None
    data = handle.read()
    if data[:2] == b"\x1f\x8b":
        return None
    return data.decode("utf-8", "replace")


def read_bytes(tar: tarfile.TarFile, guid: str) -> bytes | None:
    try:
        handle = tar.extractfile(guid + "/asset")
    except KeyError:
        return None
    if not handle:
        return None
    return handle.read()


def field_guid(text: str, field: str) -> str | None:
    match = re.search(rf"{field}:[\s\S]{{0,240}}?guid:\s*([0-9a-f]{{32}})", text)
    return match.group(1) if match else None


def prefer_normal(layer_normal: str | None, by_path: dict[str, str]) -> str | None:
    """Height-packed NH maps are a poor fit for a standard normal sample."""
    if not layer_normal:
        return None
    if "NH" not in os.path.basename(layer_normal):
        return layer_normal
    directory, base = layer_normal.rsplit("/", 1)
    stem = os.path.splitext(base.replace("NH", "N", 1))[0]
    for ext in (".png", ".tga", ".jpg"):
        candidate = f"{directory}/{stem}{ext}"
        if candidate in by_path:
            return candidate
    return None


def pretty(diff_path: str) -> str:
    stem = os.path.splitext(os.path.basename(diff_path))[0]
    stem = re.sub(r"^(TEM|TGV|TFD|TSI|TSU|TAI|TFF)_", "", stem)
    stem = re.sub(r"^Terrain_?", "", stem)
    stem = re.sub(r"(?:_D|_SM|D)$", "", stem)
    stem = stem.replace("_", " ").strip()
    return stem or "Ground"


def material_id(pack_slug: str, diff_path: str) -> str:
    stem = os.path.splitext(os.path.basename(diff_path))[0]
    stem = re.sub(r"(?:_D|_SM|D)$", "", stem)
    stem = re.sub(r"[^A-Za-z0-9]+", "_", stem).strip("_").lower()
    return f"sics_{pack_slug}_{stem}"


def chroma(image: Image.Image) -> float:
    small = image.convert("RGB").resize((24, 24))
    total = 0.0
    count = 0
    for red, green, blue in small.getdata():
        total += (max(red, green, blue) - min(red, green, blue)) / 255
        count += 1
    return total / max(1, count)


def save_jpeg(image: Image.Image, dest: str) -> None:
    image = image.convert("RGB")
    if image.size != (SIZE, SIZE):
        image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    image.save(dest, "JPEG", quality=88, optimize=True)


def main() -> None:
    if os.path.isdir(OUT_DIR):
        for name in os.listdir(OUT_DIR):
            os.remove(os.path.join(OUT_DIR, name))
    os.makedirs(OUT_DIR, exist_ok=True)
    rows: list[dict[str, object]] = []
    for dirpath, _, files in os.walk(STORE):
        for filename in files:
            if filename not in PACKS:
                continue
            group, slug = PACKS[filename]
            with tarfile.open(os.path.join(dirpath, filename), "r:gz") as tar:
                paths = pathnames(tar)
                by_path = {path: guid for guid, path in paths.items()}
                chosen: dict[str, tuple[int, float, str | None, str]] = {}
                for guid, path in paths.items():
                    if not path.endswith(".terrainlayer"):
                        continue
                    text = read_text(tar, guid)
                    if not text:
                        continue
                    diff_guid = field_guid(text, "m_DiffuseTexture")
                    nor_guid = field_guid(text, "m_NormalMapTexture")
                    diff = paths.get(diff_guid or "", "")
                    if not diff or "illboard" in diff.lower():
                        continue
                    tile_match = TILE_RE.search(text)
                    tile = float(tile_match.group(1)) if tile_match else 6.0
                    normal = prefer_normal(paths.get(nor_guid or ""), by_path)
                    rank = 0 if os.path.splitext(os.path.basename(diff))[0] in os.path.basename(path) else 1
                    prev = chosen.get(diff)
                    if prev is None or rank < prev[0]:
                        chosen[diff] = (rank, tile, normal, path)

                # Colour maps that never got a terrain layer (stone pavement).
                for path, guid in by_path.items():
                    if "Terrain Texture" not in path:
                        continue
                    if path in chosen:
                        continue
                    base = os.path.basename(path)
                    if "illboard" in base.lower() or "Brush" in base:
                        continue
                    if not re.search(r"D\.(tga|png)$", base, re.I):
                        continue
                    normal_path = path.replace("_D.", "_N.").replace("D.png", "N.png")
                    chosen[path] = (1, 6.0, normal_path if normal_path in by_path else None, path)

                for diff, (_rank, tile, normal, _layer) in sorted(chosen.items(), key=lambda item: item[0]):
                    blob = read_bytes(tar, by_path[diff])
                    if not blob:
                        print("missing", diff)
                        continue
                    image = Image.open(io.BytesIO(blob))
                    image.load()
                    mid = material_id(slug, diff)
                    diff_file = f"{mid}.jpg"
                    save_jpeg(image, os.path.join(OUT_DIR, diff_file))
                    nor_file = ""
                    if normal and normal in by_path:
                        nor_blob = read_bytes(tar, by_path[normal])
                        if nor_blob:
                            nor_image = Image.open(io.BytesIO(nor_blob))
                            nor_file = f"{mid}_n.jpg"
                            save_jpeg(nor_image, os.path.join(OUT_DIR, nor_file))
                    rows.append(
                        {
                            "id": mid,
                            "label": pretty(diff),
                            "group": group,
                            "tile": tile,
                            "diff": f"ground_textures/sics/{diff_file}",
                            "nor": f"ground_textures/sics/{nor_file}" if nor_file else "",
                        }
                    )
                    print(f"{group}: {pretty(diff)} tile {tile:g} nor {'yes' if nor_file else 'no'}")

    lines = [
        "// AUTO-GENERATED by scripts/import-sics-terrain.py — do not edit.",
        "// Terrain colours and normals from the SICS packs, paired with their props.",
        "",
        "export const SICS_GROUND_MATERIALS: ReadonlyArray<{",
        "  id: string;",
        "  label: string;",
        "  diff: string;",
        "  nor: string;",
        "  tile: number;",
        "  group: string;",
        "}> = [",
    ]
    for row in rows:
        nor = row["nor"]
        lines.append(
            "  {"
            f' id: "{row["id"]}",'
            f' label: "{row["label"]}",'
            f' diff: "{row["diff"]}",'
            f' nor: "{nor}",'
            f' tile: {row["tile"]},'
            f' group: "{row["group"]}"'
            " },"
        )
    lines.append("];")
    lines.append("")
    with open(OUT_TS, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines))
    print(f"wrote {len(rows)} materials")


if __name__ == "__main__":
    main()
