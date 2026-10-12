# Map builder

Dev-only editor in `apps/editor`. It is not shipped. Use it, or the map JSON it saves, to create maps.

Start it from the repo root:

```
pnpm dev:editor
```

Vite serves it at `http://localhost:5183` (the next free port if that one is taken). Saving goes through `PUT /api/maps/:id` on that same server. The server writes `packages/shared/src/maps/<id>.map.json`, any painted-ground PNGs under `apps/web/public/assets/maps/`, and regenerates `packages/shared/src/maps/authored.generated.ts`.

A new map stays out of matchmaking until `active` is set. Leave `active` false unless the map is meant to be queued.

## Create a map as JSON

This is the reliable way to author layout. Write `packages/shared/src/maps/<id>.map.json`, then run `pnpm gen:maps`.

The id is the filename without `.map.json`. It must match `^[a-z0-9][a-z0-9_-]{0,63}$`. Derive it from the display name: lowercase, strip accents, turn other runs of characters into `_`, trim underscores. `Village Square` becomes `village_square`.

Ground is centred on the origin. A prop at `x: 0, z: 0` is the middle. Half the ground extent is the edge: an 80×80 map runs from -40 to 40 on both axes. Keep every prop, wall point, water point, and element inside that rectangle.

```json
{
  "version": 1,
  "id": "meadow_camp",
  "name": "Meadow Camp",
  "ground": {
    "kind": "painted",
    "sizeX": 80,
    "sizeZ": 80,
    "resX": 256,
    "resZ": 256,
    "base": "grass",
    "layers": ["grass"],
    "paint": "index",
    "heightScale": 0
  },
  "env": { "skyPreset": "enchanted-meadow/TEM_Skybox_01A" },
  "props": [],
  "walls": [],
  "waters": [],
  "scatters": [],
  "elements": [],
  "active": false
}
```

`resX` / `resZ` are texels per tile, about `3.2` per metre, capped at `512`. For a single-buffer map under about 160 m on a side, one resolution covers the whole ground. Past that the editor switches to tiles of 128 m (`tilesX`, `tilesZ`). You do not need to set those for a new unpainted map; the editor fills them in when the size requires it. The hard cap is 1024 m on a side.

Do not hand-write splat or height PNGs. Omit `splatUrl` and `heightUrl`. Unpainted ground is the `base` material and is not stored. `layers` must start with that same id.

### Ground material ids

Ids are stable strings in `packages/shared/src/maps/groundMaterials.ts` and `groundMaterials.sics.ts`. Use an existing id. Common ones: `grass`, `grass_sparse`, `grass_path`, `dirt`, `dry_earth`, `sand`, `sand_beach`, `rock`, `forest_floor`, `forest_floor_dense`. SICS kits add ids such as `sics_meadow_tem_terrain_grass_01`. Read the catalog rather than inventing one.

`heightScale` is how many metres a full white height texel rises. `0` is flat and stores no height. The maximum is `0.5`. Collision and aim ignore height, so sculpt is a visual lip only. Leave it at `0` unless the map needs that lip.

`env.skyPreset` is an id from `packages/shared/src/maps/skies.generated.ts`, for example `golden-valley/TGV_Skybox_01A`. Omit `env` fields to keep the default haze. Optional fog: `fogColor` (`#rrggbb`), `fogNear`, `fogFar` in metres.

## Props

Every placeable model is a key in `data/props.manifest.json`. The key matches the file under `apps/web/public/assets/props/` without `.glb`, for example `forest/PP_Fir_Tree_17` or `enchanted-meadow/Trees/TEM_Tree_01`. Search that manifest. Never invent a key.

Copy `defaultCollider` from the manifest entry onto the placement. The runtime scales it by `scale`. `mode` is `circle` (`radius`), `box` (`halfX`, `halfZ`, optional `yaw`), or `none`. Use `none` for ground dressing that should not block. `blocksProjectiles: false` lets shots pass a solid collider.

```json
{
  "id": "p001",
  "prop": "forest/PP_Fir_Tree_17",
  "x": 12,
  "y": 0,
  "z": -6,
  "yaw": 0.4,
  "scale": 1,
  "collider": { "mode": "circle", "radius": 0.4 }
}
```

`y` is visual only. `0` sits on flat ground. `yaw`, and optional `pitch` / `roll`, are radians. Omit pitch and roll when they are 0. `pivotX` / `pivotZ` are the model's origin relative to its centre; copy them from the manifest bounds (`centreX` / `centreZ`) when the kit was not built around its pivot, otherwise rotation swings the mesh off its collider. Kits imported from SICS already store this when the editor places them. If you are writing JSON by hand and the collider looks shifted after a rotation, set pivot from those centre fields.

Optional `hp` makes the prop a practice target that refills at 0. Omit it for scenery.

Ids (`p001`, `w001`, `e001`, …) must be unique across props, walls, waters, scatters, and elements.

## Boundaries, water, scatter

A wall is a collision polyline. `closed: true` loops the last point back to the first. Points are `[x, z]`.

```json
{ "id": "w001", "closed": true, "points": [[-8, -8], [8, -8], [8, 8], [-8, 8]] }
```

Water does not block movement. An open polyline is a river of `width` metres (default 4). A closed loop is a pond that fills the polygon.

```json
{ "id": "water001", "closed": false, "width": 4, "points": [[-20, 2], [0, 0], [20, 3]] }
```

Scatter is a density brush (grass, leaves, pebbles). Prefer painting it in the editor. A patch stores discs, not every blade: `dabs` are `[x, z, radius]`, `props` are manifest keys plus `baseY`, `density` is clumps per square metre (max 4), and `seed` must be a fixed integer so the patch does not reshuffle. Cap is 2500 instances.

## Gameplay markers

`elements` is the list of anything interactive. The catalog is `ELEMENT_TYPES` in `packages/shared/src/maps/elements.ts`. Each element is `{ id, type, x, z, yaw, params, shape? }`. `yaw` is radians. `y` is optional and only affects where a marker is drawn.

Types you will actually place:

| type | params | shape |
| --- | --- | --- |
| `player_spawn` | `team`: `a`, `b`, or `c` | none. Face the fighter with `yaw`. |
| `entity_spawn` | `entity` (default `zombie`), `behaviour` `fixed` \| `roam` \| `guard`, `aggroRadius`, `roamRadius` | none |
| `npc` | `name`, `model` (an id from `NPC_MODEL_IDS`), `line`, `action` | none |
| `stand_shop`, `stand_build`, `stand_talent`, `stand_customization` | `label` | box, half extents 2.15 |
| `portal_pvp` | `label`, `mode` | circle radius 2.5 |
| `portal_pve` | `label`, `dungeon` | circle radius 2.5 |
| `objective` | `tag` `capture_point` \| `flag_stand` \| `payload_node` \| `custom`, `team` `none` \| `a` \| `b` \| `c` | none |
| `pickup` | `effect` `heal` \| `energy` \| `absorb` \| `speed` \| `power` \| `haste` \| `random`, `magnitude`, `durationMs`, `respawnMs`, `firstSpawnMs` | circle radius 1.2 |
| `light` | `kind` `lamp` \| `torch` \| `fire` \| `candle`, `height` | none. A lamp post is a prop; the light is a separate element. |

Buff pickups (`speed`, `power`, `haste`) need `durationMs` greater than 0. A PvP map wants a `player_spawn` per team that will fight. A dungeon map wants `dungeon_start`, `dungeon_boss`, and `dungeon_exit`. Read those entries in `elements.ts` before authoring one; their params are longer.

A box shape is `{ "kind": "box", "halfX": 2.15, "halfZ": 2.15 }`. A circle is `{ "kind": "circle", "radius": 2.5 }`.

`group` on a prop, wall, water, or element is an editor selection group. The game ignores it.

## What the editor is for

Open a JSON map in the editor when you need brushes. The toolbar:

- **Select** — move, rotate, scale. `W` `E` `R` switch the gizmo. `Ctrl+D` duplicates. `Ctrl+G` groups, `Ctrl+Alt+G` ungroups. `Delete` removes.
- **Place** — click the ground to plant the prop armed from the palette.
- **Boundary** (`B`) — click points, finish the polyline. Closed loops are pens.
- **Water** — same gesture. Close the loop for a pond.
- **Element** — pick a type, then click the ground.
- **Terrain** (`T`) — left-drag paints or sculpts. Middle mouse orbits, right mouse pans. `Ctrl+Z` undoes a stroke only while this tool is active.
- **Scatter** — paint clumps by density.

The Ground panel sets **Base material**. That recolors ground that still shows the old base and leaves fully painted texels alone. Resize with width, depth, and a 3×3 anchor, then confirm. New ground stays the base material until something is painted. Resizing clears terrain undo and shifts props with the anchor.

Brush modes are paint, raise, lower, smooth, and flatten. Raise and lower do nothing visible while Height in the Ground panel is 0. Paint blends two materials per texel, so a dirt path can feather into the base instead of ending in a hard edge.

Save in the editor. A prop-only save keeps existing terrain images. Uniform tiles that match the base are dropped on the next save, which is what you want.

## Checks before you finish

`validateMapDoc` reports these. Warnings still save. Errors are duplicate ids and a pickup buff with no duration.

- Every id is unique.
- Element `type` is in the catalog.
- Spawns and markers sit inside the ground, and not inside a collider. Leave a walkable gap: player diameter plus a little skin (`MIN_PASSABLE_GAP` in `mapDoc.ts`).
- A PvP map has the teams it claims. A dungeon map has a start, a boss, and an exit.
- `active` is false until someone asks for the map to go live.
- `modeIds` is optional. Set it only when the map should be preferred for a mode (`skirmish`, a wave mode, the hub). Unknown mode ids do nothing useful.

After adding or renaming a file yourself, run `pnpm gen:maps`. Saving through the editor already does that.
