"""
Export a Blender map scene to BattleBeasts map.json.

Usage (Blender 5, background):
  blender.exe path/to/village.blend --background --python scripts/blender_export_map.py -- ^
    --out packages/shared/src/maps/main_village.map.json

Or from Blender Scripting: open this file and Run Script
  (writes next to the .blend as map.json by default).

Exports mesh + empty objects with world transforms in Three.js Y-up space
and custom properties (Collision, Interact, Label, …).
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

import bpy
from mathutils import Matrix, Quaternion, Vector


# Blender Z-up → Three.js Y-up
# Three = (Bx, Bz, -By)
BLENDER_TO_THREE = Matrix(
    (
        (1.0, 0.0, 0.0, 0.0),
        (0.0, 0.0, 1.0, 0.0),
        (0.0, -1.0, 0.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    )
)

# Cached once per export — evaluated bounds need the depsgraph.
_DEPSGRAPH = None


def depsgraph():
    global _DEPSGRAPH
    if _DEPSGRAPH is None:
        _DEPSGRAPH = bpy.context.evaluated_depsgraph_get()
    return _DEPSGRAPH


def world_size_three(obj) -> dict | None:
    """Evaluated world AABB size remapped to Three.js Y-up meters.

    Prefer this over matrix scale when placing normalized GLBs: Blender
    collection/mesh sources are often huge with tiny object scales (or the
    reverse for RTS kits), so decompose(scale) does not match the shipped asset.
    """
    corners_b: list[Vector] = []
    mw = obj.matrix_world
    dg = depsgraph()

    try:
        ev = obj.evaluated_get(dg)
        bb = list(ev.bound_box)
        # Collection-instance empties often report a degenerate local AABB;
        # pull corners from depsgraph instances parented to this object.
        span = 0.0
        if bb:
            xs = [c[0] for c in bb]
            ys = [c[1] for c in bb]
            zs = [c[2] for c in bb]
            span = max(xs) - min(xs) + max(ys) - min(ys) + max(zs) - min(zs)
        if span > 1e-6:
            corners_b = [mw @ Vector(c) for c in bb]
        else:
            for inst in dg.object_instances:
                if not inst.is_instance:
                    continue
                parent = inst.parent
                if parent is None:
                    continue
                # Blender 4/5: parent may be evaluated; compare originals.
                orig = getattr(parent, "original", parent)
                if orig != obj:
                    continue
                child = inst.object
                if child is None:
                    continue
                imw = inst.matrix_world
                try:
                    for c in child.bound_box:
                        corners_b.append(imw @ Vector(c))
                except Exception:
                    continue
            # Fallback: walk instance_collection meshes through empty matrix
            if not corners_b and obj.instance_collection:
                for o in obj.instance_collection.all_objects:
                    if o.type != "MESH":
                        continue
                    om = mw @ o.matrix_world
                    try:
                        for c in o.bound_box:
                            corners_b.append(om @ Vector(c))
                    except Exception:
                        continue
    except Exception:
        return None

    if not corners_b:
        return None

    corners_t = [BLENDER_TO_THREE @ c for c in corners_b]
    xs = [v.x for v in corners_t]
    ys = [v.y for v in corners_t]
    zs = [v.z for v in corners_t]
    size = {
        "x": round(max(xs) - min(xs), 5),
        "y": round(max(ys) - min(ys), 5),
        "z": round(max(zs) - min(zs), 5),
    }
    if max(size.values()) < 1e-6:
        return None
    return size


def parse_args(argv: list[str]) -> dict:
    out = None
    collection = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--out" and i + 1 < len(argv):
            out = argv[i + 1]
            i += 2
            continue
        if a == "--collection" and i + 1 < len(argv):
            collection = argv[i + 1]
            i += 2
            continue
        i += 1
    return {"out": out, "collection": collection}


def quat_to_dict(q: Quaternion) -> dict:
    return {
        "x": round(float(q.x), 5),
        "y": round(float(q.y), 5),
        "z": round(float(q.z), 5),
        "w": round(float(q.w), 5),
    }


def vec_to_dict(v) -> dict:
    return {
        "x": round(float(v.x), 5),
        "y": round(float(v.y), 5),
        "z": round(float(v.z), 5),
    }


def read_custom_props(obj) -> dict:
    """Export Blender custom properties (skip RNA internals)."""
    props = {}
    for key in obj.keys():
        if key.startswith("_") or key in {"cycles", "cycles_visibility"}:
            continue
        try:
            val = obj[key]
        except Exception:
            continue
        # IDProperty arrays / nested → JSON-friendly
        if hasattr(val, "to_list"):
            val = list(val)
        elif hasattr(val, "to_dict"):
            val = dict(val)
        # Blender bools sometimes come through as ints
        if key in {"Collision", "collision"} and isinstance(val, (int, float)):
            val = bool(val)
        props[key] = val
    return props


def object_type(obj) -> str:
    if obj.type == "EMPTY":
        return "empty"
    if obj.type == "MESH":
        return "mesh"
    return obj.type.lower()


def should_export(obj, allowed_names: set[str] | None) -> bool:
    if obj.type not in {"MESH", "EMPTY"}:
        return False
    if allowed_names is not None and obj.name not in allowed_names:
        return False
    if obj.hide_get() or obj.hide_viewport:
        props = read_custom_props(obj)
        if not (props.get("Collision") or props.get("collision") or props.get("Interact")):
            return False
    return True


def collection_object_names(coll_name: str | None) -> set[str] | None:
    if not coll_name:
        if "Map" in bpy.data.collections:
            coll_name = "Map"
        else:
            return None
    coll = bpy.data.collections.get(coll_name)
    if not coll:
        print(f"[export_map] collection '{coll_name}' not found — exporting all mesh/empty")
        return None
    names = set()

    def walk(c):
        for o in c.objects:
            names.add(o.name)
        for child in c.children:
            walk(child)

    walk(coll)
    print(f"[export_map] using collection '{coll_name}' ({len(names)} objects)")
    return names


def export_object(obj) -> dict:
    # World matrix remapped to Three Y-up
    mw = BLENDER_TO_THREE @ obj.matrix_world
    loc, rot, scale = mw.decompose()
    props = read_custom_props(obj)
    collide = bool(props.get("Collision", props.get("collision", False)))
    world_size = world_size_three(obj)

    out = {
        "id": obj.name,
        "type": object_type(obj),
        "asset": obj.data.name if obj.data else obj.name,
        "collection": obj.users_collection[0].name if obj.users_collection else "",
        "transform": {
            "position": vec_to_dict(loc),
            "rotation": quat_to_dict(rot),
            "scale": vec_to_dict(scale),
        },
        "collision": {"enabled": collide},
        "properties": props,
    }
    if world_size is not None:
        out["worldSize"] = world_size
    return out


def main():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    opts = parse_args(argv)
    blend_path = bpy.data.filepath or ""
    default_out = (
        os.path.join(os.path.dirname(blend_path), "map.json")
        if blend_path
        else os.path.join(os.getcwd(), "map.json")
    )
    out_path = os.path.abspath(opts["out"] or default_out)

    global _DEPSGRAPH
    _DEPSGRAPH = None

    allowed = collection_object_names(opts["collection"])
    objects = []
    for obj in bpy.context.scene.objects:
        if not should_export(obj, allowed):
            continue
        objects.append(export_object(obj))

    objects.sort(key=lambda o: o["id"])

    doc = {
        "version": 1,
        "coordinateSystem": "threejs-y-up",
        "source": os.path.basename(blend_path) or "untitled.blend",
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "objects": objects,
    }

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")

    interacts = [o["id"] for o in objects if (o.get("properties") or {}).get("Interact")]
    colliding = [o["id"] for o in objects if (o.get("properties") or {}).get("Collision")]
    print(f"[export_map] wrote {out_path}")
    print(
        f"[export_map] objects={len(objects)} collision={len(colliding)} interact={len(interacts)}"
    )
    if interacts:
        print("[export_map] Interact:", ", ".join(interacts))


if __name__ == "__main__":
    main()
