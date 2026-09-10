# Export workbench skins from hero_bind.blend → apps/web/public/cosmetics
#
#   pnpm export:skins:install   # sidebar panel (restart Blender after)
#   pnpm export:skins
#   pnpm export:skins -- --stale
#   pnpm export:skins -- --only shoes_set_1
#
# Save the .blend first. Tags live on each mesh: Sidebar → Character → Skins.

param(
    [string]$Only = "",
    [switch]$List,
    [switch]$Stale,
    [switch]$Install
)

$ErrorActionPreference = "Stop"
if (-not $Only) {
    $idx = [array]::IndexOf($args, "--only")
    if ($idx -ge 0 -and $idx + 1 -lt $args.Count) { $Only = [string]$args[$idx + 1] }
}
if ($args -contains "--list") { $List = $true }
if ($args -contains "--stale") { $Stale = $true }
if ($args -contains "--install") { $Install = $true }

$Repo = Split-Path -Parent $PSScriptRoot
$Blender = "C:\Program Files\Blender Foundation\Blender 5.0\blender.exe"
$Blend = "C:\Users\deric\OneDrive\Documents\mage_trials\player\hero_bind.blend"

if (-not (Test-Path $Blender)) { throw "Blender not found: $Blender" }

Set-Location $Repo
if ($Install) {
    $InstallScript = Join-Path $Repo "tools\blender_install_skin_panel.py"
    & $Blender --background --python $InstallScript
    exit $LASTEXITCODE
}

if (-not (Test-Path $Blend)) { throw "Workbench not found: $Blend. Save hero_bind.blend first." }
$Script = Join-Path $Repo "tools\blender_export_skins.py"
$pyArgs = @($Blend, "--background", "--python", $Script, "--")
if ($List) { $pyArgs += "--list" }
if ($Stale) { $pyArgs += "--stale" }
if ($Only) { $pyArgs += @("--only", $Only) }
& $Blender @pyArgs
exit $LASTEXITCODE
