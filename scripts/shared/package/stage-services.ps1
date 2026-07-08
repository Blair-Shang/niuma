#Requires -Version 5.1
<#
.SYNOPSIS
  构建能力服务并复制到壳层安装目录（niuma.exe 同级 services/）。
.NOTES
  ServiceManager 拉起 services/bin/niuma-platform-core.exe。
#>
param(
    [Parameter(Mandatory)]
    [string]$InstallDir,

    [ValidateSet('windows', 'linux', 'kylin', 'macos')]
    [string]$Platform = 'windows',

    [ValidateSet('x64', 'arm64')]
    [string]$Arch = 'x64',

    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$BinSrc = Join-Path $Root 'services/bin'
$TargetBinSrc = Join-Path $BinSrc "$Platform-$Arch"
$ManSrc = Join-Path $Root 'services/manifests'
$BinDst = Join-Path $InstallDir 'services/bin'
$ManDst = Join-Path $InstallDir 'services/manifests'
$StopScript = Join-Path $PSScriptRoot '..\tasks\stop-services.ps1'
$BuildScript = Join-Path $PSScriptRoot '..\build\build-services.ps1'

if (-not $SkipBuild) {
    & $StopScript -BinDir $BinSrc
    & $BuildScript -Platform $Platform -Arch $Arch -Configuration $Configuration
}

$platformExe = if (Test-Path (Join-Path $TargetBinSrc 'niuma-platform-core.exe')) {
    Join-Path $TargetBinSrc 'niuma-platform-core.exe'
} elseif (Test-Path (Join-Path $TargetBinSrc 'niuma-platform-core')) {
    Join-Path $TargetBinSrc 'niuma-platform-core'
} else {
    $null
}
if (-not (Test-Path $platformExe)) {
    throw "platform-core binary missing at $TargetBinSrc — run: scripts/shared/build/build-services.ps1 -Platform $Platform -Arch $Arch"
}

New-Item -ItemType Directory -Force -Path $BinDst | Out-Null
& $StopScript -BinDir $BinDst
Copy-Item -Recurse -Force "$TargetBinSrc\*" $BinDst

if (Test-Path $ManSrc) {
    New-Item -ItemType Directory -Force -Path $ManDst | Out-Null
    Copy-Item -Recurse -Force "$ManSrc\*" $ManDst
}

Write-Host "==> services staged -> $InstallDir\services" -ForegroundColor Green
