#Requires -Version 5.1
<#
.SYNOPSIS
  构建能力服务并复制到壳层安装目录（niuma.exe 同级 services/）。
.NOTES
  ServiceManager 拉起 services/bin/niuma-platform-core.exe。
  生产 stage 只认矩阵目录 services/bin/<platform>-<arch>/，不从平铺 bin 回退，
  避免旧产物污染安装包。旁载 runtime 仅同步占位说明，不打入厂商 DLL。
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

# 旁载 runtime：只同步目录结构与说明文件，排除厂商 native 库（开发机解压的 Instant Client 等不得进包）
$RuntimeSrc = Join-Path $BinSrc 'runtime'
$RuntimeDst = Join-Path $BinDst 'runtime'
if (Test-Path $RuntimeSrc) {
    Get-ChildItem -Path $RuntimeSrc -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            $name = $_.Name.ToLowerInvariant()
            $name -eq 'readme.txt' -or $name -eq '.gitkeep' -or $name -eq 'readme.md'
        } |
        ForEach-Object {
            $rel = $_.FullName.Substring($RuntimeSrc.Length).TrimStart('\', '/')
            $dest = Join-Path $RuntimeDst $rel
            $destDir = Split-Path $dest -Parent
            if (-not (Test-Path $destDir)) {
                New-Item -ItemType Directory -Force -Path $destDir | Out-Null
            }
            Copy-Item -Force $_.FullName $dest
        }
}

if (Test-Path $ManSrc) {
    New-Item -ItemType Directory -Force -Path $ManDst | Out-Null
    Copy-Item -Recurse -Force "$ManSrc\*" $ManDst
}

Write-Host "==> services staged -> $InstallDir\services (matrix-only: $TargetBinSrc)" -ForegroundColor Green
