# Elemental sandbox VFX reference (MIT)

Vendored excerpts from [LinearAbiltyCastingThreeJS](https://github.com/mohamedachrefelouafi/LinearAbiltyCastingThreeJS) (MIT).

**Use freely** for recipes, shaders, methods, and assets — keep this folder next to our live VFX so ports stay faithful.

| File | What we take from it |
| --- | --- |
| `GroundDecals.js` | FROST snow-powder height field, ARC forks, SCORCH, etc. |
| `FrostFieldMaterial.js` | Standing ice sheet: plates, seams, fingers, freeze front |
| `LightningMaterial.js` / `ThunderAbility.js` | Filament bolts, restrike, glow passes |
| `SnareMaterial.js` | Voltaic Snare cage + **burnt ground field** (lightning ground) |
| `noise.glsl.js` | fbm / voronoi / ridged helpers shared by those shaders |
| `LICENSE` | MIT — retain in redistributions |

Live ports in Battle Beasts:

- Lab frost ground → `apps/web/src/game/vfx/engine/labShapeMaterials.ts` (`uMode` frost)
- In-game ice decals → `apps/web/src/game/vfx/materials/groundDecal.ts` + `presets/ground.ts` (`iceFrost`)
- Lightning filaments → `apps/web/src/game/vfx/engine/lightningArcs.ts`

Upstream source on disk (edit / re-copy from here when sandbox updates):

`c:\solo\elemental sandbox\LinearAbiltyCastingThreeJS\`

---

## Ardent Wilds (proprietary — reference only)

Do **not** copy AW assets into the repo. Keep the install nearby for look / method reference:

`C:\Program Files (x86)\Steam\steamapps\common\Ardent Wilds Demo\`

Useful paths:

- `assets\shaders\telegraph_decal.glsl` — outline + progress charge fill
- `assets\textures\vfx\` — ice pools, electric streaks, etc.
- `assets\visuals\vfx\` — `.vis` recipes (shields, status, etc.)
