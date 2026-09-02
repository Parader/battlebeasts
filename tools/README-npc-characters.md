# Adding an NPC character (Meshy → Mixamo → Blender → game)

How to take a mesh generated in Meshy, rig and animate it with Mixamo, and get it
into the game as an NPC with idle + talk animations.

Written for someone who has never opened Blender. Blender steps are for 4.x; menu
names drift slightly between versions, so the *reason* for each step is given
alongside it — if a button moved, you will still know what you are looking for.

---

## Shortcut: let the script do the Blender part

Once you have a **rigged character** (mesh bound to a Mixamo skeleton, saved as
`.glb`, `.fbx` or `.blend`) and the **animation FBXs downloaded from Mixamo in
the same folder**, skip to the end — `tools/blender_build_npc.py` does the merge
and export for you:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" `
  --background --factory-startup `
  --python tools\blender_build_npc.py -- `
  --rig   "C:\path\to\NPC\merchant.glb" `
  --anims "C:\path\to\NPC" `
  --out   "apps\web\public\merchant.glb"
```

Every `.fbx` in `--anims` becomes one clip named after the file, so `idle.fbx`
gives you an `idle` clip. `Talking.fbx` is aliased to `talk` because that is the
name the NPC registry looks for; anything else can be renamed with
`--name Waving=wave`.

The script also throws away unrigged junk sitting in the scene, discards stale
animations already inside the rig file, and renames the body mesh to
`Beta_Surface` so in-game colour tinting can find it.

It refuses to produce a silently broken file: no armature, an unskinned mesh, or
an FBX with no animation in it are all hard errors rather than a GLB that looks
fine until it reaches the game.

Then register it in `packages/shared/src/npcs.ts`:

```ts
{ id: "merchant", label: "Merchant", file: "merchant.glb", clips: { idle: "idle", talk: "talk" } },
```

The rest of this document is the manual version — worth reading when the script
complains, when the rigging itself goes wrong, or when you want to know what the
script is actually doing.

---

## What the game needs at the end

One `.glb` file in `apps/web/public/`, containing:

- the mesh, skinned to a skeleton,
- every animation baked in as a named clip,
- Y-up orientation (Blender's glTF exporter does this by default).

That is genuinely all. There is no import script, no manifest, no codegen for
characters — the file is read straight off disk by `useGLTF`.

Two things that are **not** requirements, despite looking like they might be:

- **Scale doesn't matter.** `prepareCharacterScene` measures the model's bounding
  box during its idle animation and rescales to 1.7 m. Mixamo exports in
  centimetres; the game does not care.
- **You do not need the hero's rig.** The hero has extra machinery (a `ChestProxy`
  bone for upper-body casting while running, `Spine1` for cursor aim). A standing
  NPC needs neither — the animation controller warns and disables those features
  when the bones are absent. The zombie already works this way.

One thing that *is* a requirement, and is easy to get wrong: **clip names must
match exactly**. The lookup is strict — exact match, or a normalised match that
ignores case, spaces and underscores (`Talk`, `talk`, `Talk_01`... no, that last
one is different). It never guesses at the nearest name. If two clips normalise to
the same string the lookup returns null for both, so avoid near-duplicates.

---

## Step 1 — Export from Meshy

Export as **FBX**, with textures. OBJ works too but FBX carries more reliably.

Check the triangle count before you upload. Mixamo's auto-rigger refuses very
dense meshes (roughly 150k triangles and up), and Meshy output can be far denser
than a game needs. If it is heavy, see *Reducing a heavy mesh* at the bottom —
do it now rather than after rigging, because rigging a mesh and then decimating
it destroys the skin weights.

---

## Step 2 — Auto-rig in Mixamo

Go to [mixamo.com](https://www.mixamo.com) (free, needs an Adobe account) and
click **Upload Character**.

**About your imperfect T-pose:** this matters much less than you would think. The
auto-rigger does not compare your pose against a reference T-pose. It asks you to
place markers on the body and infers the skeleton from those, then re-poses the
character into its own rest pose. What it actually needs is:

- upright, roughly facing forward,
- **arms clearly away from the torso** — the gap is what lets it separate arm from
  body. Straight out is ideal, drooping 45° is fine, arms touching the hips is not.
- **legs not touching each other**,
- one single mesh, not a pile of separate parts,
- fingers not fused into a solid mitten (fused fingers still rig, you just get no
  finger bones — irrelevant for a background villager).

If it accepts the upload you will get the marker step: drag the circles onto chin,
wrists, elbows, knees and groin. Take your time here, this is where accuracy pays.
Then click **Next** and wait for the preview to animate.

If the auto-rigger rejects it or the result is mangled, the usual cause is arms
too close to the body. The honest fix for a beginner is to **regenerate in Meshy
with a wider stance** rather than to fight it in Blender — posing an unrigged mesh
means rigging it first, which is the problem you were trying to solve. (Meshy also
has its own auto-rig now; if it produces a clean skeleton, you can skip Mixamo
entirely and just fetch animations for the rig you have.)

---

## Step 3 — Download the animations

With your character selected in Mixamo, search the animation library and pick your
clips. For a talking villager: **Idle** and **Talking** are the obvious two;
**Standing Greeting**, **Waving** and **Sitting Talking** are useful neighbours.

Download settings matter, and differ between the first file and the rest:

| | Format | Skin | Frames per second | Keyframe reduction |
|---|---|---|---|---|
| **First download** (the idle) | FBX Binary (.fbx) | **With Skin** | 30 | None |
| **Every other animation** | FBX Binary (.fbx) | **Without Skin** | 30 | None |

"With Skin" gives you the mesh plus the skeleton. "Without Skin" gives you the
skeleton and its animation only — you only need the mesh once, and downloading it
repeatedly just makes the Blender merge messier.

Rename the files as you download them, because Mixamo names every single one
`mixamo.com.fbx`. Use `idle.fbx`, `talk.fbx`, and so on.

---

## Step 4 — Merge everything into one file, in Blender

This is the only genuinely fiddly part. Mixamo gives you one animation per file;
the game wants one file with every animation in it.

The mental model: a Blender **action** is one animation clip. Importing an FBX
creates an armature object *and* an action. You want to end up with **one**
armature that owns **all** the actions, then export that.

### 4a. Start clean

Open Blender. Press `A` then `X` then `D` to delete the default cube, light and
camera. (`A` selects all, `X` deletes, `D` confirms.)

### 4b. Import the skinned character

`File ▸ Import ▸ FBX (.fbx)` and pick your **with-skin** `idle.fbx`.

You should see your character. In the **Outliner** (top-right panel) there is now
an `Armature` object with the mesh parented under it.

### 4c. Name the idle action

Change one editor to the Action Editor: at the **bottom-left corner of the timeline
strip along the bottom**, click the editor-type icon and choose **Dope Sheet**,
then in that editor's header change the mode dropdown from *Dope Sheet* to
**Action Editor**.

Click the armature in the viewport first — the Action Editor only shows actions for
the selected object. You should see an action named something like
`Armature|mixamo.com|Layer0`.

Rename it to exactly `idle` by double-clicking the name field.

Then click **Push Down** (the double-down-arrow button next to the action name).
This "stashes" the action onto an NLA track, which is what tells the exporter to
include it. *An action that is neither active nor stashed is silently not
exported* — this is the single most common reason people end up with a GLB
containing one animation instead of five.

### 4d. Import each remaining animation

`File ▸ Import ▸ FBX (.fbx)` on `talk.fbx`.

This adds a **second** armature to the scene. You do not want it — but you *do*
want the action it brought with it. So:

1. In the Outliner, click the **new** armature (the one that appeared, usually
   named `Armature.001`).
2. In the Action Editor, rename its action to exactly `talk`, then click the
   **shield icon** (Fake User) next to the action name. This marks the action as
   "keep me even if nothing is using me", so it survives deleting the armature.
3. Delete the new armature: with it selected in the Outliner, press `X` ▸ *Delete*.
4. Select your **original** armature. In the Action Editor, click the
   **browse-action dropdown** (the icon left of the action name) and pick `talk`
   from the list. It is now assigned to the correct skeleton.
5. Click **Push Down** to stash it.

Repeat for every animation. It is repetitive, but each clip is about thirty
seconds of clicking.

> This works because every Mixamo rig for a given character has identical bone
> names, so an action authored against one armature applies cleanly to another.

### 4e. Check your work

Switch an editor to the **Nonlinear Animation** view. You should see one track per
animation, each holding one strip, each named after its clip. If a clip is missing
here, it will be missing from the export.

Make sure **no track has its star (Solo) enabled** — soloing a track changes what
gets exported.

### 4f. Optional: rename the body mesh for in-game tinting

Only needed if you want to recolour this NPC at runtime the way player characters
are recoloured. The game only tints meshes whose name contains `surface` or starts
with `SM_Chr_`.

If you want that, select the mesh in the Outliner and rename it `Beta_Surface`. For
patterns to work it must also be UV-unwrapped, which a Meshy export will be.

For a villager with a baked Meshy texture you almost certainly **don't** want this
— leave the name alone and the texture shows as authored.

### 4g. Export

`File ▸ Export ▸ glTF 2.0 (.glb/.gltf)`.

In the export options on the right:

- **Format**: `glTF Binary (.glb)` — a single self-contained file.
- **Include ▸ Limit to**: leave *Selected Objects* **off**, so everything exports.
- **Data ▸ Mesh ▸ Apply Modifiers**: on.
- **Animation ▸ Animation Mode**: `Actions` (the default).
- **Animation ▸ Export Deformation Bones Only**: on. Drops control bones you don't
  have anyway, and shrinks the file.

Save it as `villager.glb` (or whatever you're calling this NPC) into
`apps/web/public/`.

### 4h. Verify before wiring it up

Drag the `.glb` onto [gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com).
The animation dropdown should list **every** clip, under **exactly** the names you
chose. Two minutes here saves an hour of debugging a silent missing-clip warning.

---

## Step 5 — Wiring it into the game

Small and mechanical, following the zombie's pattern
(`apps/web/src/game/zombieAsset.ts`):

1. A `<name>Asset.ts` exporting `assetUrl("<name>.glb")` and a
   `CharacterAnimationConfig` mapping the game's logical slots to your clip names.
2. Registration in `apps/web/src/game/prepareGameAssets.ts` so it loads on the
   loading screen instead of hitching mid-game.
3. A renderer component calling `prepareCharacterScene` and
   `CharacterAnimationController`.

The config's six required fields are `idle`, `runForward`, `runBackward`,
`strafeLeft`, `strafeRight` and `castPrimary`. A stationary NPC has no run cycle,
so point them all at your idle clip — the controller builds independently-named
masked clips per slot, so reusing one source is legal and the zombie already does
it (it points four locomotion slots at `run`).

---

## Reducing a heavy mesh

Meshy output is often much denser than a background character needs, and both
Mixamo and your frame rate will thank you for trimming it.

**Triangles**, in Blender, *before* rigging: select the mesh, then
`Modifier Properties` (wrench icon) `▸ Add Modifier ▸ Generate ▸ Decimate`. Set
*Ratio* to something like `0.3` and watch the face count in the statistics
overlay. Apply the modifier when it looks acceptable.

**Textures**: a 4k texture on a villager seen from 20 m away is waste. Easiest
route is after export, with no Blender involved:

```bash
npx gltf-transform resize villager.glb villager.glb --width 1024 --height 1024
npx gltf-transform draco villager.glb villager.glb
```

Worth caring about: `hero.glb` is 15 MB, and character GLBs are **not** in Git LFS
(only props, ground textures and map sidecars are). Every NPC you add lands in git
history as a plain blob, permanently. Aim for a couple of MB each.

---

## Troubleshooting

**Only one animation in the GLB.** Actions were not stashed. Every clip needs
*Push Down* in the Action Editor — check the NLA editor shows one track per clip.

**Console warns `missing clip`.** The name in your config does not match the name
in the file. Check the exact spelling in the glTF viewer. Remember the match
ignores case, spaces and underscores but nothing else.

**Character is enormous, or an ant.** It shouldn't be — the game rescales to 1.7 m
from the idle bounding box. If it is wrong, the idle clip is probably not being
found, so the stance probe never ran. Fix the clip name.

**Character floats above or sinks into the ground.** Foot placement comes from
locating an ankle or foot bone by name. Mixamo's `mixamorig:LeftFoot` is
recognised. If you renamed bones, that lookup fails and it falls back to a plain
bounding-box fit.

**Character is lying on its back.** Something exported Z-up. Re-export with the
default glTF settings; failing that, the renderer can pass
`upAxis: "mixamo-z"` to `prepareCharacterScene`.

**Animation plays but the mesh doesn't move with it.** The action got applied to an
armature that isn't the one the mesh is skinned to. Redo step 4d, making sure you
assign the action to the *original* armature.
