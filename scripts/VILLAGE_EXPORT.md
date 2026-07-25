# Village map export

Exports `village.blend` into the game as one visual GLB + wall polylines + interact markers.

## Prerequisites

- Blender 5.x on PATH, or use the full path below
- Source blend (default): `C:\Users\deric\Downloads\fantasykingdom\maps\village.blend`

## Blender authoring

| Piece | Where / how |
|-------|-------------|
| Visuals | Mesh objects in the scene (empties skipped; **wall curves** skipped — meshes linked into `CollisionWalls` are still exported) |
| Walls | Bezier/poly **curves** in collection **`CollisionWalls`** only |
| Interacts | Empties (**Cube** display) with custom property **`Interact`** and/or **`Label`**. Scale the empty box to set the ground interact pad. |

Recognized interact / label values (case-insensitive):

`Build`, `Shop`, `Talents`, `Customization`, `Portal_PVE`, `Portal_PVP`, `Spawn`, `Dummy`

## Export command (PowerShell, from repo root)

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" `
  "C:\Users\deric\Downloads\fantasykingdom\maps\village.blend" `
  --background `
  --python ".\scripts\blender_export_village_scene.py" `
  -- `
  --out-dir ".\apps\web\public\assets\maps" `
  --data-dir ".\packages\shared\src\maps"
```

Script: [`scripts/blender_export_village_scene.py`](./blender_export_village_scene.py)

## Outputs

| File | Contents |
|------|----------|
| `apps/web/public/assets/maps/village.glb` | Visual scene meshes |
| `packages/shared/src/maps/main_village.walls.json` | Sampled XZ wall segments from `CollisionWalls` |
| `packages/shared/src/maps/main_village.markers.json` | Spawn / stands / portals / dummies + empty-box `halfX`/`halfZ`/`rotationY` |

## After export

1. Hard-refresh the browser (GLB is often cached).
2. Hub loads `HUB_SCENE_URL` (`/assets/maps/village.glb`) and applies `HUB_SCENE_SCALE` (see `packages/shared/src/hubVillage.ts`).
3. Wall debug overlay: **F9**.

## Notes

- glTF does **not** export Bezier curves; walls must go through this script’s JSON path.
- Do not put collision curves in the visual GLB; keep them in `CollisionWalls` only.
- If the blend path changes, update the first argument in the command above.
