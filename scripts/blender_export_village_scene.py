"""
Export village.blend → one visual GLB + walls.json + markers.json.

Usage:
  blender.exe path/to/village.blend --background --python scripts/blender_export_village_scene.py -- ^
    --out-dir apps/web/public/assets/maps ^
    --data-dir packages/shared/src/maps

Writes:
  <out-dir>/village.glb          — mesh visuals (excludes CollisionWalls + empties)
  <data-dir>/main_village.walls.json
  <data-dir>/main_village.markers.json
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from datetime import datetime, timezone

import bpy
from mathutils import Matrix, Vector

# Blender Z-up → Three.js Y-up: Three = (Bx, Bz, -By)
BLENDER_TO_THREE = Matrix(
    (
        (1.0, 0.0, 0.0, 0.0),
        (0.0, 0.0, 1.0, 0.0),
        (0.0, -1.0, 0.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    )
)

WALL_COLLECTION = "CollisionWalls"

INTERACT_ALIASES = {
    "build": "build",
    "armoury": "build",
    "armory": "build",
    "talent": "talent",
    "talents": "talent",
    "chapel": "talent",
    "customization": "customization",
    "house": "customization",
    "shop": "shop",
    "portal_pve": "portal_pve",
    "pve": "portal_pve",
    "portal_pvp": "portal_pvp",
    "pvp": "portal_pvp",
    "spawn": "spawn",
    "dummy": "dummy",
    "practice_dummy": "dummy",
}

# Arena / numbered team spawns (desert Spawn 1–6).
SPAWN_INDEX_RE = re.compile(r"^spawn[_\s\-]*([1-6])$", re.IGNORECASE)


def parse_args(argv: list[str]) -> dict:
    out_dir = None
    data_dir = None
    # Asset basename: village → village.glb + main_village.*.json; desert → desert.*
    name = "village"
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--out-dir" and i + 1 < len(argv):
            out_dir = argv[i + 1]
            i += 2
            continue
        if a == "--data-dir" and i + 1 < len(argv):
            data_dir = argv[i + 1]
            i += 2
            continue
        if a == "--name" and i + 1 < len(argv):
            name = argv[i + 1].strip().lower()
            i += 2
            continue
        i += 1
    return {"out_dir": out_dir, "data_dir": data_dir, "name": name}


def to_three(v: Vector) -> Vector:
    return BLENDER_TO_THREE @ v


def normalize_interact(raw) -> str | None:
    if not raw or not isinstance(raw, str):
        return None
    key = raw.strip().lower().replace(" ", "_")
    spawn_m = SPAWN_INDEX_RE.match(key) or SPAWN_INDEX_RE.match(raw.strip())
    if spawn_m:
        return f"spawn_{spawn_m.group(1)}"
    return INTERACT_ALIASES.get(key)


def yaw_from_matrix_three(mw_three: Matrix) -> float:
    """Y-up yaw from remapped world matrix (atan2 of forward on XZ)."""
    _loc, rot, _scale = mw_three.decompose()
    x, y, z, w = rot.x, rot.y, rot.z, rot.w
    return math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z))


def empty_ground_obb(obj) -> tuple[float, float, float, float, float]:
    """
    Ground OBB for an Empty (Cube/Plain Axes/etc.).
    Blender cube empties span ±empty_display_size on each local axis before object scale.
    Returns (x, z, halfX, halfZ, rotationY) in Three.js Y-up space (unscaled).
    """
    size = float(getattr(obj, "empty_display_size", 1.0) or 1.0)
    mw = BLENDER_TO_THREE @ obj.matrix_world
    loc, _rot, _scl = mw.decompose()
    yaw = yaw_from_matrix_three(mw)

    # 8 local corners → world XZ; fit extents in the empty's yaw frame.
    cos_y = math.cos(-yaw)
    sin_y = math.sin(-yaw)
    max_lx = 0.0
    max_lz = 0.0
    for ix in (-size, size):
        for iy in (-size, size):
            for iz in (-size, size):
                p = mw @ Vector((ix, iy, iz))
                dx = float(p.x) - float(loc.x)
                dz = float(p.z) - float(loc.z)
                lx = dx * cos_y - dz * sin_y
                lz = dx * sin_y + dz * cos_y
                max_lx = max(max_lx, abs(lx))
                max_lz = max(max_lz, abs(lz))

    # Degenerate / axes empties: fall back to scale*size on horizontal axes.
    if max_lx < 1e-4 and max_lz < 1e-4:
        _l, _r, scl = mw.decompose()
        max_lx = max(abs(float(scl.x)) * size, 0.5)
        max_lz = max(abs(float(scl.z)) * size, 0.5)

    return (
        float(loc.x),
        float(loc.z),
        max_lx,
        max_lz,
        yaw,
    )


def sample_bezier_spline(spline, mw: Matrix, resolution: int) -> list[Vector]:
    """Sample a Bezier spline in Blender world space (including handles)."""
    points = spline.bezier_points
    n = len(points)
    if n == 0:
        return []
    cyclic = spline.use_cyclic_u
    segs = n if cyclic else n - 1
    if segs <= 0:
        p = to_three(mw @ points[0].co)
        return [p]

    out: list[Vector] = []
    steps = max(1, int(resolution))
    for i in range(segs):
        p0 = points[i]
        p1 = points[(i + 1) % n]
        # Cubic Bezier: P0, handle_right, handle_left of next, P1
        a = mw @ p0.co
        b = mw @ p0.handle_right
        c = mw @ p1.handle_left
        d = mw @ p1.co
        # Include start of each segment; skip duplicate at join except last close
        start = 0 if i == 0 else 1
        for s in range(start, steps + 1):
            t = s / steps
            u = 1.0 - t
            pt = (
                (u * u * u) * a
                + 3 * (u * u * t) * b
                + 3 * (u * t * t) * c
                + (t * t * t) * d
            )
            out.append(to_three(pt))
    if cyclic and out:
        # Close loop
        out.append(out[0].copy())
    return out


def sample_poly_spline(spline, mw: Matrix) -> list[Vector]:
    pts = []
    for p in spline.points:
        # poly points are 4D
        co = Vector((p.co[0], p.co[1], p.co[2]))
        pts.append(to_three(mw @ co))
    if spline.use_cyclic_u and pts:
        pts.append(pts[0].copy())
    return pts


def export_walls() -> dict:
    coll = bpy.data.collections.get(WALL_COLLECTION)
    walls = []
    if not coll:
        print(f"[export_village] WARNING: collection '{WALL_COLLECTION}' not found")
        return {"version": 1, "walls": []}

    for obj in coll.all_objects:
        if obj.type != "CURVE" or obj.data is None:
            continue
        mw = obj.matrix_world
        res = max(4, int(obj.data.resolution_u))
        all_pts: list[Vector] = []
        for spline in obj.data.splines:
            if spline.type == "BEZIER":
                all_pts.extend(sample_bezier_spline(spline, mw, res))
            elif spline.type in {"POLY", "NURBS"}:
                all_pts.extend(sample_poly_spline(spline, mw))

        segs: list[float] = []
        for i in range(len(all_pts) - 1):
            a, b = all_pts[i], all_pts[i + 1]
            # Skip zero-length
            if (a - b).length < 1e-5:
                continue
            segs.extend(
                [
                    round(float(a.x), 4),
                    round(float(a.z), 4),
                    round(float(b.x), 4),
                    round(float(b.z), 4),
                ]
            )
        if not segs:
            continue
        walls.append(
            {
                "id": obj.name.replace(".", "_"),
                "segs": segs,
            }
        )
        print(f"[export_village] wall '{obj.name}' segments={len(segs)//4}")

    return {
        "version": 1,
        "coordinateSystem": "threejs-y-up",
        "source": os.path.basename(bpy.data.filepath) or "untitled.blend",
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "walls": walls,
    }


def export_markers() -> dict:
    markers = []
    for obj in bpy.context.scene.objects:
        if obj.type != "EMPTY":
            continue
        props = {}
        for key in obj.keys():
            if key.startswith("_"):
                continue
            try:
                props[key] = obj[key]
            except Exception:
                continue
        kind = normalize_interact(props.get("Interact")) or normalize_interact(
            props.get("Label")
        )
        if not kind:
            continue
        x, z, half_x, half_z, yaw = empty_ground_obb(obj)
        markers.append(
            {
                "id": obj.name.replace(".", "_"),
                "kind": kind,
                "x": round(x, 4),
                "z": round(z, 4),
                "halfX": round(half_x, 4),
                "halfZ": round(half_z, 4),
                "rotationY": round(yaw, 5),
                "label": props.get("Label") or props.get("label") or None,
                "emptyDisplay": getattr(obj, "empty_display_type", None),
            }
        )
    markers.sort(key=lambda m: m["id"])
    return {
        "version": 2,
        "coordinateSystem": "threejs-y-up",
        "source": os.path.basename(bpy.data.filepath) or "untitled.blend",
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "markers": markers,
    }


def objects_in_collection(name: str) -> set[bpy.types.Object]:
    coll = bpy.data.collections.get(name)
    if not coll:
        return set()
    return set(coll.all_objects)


def export_glb(out_path: str) -> None:
    """Export scene meshes for visuals; skip wall curves + empties (not meshes)."""
    wall_objs = objects_in_collection(WALL_COLLECTION)
    view = bpy.context.view_layer

    # Headless-safe selection (avoid bpy.ops.object.select_all poll failures)
    for obj in view.objects:
        obj.select_set(False)
    selected: list = []
    meshes_also_in_walls = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        # CollisionWalls may also contain props linked by mistake — still export
        # those meshes. Only curves in that collection are collision (JSON path).
        if obj in wall_objs:
            meshes_also_in_walls += 1
        if obj.hide_get() or obj.hide_viewport or obj.hide_render:
            continue
        try:
            obj.hide_set(False)
        except Exception:
            pass
        obj.select_set(True)
        selected.append(obj)

    if meshes_also_in_walls:
        print(
            f"[export_village] note: {meshes_also_in_walls} meshes also live in "
            f"'{WALL_COLLECTION}' — including them in the GLB (walls JSON uses curves only)"
        )

    if not selected:
        raise RuntimeError("No mesh objects selected for village.glb export")

    view.objects.active = selected[0]

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    # Background Blender needs a window override for export ops
    wm = bpy.context.window_manager
    window = wm.windows[0] if wm.windows else None
    override = {"window": window, "screen": window.screen} if window else {}

    def do_export():
        bpy.ops.export_scene.gltf(
            filepath=out_path,
            use_selection=True,
            export_format="GLB",
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

    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"[export_village] wrote {out_path} meshes={len(selected)} size={size_mb:.1f}MB")


def main():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    opts = parse_args(argv)
    blend_dir = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd()
    # Defaults relative to repo when run from battlebeasts2 cwd via absolute paths in CLI
    out_dir = os.path.abspath(opts["out_dir"] or os.path.join(blend_dir, "export"))
    data_dir = os.path.abspath(opts["data_dir"] or out_dir)
    name = opts.get("name") or "village"

    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(data_dir, exist_ok=True)

    if name == "village":
        glb_path = os.path.join(out_dir, "village.glb")
        walls_path = os.path.join(data_dir, "main_village.walls.json")
        markers_path = os.path.join(data_dir, "main_village.markers.json")
    else:
        glb_path = os.path.join(out_dir, f"{name}.glb")
        walls_path = os.path.join(data_dir, f"{name}.walls.json")
        markers_path = os.path.join(data_dir, f"{name}.markers.json")

    walls = export_walls()
    markers = export_markers()

    with open(walls_path, "w", encoding="utf-8") as f:
        json.dump(walls, f, indent=2)
        f.write("\n")
    with open(markers_path, "w", encoding="utf-8") as f:
        json.dump(markers, f, indent=2)
        f.write("\n")

    print(f"[export] walls → {walls_path} ({len(walls.get('walls', []))} curves)")
    print(
        f"[export] markers → {markers_path} ({len(markers.get('markers', []))} markers)"
    )
    for m in markers.get("markers", []):
        print(f"  - {m['kind']} @ ({m['x']}, {m['z']})")

    export_glb(glb_path)
    print(f"[export] done ({name})")


if __name__ == "__main__":
    main()
