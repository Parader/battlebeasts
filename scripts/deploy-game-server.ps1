# Deploy BattleBeasts game-server to Fly.io (run from repo root in an interactive terminal)
#
# 1) flyctl auth login
# 2) .\scripts\deploy-game-server.ps1

$ErrorActionPreference = "Continue"
# PS 7+: don't treat native stderr (flyctl warnings) as terminating errors
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$env:Path = "C:\Users\deric\.fly\bin;" + $env:Path

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$EnvFile = Join-Path $Root "apps\game-server\.env"
if (-not (Test-Path $EnvFile)) {
  throw "Missing apps/game-server/.env - need SUPABASE_URL and SUPABASE_SECRET_KEY"
}

# Parse .env without printing secrets
$vars = @{}
Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $i = $line.IndexOf("=")
  if ($i -lt 1) { return }
  $key = $line.Substring(0, $i).Trim()
  $val = $line.Substring($i + 1).Trim()
  if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
    $val = $val.Substring(1, $val.Length - 2)
  }
  $vars[$key] = $val
}

if (-not $vars["SUPABASE_URL"] -or -not $vars["SUPABASE_SECRET_KEY"]) {
  throw "SUPABASE_URL and SUPABASE_SECRET_KEY required in apps/game-server/.env"
}

function Invoke-Fly {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$FlyArgs)
  & flyctl @FlyArgs
  if ($LASTEXITCODE -ne 0) {
    throw "flyctl $($FlyArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}

$appName = "battlebeasts-game"

Write-Host "Checking for existing Fly app..."
$exists = $false
try {
  $appsJson = & flyctl apps list --json 2>$null
  if ($LASTEXITCODE -eq 0 -and $appsJson) {
    $apps = $appsJson | ConvertFrom-Json
    $exists = $null -ne ($apps | Where-Object { $_.Name -eq $appName })
  }
} catch {
  Write-Host "Could not list apps; will try create/deploy anyway."
}

if (-not $exists) {
  Write-Host "Creating app $appName..."
  & flyctl apps create $appName --org personal
  if ($LASTEXITCODE -ne 0) {
    Write-Host "App create returned $LASTEXITCODE (may already exist or name taken). Continuing..."
  }
}

Write-Host "Setting secrets..."
Invoke-Fly secrets set `
  "SUPABASE_URL=$($vars['SUPABASE_URL'])" `
  "SUPABASE_SECRET_KEY=$($vars['SUPABASE_SECRET_KEY'])" `
  --app $appName

Write-Host "Deploying (remote build)..."
Invoke-Fly deploy --config fly.toml --dockerfile Dockerfile.game-server --remote-only --app $appName

Write-Host ""
Write-Host "Health check:"
& flyctl status --app $appName
$url = "https://$appName.fly.dev/health"
try {
  (Invoke-RestMethod $url) | ConvertTo-Json -Compress
} catch {
  Write-Host "Health not ready yet: $_"
}

Write-Host ""
Write-Host "Point clients at:  wss://$appName.fly.dev"
Write-Host ('Electron config.json: { "gameServerUrl": "wss://{0}.fly.dev" }' -f $appName)
