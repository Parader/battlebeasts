# Import Mixamo Y Bot into hero_bind.blend as a male reference body.
#
#   pnpm workbench:ybot

param(
    [string]$Fbx = ""
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Blender = "C:\Program Files\Blender Foundation\Blender 5.0\blender.exe"
$Blend = "C:\Users\deric\OneDrive\Documents\mage_trials\player\hero_bind.blend"
if (-not $Fbx) {
    $Fbx = "C:\Users\deric\OneDrive\Documents\mage_trials\player\Y Bot.fbx"
}

if (-not (Test-Path $Blender)) { throw "Blender not found: $Blender" }
if (-not (Test-Path $Blend)) { throw "Workbench not found: $Blend" }
if (-not (Test-Path $Fbx)) { throw "Y Bot FBX not found: $Fbx" }

Set-Location $Repo
$Script = Join-Path $Repo "tools\blender_add_ybot_to_bind.py"
& $Blender $Blend --background --python $Script -- --fbx $Fbx
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Refresh the Skins panel so Female / Male body tags exist.
$Install = Join-Path $Repo "tools\blender_install_skin_panel.py"
& $Blender --background --python $Install
exit $LASTEXITCODE
