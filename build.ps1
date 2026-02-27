<#
.SYNOPSIS
    Builds the PhotoBook Tauri app after setting up the MSVC build environment.

.DESCRIPTION
    Finds the latest Visual Studio installation via vswhere, initialises the
    x64 MSVC environment (so the correct link.exe is in PATH), then delegates
    to the requested build command.

.PARAMETER Mode
    dev     — start Tauri dev server with hot-reload  (default)
    debug   — build a debug installer
    release — build the optimised release installer

.EXAMPLE
    .\build.ps1              # dev server
    .\build.ps1 -Mode debug
    .\build.ps1 -Mode release
#>

param(
    [ValidateSet('dev', 'debug', 'release')]
    [string]$Mode = 'dev'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── 1. Locate vswhere ─────────────────────────────────────────────────────────
$vswhere = Join-Path ${env:ProgramFiles(x86)} `
    'Microsoft Visual Studio\Installer\vswhere.exe'

if (-not (Test-Path $vswhere)) {
    Write-Error @"
vswhere.exe not found at:
  $vswhere

Install Visual Studio 2019 or later (any edition, including Build Tools).
https://visualstudio.microsoft.com/downloads/
"@
    exit 1
}

# ── 2. Find latest VS with the VC toolchain ───────────────────────────────────
$vsPath = & $vswhere -latest -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath

if (-not $vsPath) {
    Write-Error @"
No Visual Studio installation with VC++ tools found.
Make sure the "Desktop development with C++" workload is installed.
"@
    exit 1
}

$vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvarsall.bat'
Write-Host "Using VS at: $vsPath" -ForegroundColor Cyan

# ── 3. Initialise the x64 MSVC environment, then run the build ───────────────
$npmCmd = switch ($Mode) {
    'dev'     { 'npm run tauri dev' }
    'debug'   { 'npm run tauri build -- --debug' }
    'release' { 'npm run tauri build' }
}

Write-Host "Mode: $Mode  →  $npmCmd" -ForegroundColor Cyan

# cmd /c lets us source vcvarsall (a .bat file) and then run our command in
# the same process so the environment changes are inherited.
cmd /c "`"$vcvars`" x64 && $npmCmd"
exit $LASTEXITCODE
