"""
Export workbench skins.

Tags in Blender (Sidebar → Character → Skins) override tools/skin_manifest.py.
Rig: One bone vs Skinned.

    pnpm export:skins
    pnpm export:skins -- --only shoes_set_1
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import blender_export_skin as skin  # noqa: E402
from skin_manifest import BIND, SKINS  # noqa: E402


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Export all (or selected) workbench skins")
    p.add_argument("--blend", type=Path, default=BIND)
    p.add_argument("--out-dir", type=Path, default=None)
    p.add_argument(
        "--only",
        type=str,
        default="",
        help="Comma-separated catalog ids (e.g. shoes_set_1,chest_set_1)",
    )
    p.add_argument("--list", action="store_true", help="Print jobs and exit")
    p.add_argument(
        "--stale",
        action="store_true",
        help="Only missing GLBs or meshes edited since last export",
    )
    return p.parse_args(argv)


def job_key(job: dict) -> str:
    return f"{job['id']}::{job.get('body') or 'any'}"


def default_skin_file(cid: str, body: str, tagged: str) -> str:
    file = (tagged or "").strip()
    if body == "male" and (not file or file == f"{cid}.glb"):
        return f"{cid}_male.glb"
    return file or f"{cid}.glb"


def jobs_from_blender() -> list[dict]:
    import bpy

    if not hasattr(bpy.types.Object, "bb_skin"):
        return []
    groups: dict[str, list] = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        settings = obj.bb_skin
        cid = (settings.catalog_id or "").strip()
        if not settings.export or not cid:
            continue
        body = getattr(settings, "body", None) or "any"
        groups.setdefault(f"{cid}::{body}", []).append(obj)

    jobs: list[dict] = []
    for _key, objs in groups.items():
        head = objs[0].bb_skin
        cid = (head.catalog_id or "").strip()
        body = getattr(head, "body", None) or "any"
        rig = head.rig
        meshes = [obj.name for obj in objs]
        if rig == "rigid":
            bones = []
            for obj in objs:
                bone = obj.bb_skin.bone
                if not bone or bone == "NONE":
                    raise RuntimeError(f"{cid}: {obj.name} needs a Bone (set Rig to One bone)")
                bones.append(bone)
        else:
            bones = []
            seen: set[str] = set()
            for obj in objs:
                bone = obj.bb_skin.bone
                if bone and bone != "NONE" and bone not in seen:
                    seen.add(bone)
                    bones.append(bone)
        prep = head.prep if head.prep and head.prep != "none" else None
        keep_weights = any(obj.bb_skin.keep_weights for obj in objs)
        jobs.append(
            {
                "id": cid,
                "slot": head.slot,
                "name": title_from_id(cid),
                "file": default_skin_file(cid, body, head.file),
                "meshes": meshes,
                "bones": bones,
                "rig": rig,
                "prep": prep,
                "keep_weights": keep_weights,
                "body": body,
            }
        )
    return jobs


def collect_jobs(only: str, body: str | None = None) -> list[dict]:
    blender_jobs: list[dict] = []
    try:
        blender_jobs = jobs_from_blender()
    except RuntimeError:
        raise
    except Exception as exc:
        print(f"[skins] blender tags unread ({exc}); using manifest")

    tagged_ids = {job["id"] for job in blender_jobs}
    by_key: dict[str, dict] = {}
    for row in SKINS:
        if row["id"] in tagged_ids:
            continue
        by_key[job_key(row)] = dict(row)
    for job in blender_jobs:
        by_key[job_key(job)] = job
    jobs = list(by_key.values())
    if only.strip():
        want = {s.strip() for s in only.split(",") if s.strip()}
        jobs = [job for job in jobs if job["id"] in want]
        missing = want - {job["id"] for job in jobs}
        if missing:
            known = ", ".join(sorted({job["id"] for job in by_key.values()} | tagged_ids))
            raise SystemExit(f"Unknown id(s): {', '.join(sorted(missing))}. Known: {known}")
    if body:
        jobs = [job for job in jobs if (job.get("body") or "any") == body]
    return jobs


def selected_jobs(only: str) -> list[dict]:
    return collect_jobs(only)


def mesh_fingerprint(obj) -> str:
    me = obj.data
    acc = 0
    for i, vert in enumerate(me.vertices):
        if i > 96:
            break
        for g in vert.groups:
            acc = (acc + int(g.weight * 1000) * (g.group + 1) * (i + 3)) % 2_000_000_000
    settings = getattr(obj, "bb_skin", None)
    keep = int(bool(getattr(settings, "keep_weights", False))) if settings else 0
    rig = getattr(settings, "rig", "") if settings else ""
    body = getattr(settings, "body", "") if settings else ""
    return f"{len(me.vertices)}:{len(me.polygons)}:{len(obj.vertex_groups)}:{keep}:{rig}:{body}:{acc}"


def stamp_job_fingerprint(spec: dict) -> None:
    import bpy

    for name in spec.get("meshes") or []:
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH":
            continue
        settings = getattr(obj, "bb_skin", None)
        if settings is None or not hasattr(settings, "export_fp"):
            continue
        settings.export_fp = mesh_fingerprint(obj)


def job_is_stale(job: dict, out_dir: Path) -> bool:
    import bpy

    dest = out_dir / job["file"]
    if not dest.is_file():
        return True
    for name in job.get("meshes") or []:
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH":
            return True
        settings = getattr(obj, "bb_skin", None)
        stored = getattr(settings, "export_fp", "") if settings is not None else ""
        if not stored or stored != mesh_fingerprint(obj):
            return True
    return False


def filter_stale_jobs(jobs: list[dict], out_dir: Path) -> list[dict]:
    return [job for job in jobs if job_is_stale(job, out_dir)]


def title_from_id(cid: str) -> str:
    parts = [p for p in cid.replace("-", "_").split("_") if p]
    out = []
    for part in parts:
        if part.isdigit():
            out.append(part)
        elif part.lower() == "set":
            out.append("Set")
        else:
            out.append(part.capitalize())
    return " ".join(out) or cid


def _female_mesh_name(meshes: list[str]) -> str:
    for name in meshes:
        if not name.lower().endswith("_male"):
            return name
    if not meshes:
        return ""
    name = meshes[0]
    if name.lower().endswith("_male"):
        return name[:-5]
    return name


def _block_end(text: str, key_start: int) -> int:
    brace = text.find("{", key_start)
    if brace < 0:
        return key_start
    depth = 0
    i = brace
    while i < len(text):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                j = i + 1
                if j < len(text) and text[j] == ",":
                    j += 1
                if j < len(text) and text[j] == "\n":
                    j += 1
                return j
        i += 1
    return len(text)


def _py_dict_end(text: str, id_pos: int) -> int:
    brace = text.rfind("{", 0, id_pos)
    if brace < 0:
        return id_pos
    return _block_end(text, brace)


def _catalog_entry(
    cid: str,
    slot: str,
    name: str,
    mesh: str,
    file_name: str,
    file_male: str | None,
    rig: str,
    bones: list[str],
) -> str:
    lines = [
        f"  {cid}: {{",
        f'    id: "{cid}",',
        f'    slot: "{slot}",',
        f'    name: "{name}",',
        f'    meshName: "{mesh}",',
        f'    file: "{file_name}",',
    ]
    if file_male:
        lines.append(f'    fileMale: "{file_male}",')
    if rig == "skinned":
        lines.append('    rig: "skinned",')
        listed = ", ".join(f'"{b}"' for b in bones) if bones else '"Spine", "Spine1", "Spine2"'
        lines.append(f"    bones: [{listed}],")
    elif len(bones) == 1:
        lines.append(f'    bone: "{bones[0]}",')
    elif bones:
        listed = ", ".join(f'"{b}"' for b in bones)
        lines.append(f"    bones: [{listed}],")
    lines.append("  },")
    return "\n".join(lines) + "\n"


def _manifest_entry(cid: str, slot: str, name: str, file_name: str, meshes: list[str], bones: list[str], rig: str) -> str:
    mesh_list = ", ".join(f'"{m}"' for m in meshes)
    bone_list = ", ".join(f'"{b}"' for b in bones)
    return (
        "    {\n"
        f'        "id": "{cid}",\n'
        f'        "slot": "{slot}",\n'
        f'        "name": "{name}",\n'
        f'        "file": "{file_name}",\n'
        f'        "meshes": [{mesh_list}],\n'
        f'        "bones": [{bone_list}],\n'
        f'        "rig": "{rig}",\n'
        "    },\n"
    )


def sync_repo_catalog(jobs: list[dict]) -> list[str]:
    """Insert missing cosmetics.ts / skin_manifest.py rows for exported ids."""
    notes: list[str] = []
    if not jobs:
        return notes

    by_id: dict[str, dict] = {}
    for job in jobs:
        cid = job["id"]
        row = by_id.setdefault(
            cid,
            {
                "slot": job.get("slot") or "chest",
                "name": title_from_id(cid),
                "file": f"{cid}.glb",
                "fileMale": None,
                "meshes": [],
                "bones": list(job.get("bones") or []),
                "rig": job.get("rig") or "rigid",
            },
        )
        body = job.get("body") or "any"
        if body == "male":
            row["fileMale"] = job.get("file") or f"{cid}_male.glb"
            if not row["meshes"]:
                female = _female_mesh_name(list(job.get("meshes") or []))
                if female:
                    row["meshes"] = [female]
        else:
            row["file"] = job.get("file") or f"{cid}.glb"
            row["slot"] = job.get("slot") or row["slot"]
            row["rig"] = job.get("rig") or row["rig"]
            if job.get("bones"):
                row["bones"] = list(job["bones"])
            female = _female_mesh_name(list(job.get("meshes") or []))
            if female:
                row["meshes"] = [female]

    catalog_path = TOOLS.parent / "packages" / "shared" / "src" / "cosmetics.ts"
    manifest_path = TOOLS / "skin_manifest.py"
    catalog = catalog_path.read_text(encoding="utf-8") if catalog_path.is_file() else ""
    manifest = manifest_path.read_text(encoding="utf-8") if manifest_path.is_file() else ""
    catalog_changed = False
    manifest_changed = False

    for cid, row in by_id.items():
        mesh = row["meshes"][0] if row["meshes"] else title_from_id(cid)
        bones = row["bones"]
        entry = _catalog_entry(
            cid,
            row["slot"],
            row["name"],
            mesh,
            row["file"],
            row["fileMale"],
            row["rig"],
            bones,
        )
        found = re.search(rf"^\s+{re.escape(cid)}:", catalog, re.M)
        if found:
            block = catalog[found.start() : _block_end(catalog, found.start())]
            if row["fileMale"] and f'fileMale: "{row["fileMale"]}"' not in block:
                catalog = catalog[: found.start()] + re.sub(
                    r'(file: "[^"]+",\n)',
                    rf'\1    fileMale: "{row["fileMale"]}",\n',
                    block,
                    count=1,
                ) + catalog[_block_end(catalog, found.start()) :]
                catalog_changed = True
                notes.append(f"catalog fileMale on {cid}")
        else:
            prefix = re.sub(r"_\d+$", "", cid)
            siblings = list(re.finditer(rf"^\s+{re.escape(prefix)}_\d+:", catalog, re.M))
            if siblings:
                insert_at = _block_end(catalog, siblings[-1].start())
                catalog = catalog[:insert_at] + entry + catalog[insert_at:]
                catalog_changed = True
                notes.append(f"catalog +{cid}")
            else:
                marker = "\n};\n\n/** Relative public paths"
                if marker in catalog:
                    catalog = catalog.replace(marker, "\n" + entry + marker, 1)
                    catalog_changed = True
                    notes.append(f"catalog +{cid}")
                else:
                    notes.append(f"could not insert {cid} into cosmetics.ts")

        if f'"id": "{cid}"' not in manifest:
            man_entry = _manifest_entry(
                cid,
                row["slot"],
                row["name"],
                row["file"],
                row["meshes"] or [mesh],
                bones or ["Spine", "Spine1", "Spine2"],
                row["rig"],
            )
            prefix = re.sub(r"_\d+$", "", cid)
            siblings = list(re.finditer(rf'"id": "{re.escape(prefix)}_\d+"', manifest))
            insert_at = -1
            if siblings:
                insert_at = _py_dict_end(manifest, siblings[-1].start())
            else:
                idx = manifest.find("SKINS: list[dict] = [")
                close = manifest.find("\n]", idx) if idx >= 0 else -1
                if close >= 0:
                    insert_at = close
            if insert_at < 0:
                notes.append(f"could not insert {cid} into skin_manifest.py")
            else:
                manifest = manifest[:insert_at] + man_entry + manifest[insert_at:]
                manifest_changed = True
                notes.append(f"manifest +{cid}")

    if catalog_changed and catalog_path.is_file():
        catalog_path.write_text(catalog, encoding="utf-8")
    if manifest_changed and manifest_path.is_file():
        manifest_path.write_text(manifest, encoding="utf-8")
    return notes


def run_jobs(jobs: list[dict], out_dir: Path) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    failed: list[str] = []
    succeeded: list[dict] = []
    for spec in jobs:
        try:
            wrote = export_job(spec, out_dir)
            if not wrote:
                continue
            dest = out_dir / spec["file"]
            size_kb = dest.stat().st_size / 1024
            print(f"[skins] wrote {dest.name} ({size_kb:.1f} KB)")
            stamp_job_fingerprint(spec)
            succeeded.append(spec)
            skin.print_catalog_snippet(
                spec["id"],
                spec["slot"],
                spec["name"],
                spec["file"],
                spec["bones"],
                rig=spec.get("rig", "rigid"),
                body=spec.get("body") or "any",
            )
        except Exception as exc:
            failed.append(f"{spec['id']}: {exc}")
            print(f"[skins] FAIL {spec['id']}: {exc}")
    for line in sync_repo_catalog(succeeded):
        print(f"[skins] {line}")
    if succeeded:
        import bpy

        if bpy.app.background:
            print("[skins] save the .blend so Export new & changed can skip unchanged gear")
        else:
            bpy.ops.wm.save_mainfile()
            print("[skins] saved workbench (export fingerprints)")
    return failed


def ensure_skin_rna() -> None:
    import bpy

    if hasattr(bpy.types.Object, "bb_skin"):
        return
    try:
        import blender_skin_panel as panel

        panel.register()
    except Exception as exc:
        print(f"[skins] skin panel RNA not registered ({exc})")


def export_split_forearms(mesh_name: str, bones: list[str], out: Path) -> None:
    import blender_migrate_cosmetics as mig
    import bpy

    src = skin.find_mesh(mesh_name)
    snap = skin.snapshot_evaluated(src, "Bracers_split")
    parts = mig.separate_loose(snap)
    if len(parts) < 2:
        leftover = parts[0] if parts else snap
        parts = mig.split_by_world_x(leftover)
    else:
        for extra in parts[2:]:
            bpy.data.objects.remove(extra, do_unlink=True)
        parts = parts[:2]

    arm = skin.find_armature()
    assigned = []
    pair = tuple(bones[:2]) if len(bones) >= 2 else ("LeftForeArm", "RightForeArm")
    for part in parts:
        assigned.append((part, mig.nearest_bone(arm, mig.centroid_world(part), pair)))
    if len({b for _, b in assigned}) < 2:
        assigned.sort(key=lambda item: mig.centroid_world(item[0]).x, reverse=True)
        assigned = [(assigned[0][0], pair[0]), (assigned[1][0], pair[1])]

    skin.export_set(assigned, out)
    for part, _bone in assigned:
        try:
            bpy.data.objects.remove(part, do_unlink=True)
        except ReferenceError:
            pass


def export_job(spec: dict, out_dir: Path) -> bool:
    import bpy

    item_id = spec["id"]
    rig = spec.get("rig", "rigid")
    meshes = list(spec["meshes"])
    bones = list(spec["bones"])
    out = out_dir / spec["file"]
    prep = spec.get("prep")

    print(f"\n[skins] {item_id}  rig={rig}  body={spec.get('body') or 'any'}  keep_weights={spec.get('keep_weights', False)}  meshes={meshes}")

    body = spec.get("body") or "any"
    arm = skin.find_armature("male" if body == "male" else None)

    if prep == "split_lr_forearms":
        if rig != "rigid":
            raise RuntimeError(f"{item_id}: split_lr_forearms is rigid-only")
        export_split_forearms(meshes[0], bones, out)
        return True

    missing = [name for name in meshes if bpy.data.objects.get(name) is None]
    if missing:
        if spec.get("optional"):
            print(f"[skins] skip {item_id}: missing {', '.join(missing)}")
            return False
        raise RuntimeError(f"{item_id}: mesh not in workbench: {', '.join(missing)}")

    if rig == "skinned":
        skin.export_skinned_glb(
            [skin.find_mesh(name) for name in meshes],
            out,
            arm=arm,
            keep_weights=bool(spec.get("keep_weights")),
            body=body,
        )
        return True

    if len(meshes) != len(bones):
        raise RuntimeError(
            f"{item_id}: rigid needs one bone per mesh "
            f"({len(meshes)} meshes, {len(bones)} bones)"
        )
    items = [(skin.find_mesh(m), b) for m, b in zip(meshes, bones)]
    if len(items) == 1:
        snap = skin.snapshot_evaluated(items[0][0])
        skin.export_rigid_glb(snap, items[0][1], out, arm=arm)
        return True
    skin.export_set(items, out, arm=arm)
    return True


def main() -> None:
    import bpy

    args = parse_args(sys.argv)
    ensure_skin_rna()
    blend = args.blend.resolve()
    if not blend.is_file():
        raise SystemExit(f"Workbench missing: {blend}")
    bpy.ops.wm.open_mainfile(filepath=str(blend))

    jobs = collect_jobs(args.only)
    if args.list:
        for row in jobs:
            print(
                f"{row['id']:20} {(row.get('body') or 'any'):7} {row['rig']:8} {', '.join(row['meshes'])}"
            )
        return

    out_dir = args.out_dir or skin.repo_cosmetics_dir()
    if args.stale:
        jobs = filter_stale_jobs(jobs, out_dir)
        if not jobs:
            print("[skins] nothing new or changed.")
            return
        print(f"[skins] {len(jobs)} new/changed job(s)")
    failed = run_jobs(jobs, out_dir)
    if failed:
        print("\n[skins] failed:")
        for line in failed:
            print(f"  {line}")
        raise SystemExit(1)
    print("\n[skins] done.")


if __name__ == "__main__":
    main()
