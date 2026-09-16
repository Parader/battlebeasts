# Copy hero.glb `idle` onto hero_bind.blend (game stance for clipping checks).
#
#   pnpm workbench:idle

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Blender = "C:\Program Files\Blender Foundation\Blender 5.0\blender.exe"
$Blend = "C:\Users\deric\OneDrive\Documents\mage_trials\player\hero_bind.blend"
$Script = Join-Path $Repo "tools\blender_bind_idle.py"

if (-not (Test-Path $Blender)) { throw "Blender not found: $Blender" }
if (-not (Test-Path $Blend)) { throw "Workbench not found: $Blend" }

Set-Location $Repo
& $Blender $Blend --background --python $Script
exit $LASTEXITCODE
