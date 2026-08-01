#Requires -Version 5.1
<#
.SYNOPSIS
  构建 niuma-oracle-service（C++20 + ODPI-C）到 services/bin/。
  不依赖 Instant Client SDK；运行时需旁载 Instant Client 到 bin/runtime/oracle。
#>
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
try { chcp 65001 | Out-Null } catch {}
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$Svc = Join-Path $Root 'services\oracle-service'
$BinDir = Join-Path $Root 'services\bin'
$BuildDir = Join-Path $Svc 'build'
$OdpiDir = Join-Path $Svc 'third_party\odpi'
$JsonHdr = Join-Path $Svc 'third_party\nlohmann\json.hpp'

if (-not (Test-Path $OdpiDir)) {
    Write-Host 'Cloning ODPI-C v5.4.1 ...'
    git clone --depth 1 --branch v5.4.1 https://github.com/oracle/odpi.git $OdpiDir
}
if (-not (Test-Path $JsonHdr)) {
    $dir = Split-Path $JsonHdr -Parent
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Write-Host 'Downloading nlohmann/json.hpp ...'
    Invoke-WebRequest -Uri 'https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp' -OutFile $JsonHdr -UseBasicParsing
}

if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
}
$RuntimeOracle = Join-Path $BinDir 'runtime\oracle'
if (-not (Test-Path $RuntimeOracle)) {
    New-Item -ItemType Directory -Force -Path $RuntimeOracle | Out-Null
    $keep = Join-Path $RuntimeOracle '.gitkeep'
    if (-not (Test-Path $keep)) {
        Set-Content -Path $keep -Value '' -Encoding utf8
    }
    $readme = Join-Path $RuntimeOracle 'README.txt'
    if (-not (Test-Path $readme)) {
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($readme, @"
Place Oracle Instant Client (Basic or Basic Light) files here (oci.dll, etc.).
See docs/29-oracle-module.md and services/oracle-service/README.md.
"@, $utf8)
    }
}

$env:NIUMA_SERVICES_BIN = $BinDir

Write-Host "Configuring ($Configuration) ..."
cmake -S $Svc -B $BuildDir -DNIUMA_ORACLE_BUILD_TESTS=ON
if ($LASTEXITCODE -ne 0) { throw 'cmake configure failed' }

Write-Host "Building ..."
cmake --build $BuildDir --config $Configuration
if ($LASTEXITCODE -ne 0) { throw 'cmake build failed' }

$exeName = if ($env:OS -match 'Windows') { 'niuma-oracle-service.exe' } else { 'niuma-oracle-service' }
$dest = Join-Path $BinDir $exeName
$candidates = @(
    $dest,
    (Join-Path (Join-Path $BuildDir $Configuration) $exeName),
    (Join-Path $BuildDir $exeName)
)
$built = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $built) {
    $found = Get-ChildItem -Path $BuildDir -Recurse -Filter $exeName -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\CMakeFiles\\' } |
        Select-Object -First 1
    if ($found) { $built = $found.FullName }
}
if (-not $built) {
    throw "built binary not found: $exeName"
}
if ($built -ne $dest) {
    Copy-Item -Force $built $dest
}
Write-Host "Output: $dest"

if (-not $SkipTests) {
    ctest --test-dir $BuildDir -C $Configuration --output-on-failure
    if ($LASTEXITCODE -ne 0) { throw 'ctest failed' }
}

Write-Host 'oracle-service build ok'
