#!/usr/bin/env python3
"""Extract SICS Games unitypackages into the prop library, grouped by prefab folder.

The meshes live in a flat Models directory. The folders the map builder should
show (Buildings/Building Kit, Vegetation, Rocks, ...) are the prefab paths.
Each FBX is filed under the prefab that shares its name.

Wrapper packages (Adventure Island, Fantasy Nature) contain a Built-in and a
URP copy of the same meshes. Only the Built-in copy is imported.

Writes .tmp/sics-jobs.json for scripts/blender_sics_to_glb.py.

Usage:
  python scripts/import-sics-kits.py [--only enchanted-meadow]
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tarfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STORE = os.path.join(
    os.environ.get("APPDATA", ""),
    "Unity",
    "Asset Store-5.x",
    "SICS Games",
)
PROPS = os.path.join(ROOT, "apps", "web", "public", "assets", "props")
JOBS = os.path.join(ROOT, ".tmp", "sics-jobs.json")
INNER = os.path.join(ROOT, ".tmp", "sics-inner")
STAGE = os.path.join(ROOT, ".tmp", "sics-fbx")

SLUGS = {
    "Toon Deserted Temples": "deserted-temples",
    "Toon Enchanted Meadow": "enchanted-meadow",
    "Toon Golden Valley": "golden-valley",
    "ToonScapes Spring Isles": "spring-isles",
    "ToonScapes Underworld": "underworld",
    "EXPLORER - Stone Age": "stone-age",
    "Toon Adventure Island": "adventure-island",
    "Toon Fantasy Nature": "fantasy-nature",
}

SKIP_DIR = re.compile(
    r"(^|/)(avatars|colliders|particles|animations|skybox|skyboxes|terrain|shaders|documentation|scenes|demo|profiles)(/|$)",
    re.I,
)
SKIP_NAME = re.compile(r"particle|skybox|collider", re.I)
GUID_RE = re.compile(r"guid:\s*([0-9a-f]{32})")
TEX_RE = re.compile(
    r"- (_MainTex|_BaseMap|_BaseColorMap|_MainTexture):\s*\n\s*m_Texture:\s*\{[^}\n]*guid:\s*([0-9a-f]{32})",
)
NAME_RE = re.compile(r"^\s*m_Name:\s*(\S+)\s*$", re.M)
MODE_RE = re.compile(r"- _Mode:\s*(\d+)")
ALPHA_WORDS = ("vegetation", "flower", "grass", "leaf", "plant", "fern", "bush", "ivy", "vine", "wheat", "bamboo")


def clean_path(raw: bytes) -> str:
    return raw.decode("utf-8", "replace").split("\n")[0].replace("\x00", "").strip().replace("\\", "/")


def safe_seg(seg: str) -> str:
    seg = seg.replace("&", "and")
    seg = re.sub(r"[^A-Za-z0-9._+-]+", "_", seg)
    return seg.strip("_") or "misc"


def arg_only() -> str | None:
    if "--only" in sys.argv:
        i = sys.argv.index("--only")
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


def list_packages() -> list[tuple[str, str]]:
    found = []
    for dirpath, _, files in os.walk(STORE):
        for fn in files:
            if not fn.endswith(".unitypackage"):
                continue
            stem = os.path.splitext(fn)[0]
            slug = SLUGS.get(stem)
            if not slug:
                continue
            found.append((slug, os.path.join(dirpath, fn)))
    return sorted(found)


def read_index(pkg: str) -> dict[str, str]:
    guid_path: dict[str, str] = {}
    with tarfile.open(pkg, "r:gz") as tar:
        for member in tar:
            if not member.name.endswith("/pathname"):
                continue
            f = tar.extractfile(member)
            if not f:
                continue
            guid_path[member.name.split("/")[0]] = clean_path(f.read())
    return guid_path


def is_wrapper(guid_path: dict[str, str]) -> bool:
    files = [p for p in guid_path.values() if os.path.splitext(p)[1]]
    if not files:
        return False
    return sum(1 for p in files if p.lower().endswith(".unitypackage")) >= 1 and not any(
        p.lower().endswith(".fbx") for p in files
    )


def extract_inner(pkg: str, slug: str) -> str:
    os.makedirs(INNER, exist_ok=True)
    guid_path = read_index(pkg)
    inners = [(g, p) for g, p in guid_path.items() if p.lower().endswith(".unitypackage")]
    # One render pipeline. Built-in and URP ship the same meshes.
    inners.sort(key=lambda gp: (0 if "BuiltIn" in gp[1] or "Built-in" in gp[1] else 1, gp[1]))
    guid, path = inners[0]
    dest = os.path.join(INNER, f"{slug}.unitypackage")
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        print(f"  reuse inner {os.path.basename(path)}")
        return dest
    print(f"  extracting inner {os.path.basename(path)}")
    with tarfile.open(pkg, "r:gz") as tar:
        src = tar.extractfile(tar.getmember(guid + "/asset"))
        if not src:
            raise RuntimeError(f"missing inner package in {pkg}")
        with open(dest, "wb") as out:
            shutil.copyfileobj(src, out)
    return dest


def prefab_folder(path: str) -> str | None:
    if "/Prefabs/" not in path:
        return None
    rel = path.split("/Prefabs/", 1)[1]
    folder = os.path.dirname(rel).replace("\\", "/")
    if not folder or SKIP_DIR.search(folder):
        return None
    return folder


def alpha_for(name: str, mode: int, tex_name: str) -> str:
    if mode == 1:
        return "MASK"
    if mode in (2, 3):
        return "BLEND"
    blob = f"{name} {tex_name}".lower()
    if any(w in blob for w in ALPHA_WORDS):
        return "MASK"
    return "OPAQUE"


def choose_runtime(src: str, by_stem: dict[str, list[str]]) -> str | None:
    stem = os.path.splitext(os.path.basename(src))[0]
    if stem.endswith("_Source"):
        stem = stem[: -len("_Source")]
    cands = by_stem.get(stem, [])
    for ext in (".png", ".jpg", ".jpeg", ".tga", ".psd"):
        for p in cands:
            if p.lower().endswith(ext):
                return p
    return None


def parse_materials(pkg: str, guid_path: dict[str, str]) -> dict[str, dict]:
    by_stem: dict[str, list[str]] = {}
    for p in guid_path.values():
        stem = os.path.splitext(os.path.basename(p))[0]
        if stem.endswith("_Source"):
            stem = stem[: -len("_Source")]
        by_stem.setdefault(stem, []).append(p)

    mats: dict[str, dict] = {}
    with tarfile.open(pkg, "r:gz") as tar:
        for guid, path in guid_path.items():
            if not path.lower().endswith(".mat"):
                continue
            if "/Models/Materials/" not in path and "/Materials/" not in path:
                continue
            try:
                member = tar.getmember(guid + "/asset")
            except KeyError:
                continue
            f = tar.extractfile(member)
            if not f:
                continue
            text = f.read().decode("utf-8", "replace")
            name_m = NAME_RE.search(text)
            if not name_m or name_m.group(1).startswith("m_"):
                name_m = re.search(r"m_Name:\s*([A-Za-z0-9_]+)", text)
            if not name_m:
                continue
            name = name_m.group(1)
            found = {prop: g for prop, g in TEX_RE.findall(text)}
            # Some albedo slots point at a texture that was not packed. Remember
            # the guid so a sibling material that names the real file can fill it in.
            runtime = None
            missing_guid = None
            for prop in ("_MainTex", "_BaseMap", "_BaseColorMap", "_MainTexture"):
                guid_tex = found.get(prop)
                if not guid_tex:
                    continue
                src = guid_path.get(guid_tex)
                if src:
                    runtime = choose_runtime(src, by_stem)
                    if runtime:
                        break
                elif missing_guid is None:
                    missing_guid = guid_tex
            if runtime is None:
                runtime = choose_runtime(name + ".png", by_stem)
            mode_m = MODE_RE.search(text)
            mode = int(mode_m.group(1)) if mode_m else 0
            if runtime or missing_guid:
                mats[name] = {
                    "src": runtime or "",
                    "alpha": alpha_for(name, mode, os.path.basename(runtime or name)),
                    "missing": missing_guid,
                }
    # TEM_Atlas_1A.png is in the pack, but several materials cite its guid
    # without the file being linked. Share the resolved file across that guid.
    by_missing: dict[str, str] = {}
    for info in mats.values():
        if info.get("src") and info.get("missing"):
            by_missing[info["missing"]] = info["src"]
    for name, info in list(mats.items()):
        if not info.get("src"):
            src = by_missing.get(info.get("missing") or "")
            if not src:
                del mats[name]
                continue
            info["src"] = src
            info["alpha"] = alpha_for(name, 0, os.path.basename(src))
        info.pop("missing", None)
    return mats


def classify(guid_path: dict[str, str], pkg: str) -> dict[str, str]:
    """fbx guid -> original prefab folder."""
    prefab_by_stem: dict[str, str] = {}
    fbx_guid_by_stem: dict[str, str] = {}
    for guid, path in guid_path.items():
        low = path.lower()
        if low.endswith(".prefab"):
            folder = prefab_folder(path)
            if folder:
                prefab_by_stem[os.path.splitext(os.path.basename(path))[0]] = folder
        elif low.endswith(".fbx"):
            fbx_guid_by_stem[os.path.splitext(os.path.basename(path))[0]] = guid

    # Prefabs that don't share the mesh name (assembled stations) still point at an FBX guid.
    refs: dict[str, set[str]] = {}
    prefab_guids = [g for g, p in guid_path.items() if p.lower().endswith(".prefab") and prefab_folder(p)]
    with tarfile.open(pkg, "r:gz") as tar:
        for guid in prefab_guids:
            folder = prefab_folder(guid_path[guid])
            if not folder:
                continue
            try:
                member = tar.getmember(guid + "/asset")
            except KeyError:
                continue
            f = tar.extractfile(member)
            if not f:
                continue
            text = f.read().decode("utf-8", "replace")
            for g in set(GUID_RE.findall(text)):
                if g in guid_path and guid_path[g].lower().endswith(".fbx"):
                    refs.setdefault(g, set()).add(folder)

    out: dict[str, str] = {}
    for stem, guid in fbx_guid_by_stem.items():
        path = guid_path[guid]
        if SKIP_NAME.search(os.path.basename(path)):
            continue
        parent = os.path.dirname(path)
        if SKIP_DIR.search(parent):
            continue
        folder = prefab_by_stem.get(stem)
        if not folder:
            choices = refs.get(guid) or set()
            if len(choices) == 1:
                folder = next(iter(choices))
            elif choices:
                folder = sorted(choices, key=len)[0]
            else:
                folder = "Models"
        if SKIP_DIR.search(folder):
            continue
        out[guid] = folder
    return out


def extract_member(tar: tarfile.TarFile, guid: str, dest: str) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    src = tar.extractfile(tar.getmember(guid + "/asset"))
    if not src:
        raise RuntimeError(guid)
    with open(dest, "wb") as out:
        shutil.copyfileobj(src, out)


def process(slug: str, pkg: str) -> list[dict]:
    print(f"\n== {slug}")
    guid_path = read_index(pkg)
    if is_wrapper(guid_path):
        pkg = extract_inner(pkg, slug)
        guid_path = read_index(pkg)
    folders = classify(guid_path, pkg)
    mats = parse_materials(pkg, guid_path)
    print(f"  models {len(folders)}  materials {len(mats)}")

    tex_dest: dict[str, str] = {}
    counts: dict[str, int] = {}
    items = []
    path_by_guid = guid_path
    guid_by_path = {}
    for g, p in path_by_guid.items():
        guid_by_path.setdefault(p, g)

    with tarfile.open(pkg, "r:gz") as tar:
        for guid, folder in folders.items():
            src_path = path_by_guid[guid]
            name = os.path.splitext(os.path.basename(src_path))[0]
            segs = [safe_seg(s) for s in folder.split("/") if s]
            rel_dir = "/".join(segs)
            fbx_dest = os.path.join(STAGE, slug, rel_dir, name + ".fbx")
            glb_dest = os.path.join(PROPS, slug, rel_dir, name + ".glb")
            extract_member(tar, guid, fbx_dest)
            counts[folder] = counts.get(folder, 0) + 1
            items.append(
                {
                    "fbx": fbx_dest.replace("\\", "/"),
                    "glb": glb_dest.replace("\\", "/"),
                    "folder": folder,
                }
            )

        # Textures referenced by materials, copied once per pack.
        needed: dict[str, str] = {}
        for info in mats.values():
            src = info["src"]
            if src in needed:
                continue
            ext = os.path.splitext(src)[1].lower()
            base = os.path.splitext(os.path.basename(src))[0]
            if base.endswith("_Source"):
                base = base[: -len("_Source")]
            if ext == ".png" or ext in (".jpg", ".jpeg"):
                dest = os.path.join(PROPS, slug, "textures", base + ext)
            else:
                dest = os.path.join(PROPS, slug, "textures", base + ".png")
            needed[src] = dest
            g = guid_by_path.get(src)
            if not g:
                continue
            raw = dest if ext in (".png", ".jpg", ".jpeg") else os.path.join(STAGE, "_tex", slug, os.path.basename(src))
            extract_member(tar, g, raw)
            tex_dest[src] = raw.replace("\\", "/") if ext not in (".png", ".jpg", ".jpeg") else dest.replace("\\", "/")
            if ext in (".png", ".jpg", ".jpeg"):
                info_dest = dest
            else:
                info_dest = dest
            needed[src] = info_dest

    # Point materials at the public png/jpg path. TGA/PSD still need conversion.
    convert = []
    mat_out = {}
    for name, info in mats.items():
        src = info["src"]
        public = needed.get(src)
        if not public:
            continue
        ext = os.path.splitext(src)[1].lower()
        entry = {"albedo": public.replace("\\", "/"), "alpha": info["alpha"]}
        mat_out[name] = entry
        if ext not in (".png", ".jpg", ".jpeg"):
            raw = tex_dest.get(src)
            if raw:
                convert.append({"src": raw, "dst": public.replace("\\", "/")})

    for folder, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"    {n:4d}  {folder}")
    return [{"biome": slug, "items": items, "materials": mat_out, "convert": convert}]


def main() -> None:
    if not os.path.isdir(STORE):
        print(f"Asset Store folder not found: {STORE}")
        sys.exit(1)
    only = arg_only()
    packs = [(s, p) for s, p in list_packages() if not only or s == only]
    if not packs:
        print("No matching packages.")
        sys.exit(1)
    jobs = []
    for slug, pkg in packs:
        jobs.extend(process(slug, pkg))
    os.makedirs(os.path.dirname(JOBS), exist_ok=True)
    # Merge with an existing job file when --only is used, so a later full run can replace it.
    if only and os.path.exists(JOBS):
        prev = json.loads(open(JOBS, encoding="utf-8").read())
        prev = [j for j in prev if j.get("biome") != only]
        jobs = prev + jobs
    with open(JOBS, "w", encoding="utf-8") as f:
        json.dump(jobs, f)
    models = sum(len(j["items"]) for j in jobs)
    print(f"\n{models} models staged. Jobs -> {JOBS}")


if __name__ == "__main__":
    main()
