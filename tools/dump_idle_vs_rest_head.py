"""REST vs Idle: Mixamo skull vs Head-set-3, Head-local cm."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import blender_export_skin as skin  # noqa: E402

HAT = "Head set 3"
HERO_GLB = Path(r"C:\solo\battlebeasts2\apps\web\public\hero.glb")


def groups(obj):
    names = [skin.bone_suffix(vg.name) for vg in obj.vertex_groups]
    return sorted(set(names))


def skull_nape_face(dummy, head_world):
    import bpy
    from mathutils import Vector

    deps = bpy.context.evaluated_depsgraph_get()
    ev = dummy.evaluated_get(deps)
    mesh = ev.to_mesh()
    inv = head_world.inverted()
    nape, face, n = 1e9, -1e9, 0
    for v in mesh.vertices:
        loc = inv @ (ev.matrix_world @ v.co)
        if loc.y < -6 or loc.y > 32:
            continue
        if loc.x * loc.x + loc.z * loc.z > 20 * 20:
            continue
        n += 1
        nape = min(nape, loc.z)
        face = max(face, loc.z)
    ev.to_mesh_clear()
    return n, nape, face


def hat_nape_face(hat, head_world):
    import bpy

    deps = bpy.context.evaluated_depsgraph_get()
    ev = hat.evaluated_get(deps)
    mesh = ev.to_mesh()
    inv = head_world.inverted()
    zs = [(inv @ (ev.matrix_world @ v.co)).z for v in mesh.vertices]
    ev.to_mesh_clear()
    return min(zs), max(zs)


def measure(label, arm, dummy, hat=None):
    import bpy

    head = skin.find_bone(arm, "Head")
    bpy.context.view_layer.update()
    hw = skin.pose_bone_world(arm, head)
    n, nape, face = skull_nape_face(dummy, hw)
    print(
        f"{label}: dummy inherits={skin.body_world_matches_armature(dummy, arm)} "
        f"skull n={n} nape={nape:.3f} face={face:.3f} cm"
    )
    if hat is not None:
        hn, hf = hat_nape_face(hat, hw)
        print(
            f"{label}: hat nape={hn:.3f} face={hf:.3f} cm  "
            f"cover_nape={hn - nape:.3f} (neg=hat behind Mixamo nape, should cover)"
        )


def apply_action(arm, action_name: str) -> bool:
    import bpy

    action = bpy.data.actions.get(action_name)
    if action is None:
        for a in bpy.data.actions:
            if action_name.lower() in a.name.lower():
                action = a
                break
    if action is None:
        print(f"no action {action_name!r} among {[a.name for a in bpy.data.actions][:12]}")
        return False
    arm.animation_data_create()
    arm.animation_data.action = action
    slots = getattr(action, "slots", None)
    if slots and len(slots) > 0 and hasattr(arm.animation_data, "action_slot"):
        arm.animation_data.action_slot = slots[0]
    bpy.context.scene.frame_set(int(round(action.frame_range[0])))
    bpy.context.view_layer.update()
    print(f"applied {action.name!r} frame {bpy.context.scene.frame_current}")
    return True


def main() -> None:
    import bpy

    arm = skin.find_armature()
    dummy = skin.find_surface()
    hat = bpy.data.objects.get(HAT)
    skin.reveal_bind_dummies()
    prev = arm.data.pose_position

    print("hat vgroups", groups(hat) if hat else None)
    print("dummy vgroups sample", groups(dummy)[:20] if dummy else None)

    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    measure("BIND REST", arm, dummy, hat)

    arm.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    if apply_action(arm, "idle_game") or apply_action(arm, "idle"):
        measure("BIND IDLE", arm, dummy, hat)

    arm.data.pose_position = prev

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(HERO_GLB))
    new = [o for o in bpy.data.objects if o not in before]
    glb_arm = next(o for o in new if o.type == "ARMATURE")
    glb_dummy = next(o for o in new if o.type == "MESH" and o.name.startswith("Beta_Surface") and ".001" not in o.name)
    extras = [o.name for o in new if o.type == "MESH" and "beta_surface" in o.name.lower()]
    print("hero.glb Beta_Surface meshes", extras)
    glb_arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    measure("GLB REST", glb_arm, glb_dummy)
    glb_arm.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    glb_arm.animation_data_create()
    idle = next((a for a in bpy.data.actions if a.name.split("|")[0].strip() == "idle"), None)
    if idle:
        glb_arm.animation_data.action = idle
        bpy.context.scene.frame_set(int(round(idle.frame_range[0])))
        bpy.context.view_layer.update()
        measure("GLB IDLE", glb_arm, glb_dummy)


if __name__ == "__main__":
    main()
