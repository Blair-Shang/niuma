#Requires -Version 5.1
<#
.SYNOPSIS
  Windows 首次环境：下载 CEF，检查 CMake / Visual Studio / Rust。
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$DownloadCefScript = Join-Path $Root 'scripts\platforms\windows\setup\download-cef.ps1'

function Test-CMake {
    if (Get-Command cmake -ErrorAction SilentlyContinue) { return $true }
    return Test-Path "${env:ProgramFiles}\CMake\bin\cmake.exe"
}

function Test-Msvc {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) { return $false }
    $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    return [bool]$install
}

function Test-Rust {
    return [bool](Get-Command cargo -ErrorAction SilentlyContinue)
}

function Install-BuildTools {
    Write-Host 'Installing Visual Studio 2022 Build Tools (C++)...' -ForegroundColor Yellow
    Write-Host 'This may take several minutes.' -ForegroundColor Gray
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e `
        --accept-package-agreements --accept-source-agreements `
        --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
}

function Install-RustToolchain {
    Write-Host 'Installing Rust toolchain (rustup + stable)...' -ForegroundColor Yellow
    winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements
    $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
    if (Test-Path $cargoBin) {
        $env:Path = "$cargoBin;$env:Path"
    }
    $rustup = Get-Command rustup -ErrorAction SilentlyContinue
    if (-not $rustup) {
        Write-Host 'rustup not found after install. Reopen terminal and rerun pnpm setup:desktop.' -ForegroundColor Red
        exit 1
    }
    & $rustup.Source toolchain install stable
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $rustup.Source default stable
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host 'NiuMa desktop setup' -ForegroundColor Cyan

if (-not (Test-CMake)) {
    Write-Host 'Installing CMake (winget)...' -ForegroundColor Yellow
    winget install --id Kitware.CMake -e --accept-package-agreements --accept-source-agreements
}

if (-not (Test-Msvc)) {
    Install-BuildTools
    if (-not (Test-Msvc)) {
        Write-Host 'MSVC not detected after install. Open "Visual Studio Installer" and add "Desktop development with C++".' -ForegroundColor Red
        exit 1
    }
}

if (-not (Test-Rust)) {
    Install-RustToolchain
    if (-not (Test-Rust)) {
        Write-Host 'cargo not detected after install. Reopen terminal and run cargo --version.' -ForegroundColor Red
        exit 1
    }
}

& $DownloadCefScript
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Setup complete. Next: pnpm dev' -ForegroundColor Green
