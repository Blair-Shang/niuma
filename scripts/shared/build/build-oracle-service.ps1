#Requires -Version 5.1
<#
.SYNOPSIS
  构建 niuma-oracle-service（C++20 + ODPI-C）到 services/bin/<platform>-<arch>/。
  不依赖 Instant Client SDK；运行时需旁载 Instant Client 到 bin/runtime/oracle。
  常规 build-services.ps1 不强制构建本服务；本脚本产物会写入矩阵目录，供 stage-services 拷贝。
#>
param(
    [ValidateSet('windows', 'linux', 'kylin', 'macos')]
    [string]$Platform = 'windows',

    [ValidateSet('x64', 'arm64')]
    [string]$Arch = 'x64',

    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
try { chcp 65001 | Out-Null } catch {}
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
. (Join-Path $Root 'scripts\shared\lib\matrix.ps1')

Assert-NativeMatrix -Platform $Platform -Arch $Arch

$Svc = Join-Path $Root 'services\oracle-service'
$BinDir = Join-Path $Root 'services\bin'
$TargetBinDir = Get-ServicesBinDir -RepoRoot $Root -Platform $Platform -Arch $Arch
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

foreach ($dir in @($BinDir, $TargetBinDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
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

$exeName = if ($Platform -eq 'windows') { 'niuma-oracle-service.exe' } else { 'niuma-oracle-service' }
$dest = Join-Path $TargetBinDir $exeName
# 优先取本次 cmake 产物（含 NIUMA_SERVICES_BIN 平铺输出），勿先命中矩阵目录里的旧二进制，
# 否则会把刚编好的 exe 用陈旧桩覆盖（曾表现为 oracle: not implemented (P1+)）。
$candidates = @(
    (Join-Path $BinDir $exeName),
    (Join-Path (Join-Path $BuildDir $Configuration) $exeName),
    (Join-Path $BuildDir $exeName),
    $dest
)
$built = $null
$builtTime = [datetime]::MinValue
foreach ($c in $candidates) {
    if (-not (Test-Path $c)) { continue }
    $t = (Get-Item $c).LastWriteTimeUtc
    if ($t -gt $builtTime) {
        $built = (Resolve-Path $c).Path
        $builtTime = $t
    }
}
if (-not $built) {
    $found = Get-ChildItem -Path $BuildDir -Recurse -Filter $exeName -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\CMakeFiles\\' } |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($found) { $built = $found.FullName }
}
if (-not $built) {
    throw "built binary not found: $exeName"
}
if ($built -ne $dest) {
    Copy-Item -Force $built $dest
}
Write-Host "Output: $dest (from $built)"

# 本机 Windows 兼容平铺目录（与 build-services.ps1 legacy sync 一致）
if ($Platform -eq 'windows' -and $Arch -eq (Get-MatrixHostArch)) {
    $legacyDest = Join-Path $BinDir $exeName
    if ($built -ne $legacyDest) {
        Copy-Item -Force $built $legacyDest
    }
    Write-Host "Legacy: $legacyDest"
}

if (-not $SkipTests) {
    ctest --test-dir $BuildDir -C $Configuration --output-on-failure
    if ($LASTEXITCODE -ne 0) { throw 'ctest failed' }
}

Write-Host 'oracle-service build ok'
