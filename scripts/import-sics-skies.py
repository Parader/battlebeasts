#!/usr/bin/env python3
"""Extract SICS skyboxes into the map sky library.

Every preset becomes one latitude-longitude panorama (JPEG). Cubemap
faces are folded into that picture so the editor and the game share one
image, and the picker thumbnail is the same sky the viewport draws.

ToonScapes skies are a transparent cloud panorama over a colour gradient.
Underworld skies are Unity's procedural gradient with no image. Both are
baked to a panorama so the runtime only has to show a picture.

Wrapper packs (Adventure Island, Fantasy Nature) contribute the Built-in copy.

Usage:
  python scripts/import-sics-skies.py
"""

from __future__ import annotations

import io
import os
import re
import shutil
import tarfile

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STORE = os.path.join(os.environ.get("APPDATA", ""), "Unity", "Asset Store-5.x", "SICS Games")
OUT = os.path.join(ROOT, "apps", "web", "public", "assets", "skies")
GEN = os.path.join(ROOT, "packages", "shared", "src", "maps", "skies.generated.ts")
INNER = os.path.join(ROOT, ".tmp", "sics-sky-inner")

PACKS = [
    ("Toon Adventure Island", "adventure-island", "Adventure Island"),
    ("Toon Deserted Temples", "deserted-temples", "Deserted Temples"),
    ("Toon Enchanted Meadow", "enchanted-meadow", "Enchanted Meadow"),
    ("Toon Fantasy Nature", "fantasy-nature", "Fantasy Nature"),
    ("Toon Golden Valley", "golden-valley", "Golden Valley"),
    ("ToonScapes Spring Isles", "spring-isles", "Spring Isles"),
    ("EXPLORER - Stone Age", "stone-age", "Stone Age"),
    ("ToonScapes Underworld", "underworld", "Underworld"),
]

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".tga", ".psd", ".tif", ".tiff")
FACE_ORDER = ("px", "nx", "py", "ny", "pz", "nz")
UNITY_FACE = {"px": "right", "nx": "left", "py": "up", "ny": "down", "pz": "front", "nz": "back"}
# A 45° camera across a desktop view needs about 8K of panorama or the
# horizon is only a few hundred texels wide and looks blocky.
LATLONG_W = 8192
JPEG_QUALITY = 92


def clean_path(raw: bytes) -> str:
    return raw.decode("utf-8", "replace").split("\n")[0].replace("\x00", "").strip().replace("\\", "/")


def find_package(stem: str) -> str:
    for dirpath, _, files in os.walk(STORE):
        name = stem + ".unitypackage"
        if name in files:
            return os.path.join(dirpath, name)
    raise SystemExit(f"missing package {stem}")


def read_index(tar: tarfile.TarFile) -> dict[str, str]:
    guid_path: dict[str, str] = {}
    for member in tar:
        if not member.name.endswith("/pathname"):
            continue
        f = tar.extractfile(member)
        if f:
            guid_path[member.name.split("/")[0]] = clean_path(f.read())
    return guid_path


def read_bytes(tar: tarfile.TarFile, guid: str) -> bytes:
    f = tar.extractfile(tar.getmember(guid + "/asset"))
    if not f:
        raise RuntimeError(f"missing asset {guid}")
    return f.read()


def open_image(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


def is_sky(path: str) -> bool:
    low = path.lower()
    return "/skybox/" in low or "/skyboxes/" in low


def face_token(stem: str) -> str | None:
    s = stem.lower()
    for name in ("front", "back", "left", "right", "up", "down", "px", "nx", "py", "ny", "pz", "nz"):
        if s == name or s.endswith("_" + name):
            return name
    return None


def choose_image(cands: list[str]) -> str | None:
    for ext in (".png", ".jpg", ".jpeg", ".tga", ".psd", ".tif", ".tiff"):
        for path in cands:
            if path.lower().endswith(ext):
                return path
    return cands[0] if cands else None


def faces_in(paths: list[str]) -> list[str] | None:
    by_token: dict[str, list[str]] = {}
    for path in paths:
        if not path.lower().endswith(IMAGE_EXT):
            continue
        token = face_token(os.path.splitext(os.path.basename(path))[0])
        if token:
            by_token.setdefault(token, []).append(path)

    def take(name: str) -> str | None:
        return choose_image(by_token.get(name, []))

    if all(take(name) for name in FACE_ORDER):
        return [take(name) for name in FACE_ORDER]  # type: ignore[misc]
    if all(take(UNITY_FACE[name]) for name in FACE_ORDER):
        return [take(UNITY_FACE[name]) for name in FACE_ORDER]  # type: ignore[misc]
    return None


def label_for(stem: str) -> str:
    text = re.sub(r"^[A-Z]{2,5}_", "", stem).replace("_", " ")
    text = re.sub(r"\s+", " ", text).strip()
    if text.lower().startswith("skybox ") and not re.match(r"(?i)skybox \d", text):
        text = text[7:].strip()
    return text or stem


def equirect_from_faces(images: list[Image.Image], width: int = LATLONG_W) -> Image.Image:
    """Fold +X -X +Y -Y +Z -Z faces into a lat-long panorama.

    The top row is the zenith and the middle row is the horizon, matching
    the panoramic skies and the equirectangular background the view uses.
    """
    height = width // 2
    faces = [np.asarray(image.convert("RGB")) for image in images]
    ys = np.arange(height)
    xs = np.arange(width)
    v = 1.0 - (ys + 0.5) / height
    u = (xs + 0.5) / width
    phi = (v - 0.5) * np.pi
    theta = (u - 0.5) * (2.0 * np.pi)
    dy = np.sin(phi).astype(np.float32)[:, None]
    horiz = np.cos(phi).astype(np.float32)[:, None]
    dx = np.cos(theta).astype(np.float32)[None, :] * horiz
    dz = np.sin(theta).astype(np.float32)[None, :] * horiz
    ax, ay, az = np.abs(dx), np.abs(dy), np.abs(dz)
    out = np.zeros((height, width, 3), np.uint8)
    specs = (
        (0, -dz, -dy, ax, (ax >= ay) & (ax >= az) & (dx >= 0)),
        (1, dz, -dy, ax, (ax >= ay) & (ax >= az) & (dx < 0)),
        (2, dx, dz, ay, (ay > ax) & (ay >= az) & (dy >= 0)),
        (3, dx, -dz, ay, (ay > ax) & (ay >= az) & (dy < 0)),
        (4, dx, -dy, az, (az > ax) & (az > ay) & (dz >= 0)),
        (5, -dx, -dy, az, (az > ax) & (az > ay) & (dz < 0)),
    )
    # Sample in strips so an 8K bake does not hold four full float copies.
    for y0 in range(0, height, 64):
        y1 = min(height, y0 + 64)
        rows = slice(y0, y1)
        for index, sc, tc, major, mask in specs:
            band = mask[rows]
            if not band.any():
                continue
            src = faces[index]
            h, w = src.shape[:2]
            uu = (sc[rows] / np.maximum(major[rows], 1e-8) + 1.0) * 0.5
            vv = (tc[rows] / np.maximum(major[rows], 1e-8) + 1.0) * 0.5
            x = np.clip(uu, 0.0, 0.999999) * (w - 1)
            y = np.clip(vv, 0.0, 0.999999) * (h - 1)
            ix0 = np.floor(x).astype(np.int32)
            iy0 = np.floor(y).astype(np.int32)
            ix1 = np.minimum(ix0 + 1, w - 1)
            iy1 = np.minimum(iy0 + 1, h - 1)
            fx = (x - ix0)[band][:, None]
            fy = (y - iy0)[band][:, None]
            c00 = src[iy0[band], ix0[band]].astype(np.float32)
            c10 = src[iy0[band], ix1[band]].astype(np.float32)
            c01 = src[iy1[band], ix0[band]].astype(np.float32)
            c11 = src[iy1[band], ix1[band]].astype(np.float32)
            blended = c00 * (1 - fx) * (1 - fy) + c10 * fx * (1 - fy) + c01 * (1 - fx) * fy + c11 * fx * fy
            layer = out[rows]
            layer[band] = np.clip(blended, 0, 255).astype(np.uint8)
            out[rows] = layer
    return Image.fromarray(out)


def save_jpeg(image: Image.Image, dest: str, max_side: int) -> None:
    image = image.convert("RGB")
    w, h = image.size
    scale = min(1.0, max_side / max(w, h))
    if scale < 1:
        image = image.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    image.save(dest, "JPEG", quality=JPEG_QUALITY, optimize=True, subsampling=0)


def color_of(text: str, key: str, fallback: tuple[float, float, float]) -> tuple[float, float, float]:
    match = re.search(rf"{re.escape(key)}:\s*\{{r:\s*([\d.]+),\s*g:\s*([\d.]+),\s*b:\s*([\d.]+)", text)
    if not match:
        return fallback
    return tuple(float(match.group(i)) for i in (1, 2, 3))  # type: ignore[return-value]


def float_of(text: str, key: str, fallback: float) -> float:
    match = re.search(rf"{re.escape(key)}:\s*(-?[\d.]+)", text)
    return float(match.group(1)) if match else fallback


def gradient(height: int, width: int, zenith, equator, nadir, thickness: float) -> np.ndarray:
    y = np.linspace(0, 1, height, dtype=np.float32)[:, None]
    power = 1.0 / max(thickness, 0.25)
    up_t = np.clip(y / 0.5, 0, 1) ** power
    down_t = np.clip((y - 0.5) / 0.5, 0, 1)
    upper = zenith * (1 - up_t) + equator * up_t
    lower = equator * (1 - down_t) + nadir * down_t
    column = np.where(y < 0.5, upper, lower)
    return np.broadcast_to(column[:, None, :], (height, width, 3)).copy()


def roll(image: np.ndarray, degrees: float) -> np.ndarray:
    shift = int(round((-degrees / 360.0) * image.shape[1]))
    return np.roll(image, shift, axis=1)


def composite_layers(bg: Image.Image, mg: Image.Image | None, zenith, equator, nadir, thickness, bg_rot, mg_rot) -> Image.Image:
    w, h = LATLONG_W, LATLONG_W // 2
    bg_np = np.asarray(bg.resize((w, h), Image.Resampling.LANCZOS).convert("RGBA"), dtype=np.float32)
    bg_np = roll(bg_np, bg_rot)
    sky = gradient(h, w, np.array(zenith, dtype=np.float32) * 255, np.array(equator, dtype=np.float32) * 255, np.array(nadir, dtype=np.float32) * 255, thickness)
    alpha = bg_np[:, :, 3:4] / 255.0
    out = sky * (1 - alpha) + bg_np[:, :, :3] * alpha
    if mg is not None:
        mg_np = np.asarray(mg.resize((w, h), Image.Resampling.LANCZOS).convert("RGBA"), dtype=np.float32)
        mg_np = roll(mg_np, mg_rot)
        malpha = mg_np[:, :, 3:4] / 255.0
        out = out * (1 - malpha) + mg_np[:, :, :3] * malpha
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def bake_gradient_image(zenith, equator, nadir, thickness, exposure: float) -> Image.Image:
    w, h = LATLONG_W, LATLONG_W // 2
    sky = gradient(
        h,
        w,
        np.array(zenith, dtype=np.float32) * 255 * exposure,
        np.array(equator, dtype=np.float32) * 255 * exposure,
        np.array(nadir, dtype=np.float32) * 255 * exposure,
        thickness,
    )
    return Image.fromarray(np.clip(sky, 0, 255).astype(np.uint8), "RGB")


def public_url(slug: str, *parts: str) -> str:
    return "/assets/skies/" + "/".join((slug, *parts))


def open_content(pkg: str, slug: str) -> tuple[tarfile.TarFile, dict[str, str]]:
    tar = tarfile.open(pkg, "r:gz")
    guid_path = read_index(tar)
    inners = [(g, p) for g, p in guid_path.items() if p.lower().endswith(".unitypackage")]
    has_image = any(is_sky(p) and p.lower().endswith(IMAGE_EXT) for p in guid_path.values())
    if inners and not has_image:
        inners.sort(key=lambda gp: (0 if "BuiltIn" in gp[1] or "Built-in" in gp[1] else 1, gp[1]))
        guid, path = inners[0]
        os.makedirs(INNER, exist_ok=True)
        dest = os.path.join(INNER, f"{slug}.unitypackage")
        print(f"  inner {os.path.basename(path)}")
        with open(dest, "wb") as out:
            out.write(read_bytes(tar, guid))
        tar.close()
        tar = tarfile.open(dest, "r:gz")
        guid_path = read_index(tar)
    return tar, guid_path


def import_pack(stem: str, slug: str, pack: str) -> list[dict]:
    print(f"\n{pack}")
    pkg = find_package(stem)
    tar, guid_path = open_content(pkg, slug)
    path_guid = {p: g for g, p in guid_path.items()}
    try:
        mats = sorted(p for p in guid_path.values() if is_sky(p) and p.lower().endswith(".mat"))
        images = [p for p in guid_path.values() if is_sky(p) and p.lower().endswith(IMAGE_EXT)]
        by_dir: dict[str, list[str]] = {}
        for path in images:
            by_dir.setdefault(os.path.dirname(path), []).append(path)

        background = next((p for p in images if "background" in os.path.basename(p).lower()), None)
        bg_image = open_image(read_bytes(tar, path_guid[background])) if background else None

        entries = []
        for mat_path in mats:
            stem_name = os.path.splitext(os.path.basename(mat_path))[0]
            mat_text = read_bytes(tar, path_guid[mat_path]).decode("utf-8", "replace")
            dest_dir = os.path.join(OUT, slug)
            entry_id = f"{slug}/{stem_name}"
            label = label_for(stem_name)

            face_paths = None
            own = faces_in(by_dir.get(os.path.dirname(mat_path), []))
            named = None
            for directory, paths in by_dir.items():
                if os.path.basename(directory).lower() == stem_name.lower():
                    named = faces_in(paths)
                    if named:
                        break
            if own:
                face_paths = own
            elif named:
                face_paths = named
            else:
                keys = [k for k in ("sunset", "night", "day") if k in stem_name.lower()]
                hits = []
                for directory, paths in by_dir.items():
                    folder = os.path.basename(directory).lower()
                    if keys and any(k in folder for k in keys):
                        found = faces_in(paths)
                        if found:
                            hits.append(found)
                if len(hits) == 1:
                    face_paths = hits[0]

            if face_paths:
                baked = equirect_from_faces([open_image(read_bytes(tar, path_guid[src])) for src in face_paths])
                dest = os.path.join(dest_dir, f"{stem_name}.jpg")
                save_jpeg(baked, dest, LATLONG_W)
                entries.append({"id": entry_id, "label": label, "pack": pack, "url": public_url(slug, f"{stem_name}.jpg")})
                print(f"  cube {stem_name}")
                continue

            sibling = None
            folder = os.path.dirname(mat_path)
            for ext in (".png", ".jpg", ".jpeg", ".tga"):
                cand = f"{folder}/{stem_name}{ext}"
                for path in images:
                    if path.lower() == cand.lower():
                        sibling = path
                        break
                if sibling:
                    break
            if sibling:
                dest = os.path.join(dest_dir, f"{stem_name}.jpg")
                save_jpeg(open_image(read_bytes(tar, path_guid[sibling])), dest, LATLONG_W)
                entries.append({"id": entry_id, "label": label, "pack": pack, "url": public_url(slug, f"{stem_name}.jpg")})
                print(f"  panorama {stem_name}")
                continue

            if bg_image is not None:
                # The midground TGA is a distortion layer (red/cyan), not cloud colour.
                # The painted clouds live in the background, over the sky gradient.
                zenith = color_of(mat_text, "_ZenithColorDay", (0.15, 0.35, 0.8))
                equator = color_of(mat_text, "_EquatorColorDay", (0.45, 0.62, 0.85))
                nadir = color_of(mat_text, "_NadirColorDay", (0.1, 0.16, 0.28))
                baked = composite_layers(
                    bg_image,
                    None,
                    zenith,
                    equator,
                    nadir,
                    1.0,
                    float_of(mat_text, "_BackgroundRotation", 0),
                    float_of(mat_text, "_MidgroundRotation", 0),
                )
                dest = os.path.join(dest_dir, f"{stem_name}.jpg")
                save_jpeg(baked, dest, LATLONG_W)
                entries.append({"id": entry_id, "label": label, "pack": pack, "url": public_url(slug, f"{stem_name}.jpg")})
                print(f"  layered {stem_name}")
                continue

            if "_SkyTint:" in mat_text or "_SkyTint :" in mat_text:
                sky = color_of(mat_text, "_SkyTint", (0.2, 0.4, 0.8))
                ground = color_of(mat_text, "_GroundColor", (0.15, 0.18, 0.22))
                equator = tuple(min(1.0, c * 0.65 + 0.35) for c in sky)
                exposure = float_of(mat_text, "_Exposure", 1)
                thickness = float_of(mat_text, "_AtmosphereThickness", 1)
                dest = os.path.join(dest_dir, f"{stem_name}.jpg")
                save_jpeg(bake_gradient_image(sky, equator, ground, thickness, exposure), dest, LATLONG_W)
                entries.append({"id": entry_id, "label": label, "pack": pack, "url": public_url(slug, f"{stem_name}.jpg")})
                print(f"  gradient {stem_name}")
                continue

            print(f"  skip {stem_name}")
        return entries
    finally:
        tar.close()


def write_catalog(entries: list[dict]) -> None:
    lines = [
        "// AUTO-GENERATED by scripts/import-sics-skies.py — do not edit.",
        "",
        "export type SkyboxDef = {",
        "  id: string;",
        "  label: string;",
        "  pack: string;",
        "  /** Equirectangular panorama. Also the picker thumbnail. */",
        "  url: string;",
        "};",
        "",
        "export const SKYBOXES: readonly SkyboxDef[] = [",
    ]
    for entry in entries:
        lines.append(
            f'  {{ id: "{entry["id"]}", label: "{entry["label"]}", pack: "{entry["pack"]}", url: "{entry["url"]}" }},'
        )
    lines.append("];")
    lines.append("")
    os.makedirs(os.path.dirname(GEN), exist_ok=True)
    with open(GEN, "w", encoding="utf-8", newline="\n") as out:
        out.write("\n".join(lines))


def main() -> None:
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    entries: list[dict] = []
    try:
        for stem, slug, pack in PACKS:
            entries.extend(import_pack(stem, slug, pack))
    finally:
        shutil.rmtree(INNER, ignore_errors=True)
    write_catalog(entries)
    print(f"\n{len(entries)} skies -> {os.path.relpath(GEN, ROOT)}")


if __name__ == "__main__":
    main()
