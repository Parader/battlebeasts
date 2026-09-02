# Desert arena map export

Exports `desert.blend` into the game as one visual GLB + wall polylines + numbered spawns.

## Prerequisites

- Blender 5.x on PATH
- Source blend (default): `C:\Users\deric\Downloads\fantasykingdom\maps\desert.blend`

## Blender authoring

| Piece | Where / how |
|-------|-------------|
| Visuals | Mesh objects in the scene |
| Walls | Curves in collection **`CollisionWalls`**. Runtime keeps the outer fence as a **convex hull** (dents become invisible teleport/magma blockers) and replaces interior rock loops with tight rings from the GLB. Prefer one outline per obstacle — never wrap a whole rock cluster in one fat Bezier. |
| Spawns | Empties with **Label** `Spawn 1` … `Spawn 6` (1–3 team A, 4–6 team B). Markers only — never put spawn empties in `CollisionWalls`. |

## Export command (PowerShell, from repo root)

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" `
  "C:\Users\deric\Downloads\fantasykingdom\maps\desert.blend" `
  --background `
  --python ".\scripts\blender_export_village_scene.py" `
  -- `
  --out-dir ".\apps\web\public\assets\maps" `
  --data-dir ".\packages\shared\src\maps" `
  --name desert
```

## Outputs

| File | Contents |
|------|----------|
| `apps/web/public/assets/maps/desert.glb` | Visual scene |
| `packages/shared/src/maps/desert.walls.json` | CollisionWalls segments |
| `packages/shared/src/maps/desert.markers.json` | Spawn 1–6 |

Runtime: [`packages/shared/src/arenaDesert.ts`](../packages/shared/src/arenaDesert.ts) (`ARENA_SCENE_URL`, `ARENA_SCENE_SCALE = 0.2`).
