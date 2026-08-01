# ChestProxy (V Rising–style) — production

Upper-body masks alone break Mixamo casts: legs own the pelvis, so chest/arm
locals no longer match the authored clip. V Rising’s fix is a **proxy joint under
root**, constrained to the chest in DCC, then runtime snap of the real chest to
that proxy. See [V Rising animation layering](https://80.lv/articles/v-rising-s-animation-layering-in-unity).

## Runtime

`CharacterAnimationController` defaults:

- `chestProxySnap: true` (only remaining cast option)
- Upper casts use base Mixamo names from `heroAnimationConfig`
- After mixer: snap Spine1 → `ChestProxy`, then additive Spine1 cursor aim

## Which actions to bake

**Source of truth:** `tools/spell_cast_bake_actions.json`  
(mirrored by `HERO_CHEST_PROXY_BAKE_ACTIONS` in `animationConfig.ts`)

Upper-body spell casts only. Idle / loco / dance / full-body channels do not need
ChestProxy keys.

When you add a new upper cast:

1. Add the Mixamo action + spell ids to `spell_cast_bake_actions.json`
2. Point `heroAnimationConfig.cast*` at the base clip name
3. Re-run the Blender bake script and re-export `hero.glb`

## Blender bake

```powershell
blender path\to\hero.blend --background --python C:\solo\battlebeasts2\tools\blender_add_chest_proxy.py -- `
  --chest Spine1 `
  --out-blend path\to\hero_proxy.blend
```

With no `--actions`, the script loads `spell_cast_bake_actions.json`.

Or in Blender: Scripting → Open the repo script → **Run Script** → **File → Save**.

Then export GLB into `apps/web/public/hero.glb` and verify casts in-game while strafing.
