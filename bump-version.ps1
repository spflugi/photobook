<#
.SYNOPSIS
    Bumps the app version across all three version files and commits the change.

.DESCRIPTION
    Updates the version in:
      - package.json
      - src-tauri/tauri.conf.json
      - src-tauri/Cargo.toml

    Commits the change with "chore: bump version to X.Y.Z".

    NOTE: No git tag is created automatically. Tag AFTER squashing/merging so
    the tag points to the final commit on your main branch, not an orphaned one:

        git tag v<new-version>
        git push origin v<new-version>

.PARAMETER Bump
    patch  — bug fixes, dependency updates, UI polish  (0.1.0 -> 0.1.1)
    minor  — new user-visible feature                  (0.1.0 -> 0.2.0)
    major  — breaking change or full redesign          (0.1.0 -> 1.0.0)

.EXAMPLE
    .\bump-version.ps1 -Bump minor
    .\bump-version.ps1 -Bump patch
#>

param(
    [Parameter(Mandatory)]
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot

# ── 1. Read current version from package.json ─────────────────────────────────
$pkgPath = Join-Path $root 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$current = $pkg.version

if ($current -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
    Write-Error "Could not parse version '$current' in package.json"
    exit 1
}

[int]$major = $Matches[1]
[int]$minor = $Matches[2]
[int]$patch = $Matches[3]

# ── 2. Increment ──────────────────────────────────────────────────────────────
switch ($Bump) {
    'major' { $major++; $minor = 0; $patch = 0 }
    'minor' { $minor++;             $patch = 0 }
    'patch' {                       $patch++   }
}

$new = "$major.$minor.$patch"
Write-Host "Bumping $current  ->  $new  ($Bump)" -ForegroundColor Cyan

# ── 3. Update package.json ────────────────────────────────────────────────────
# Use regex replacement to preserve formatting exactly.
$pkgRaw = Get-Content $pkgPath -Raw
$pkgRaw = $pkgRaw -replace `
    '("version"\s*:\s*)"[^"]+"', `
    "`$1`"$new`""
Set-Content $pkgPath -Value $pkgRaw -NoNewline
Write-Host "  package.json           -> $new"

# ── 4. Update tauri.conf.json ─────────────────────────────────────────────────
$tauriPath = Join-Path $root 'src-tauri\tauri.conf.json'
$tauriRaw = Get-Content $tauriPath -Raw
$tauriRaw = $tauriRaw -replace `
    '("version"\s*:\s*)"[^"]+"', `
    "`$1`"$new`""
Set-Content $tauriPath -Value $tauriRaw -NoNewline
Write-Host "  src-tauri/tauri.conf.json -> $new"

# ── 5. Update Cargo.toml ──────────────────────────────────────────────────────
$cargoPath = Join-Path $root 'src-tauri\Cargo.toml'
$cargoRaw = Get-Content $cargoPath -Raw
# Only replace the version under [package], not dependency version strings.
# Match: version = "x.y.z" that appears before the first [dependencies] line.
$cargoRaw = $cargoRaw -replace `
    '(?m)^(version\s*=\s*)"[^"]+"', `
    "`$1`"$new`""
Set-Content $cargoPath -Value $cargoRaw -NoNewline
Write-Host "  src-tauri/Cargo.toml   -> $new"

# ── 6. Git commit ─────────────────────────────────────────────────────────────
git -C $root add `
    package.json `
    src-tauri/tauri.conf.json `
    src-tauri/Cargo.toml

git -C $root commit -m "chore: bump version to $new"

Write-Host ""
Write-Host "Done. When ready to tag (after squash/merge):" -ForegroundColor Green
Write-Host "  git tag v$new" -ForegroundColor Yellow
Write-Host "  git push origin v$new" -ForegroundColor Yellow
