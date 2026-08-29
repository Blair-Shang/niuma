#Requires -Version 5.1
<#
.SYNOPSIS
.DESCRIPTION
  组装 NiuMa Windows 发布目录。
  默认输出：output/<platform>-<arch>/dir/
  SQL 源脚本来自 scripts/sql/sqlite/，复制到发布包内 platform/migrations/sqlite/。
#>
param(
    [ValidateSet('windows')]
    [string]$Platform = 'windows',

    [ValidateSet('x64', 'arm64')]
    [string]$Arch = 'x64',

    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [string]$OutputDir = '',
    [switch]$SkipWebBuild,
    [switch]$SkipShellBuild
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
. (Join-Path $Root 'scripts\shared\lib\matrix.ps1')

if (-not $OutputDir) {
    $OutputDir = Get-DefaultPackOutputDir -RepoRoot $Root -Platform $Platform -Arch $Arch -Format 'dir'
}
$Staging = Join-Path $Root 'build/pack-staging'
$ShellBuild = Get-ShellInstallDir -RepoRoot $Root -Platform $Platform -Arch $Arch -Configuration $Configuration
$legacyShellBuild = Join-Path $Root "build/shell/$Configuration"
if (-not (Test-Path (Join-Path $ShellBuild 'niuma.exe')) -and (Test-Path (Join-Path $legacyShellBuild 'niuma.exe'))) {
    $ShellBuild = $legacyShellBuild
}
$CefRoot = Join-Path $Root 'third_party/cef'
$WebDist = Join-Path $Root 'web/dist'
$SqlSrc = Join-Path $Root 'scripts/sql/sqlite'
$BuildShellScript = Join-Path $PSScriptRoot '..\build\build-shell.ps1'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

if (-not $SkipWebBuild) {
    Write-Step 'Building web (pnpm build:web)...'
    Push-Location $Root
    try {
        pnpm build:web
        if ($LASTEXITCODE -ne 0) {
            throw "pnpm build:web failed ($LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }
}
if (-not (Test-Path (Join-Path $WebDist 'index.html'))) {
    throw "web/dist/index.html not found. Run: pnpm build:web"
}

if (-not $SkipShellBuild) {
    if (-not (Test-Path $CefRoot)) {
        Write-Warning "CEF not found at third_party/cef. Run: pnpm cef:download"
        Write-Warning "Skipping shell build; copy niuma.exe manually if already built."
    } else {
        Write-Step "Building shell ($Platform-$Arch) via platform entry..."
        & $BuildShellScript -Platform $Platform -Arch $Arch -Configuration $Configuration
        if ($LASTEXITCODE -ne 0) {
            throw "build shell failed ($LASTEXITCODE)"
        }
        $ShellBuild = Get-ShellInstallDir -RepoRoot $Root -Platform $Platform -Arch $Arch -Configuration $Configuration
    }
}

Write-Step "Staging -> $OutputDir"
if (Test-Path $Staging) { Remove-Item -Recurse -Force $Staging }
if (Test-Path $OutputDir) { Remove-Item -Recurse -Force $OutputDir }
New-Item -ItemType Directory -Force -Path $Staging | Out-Null
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$ResWeb = Join-Path $Staging 'resources/web'
New-Item -ItemType Directory -Force -Path $ResWeb | Out-Null
Copy-Item -Recurse -Force "$WebDist\*" $ResWeb
Get-ChildItem -Path $ResWeb -Recurse -Filter '*.map' -File -ErrorAction SilentlyContinue |
    Remove-Item -Force

$MigDst = Join-Path $Staging 'platform/migrations/sqlite'
New-Item -ItemType Directory -Force -Path $MigDst | Out-Null
if (Test-Path $SqlSrc) {
    Copy-Item -Force "$SqlSrc\*.sql" $MigDst
} else {
    throw "SQL migrations not found: $SqlSrc"
}

$ManSrc = Join-Path $Root 'services/manifests'
$ManDst = Join-Path $Staging 'services/manifests'
if (Test-Path $ManSrc) {
    New-Item -ItemType Directory -Force -Path $ManDst | Out-Null
    Copy-Item -Recurse -Force "$ManSrc\*" $ManDst
}

$ServicesBinSrc = Get-ServicesBinDir -RepoRoot $Root -Platform $Platform -Arch $Arch
$ServicesBinDst = Join-Path $Staging 'services/bin'
if (-not (Test-Path $ServicesBinSrc)) {
    throw "services matrix bin missing at $ServicesBinSrc - build services for $Platform/$Arch first (do not fall back to flat services/bin)"
}
New-Item -ItemType Directory -Force -Path $ServicesBinDst | Out-Null
Copy-Item -Recurse -Force "$ServicesBinSrc\*" $ServicesBinDst

$PluginsSrc = Join-Path $Root 'plugins'
$PluginsDst = Join-Path $Staging 'plugins'
if (Test-Path $PluginsSrc) {
    Copy-Item -Recurse -Force $PluginsSrc $PluginsDst
}

$ComponentsSrc = Join-Path $Root 'components'
$ComponentsDst = Join-Path $Staging 'components'
if (Test-Path $ComponentsSrc) {
    Copy-Item -Recurse -Force $ComponentsSrc $ComponentsDst
}

$NiumaExe = Join-Path $ShellBuild 'niuma.exe'
if (Test-Path $NiumaExe) {
    Copy-Item -Force $NiumaExe $Staging
} else {
    Write-Warning "niuma.exe not found at $NiumaExe - pack web-only skeleton"
}

# CEF 运行时：优先用壳层 POST_BUILD 已拷到 exe 旁的文件（CI prune 后 third_party/cef 可能已删）。
# 官方 Windows 发行包把 .pak 放在 Resources/，不在 Release/；只拷 Release 会漏 resources.pak。
$cefRuntimeNames = @(
    'chrome_100_percent.pak'
    'chrome_200_percent.pak'
    'resources.pak'
    'icudtl.dat'
    'v8_context_snapshot.bin'
    'snapshot_blob.bin'
    'libcef.dll'
    'chrome_elf.dll'
    'libEGL.dll'
    'libGLESv2.dll'
    'd3dcompiler_47.dll'
    'dxcompiler.dll'
    'dxil.dll'
    'vk_swiftshader.dll'
    'vk_swiftshader_icd.json'
    'vulkan-1.dll'
)
foreach ($name in $cefRuntimeNames) {
    $src = Join-Path $ShellBuild $name
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination $Staging -Force
    }
}
$shellLocales = Join-Path $ShellBuild 'locales'
if (Test-Path -LiteralPath $shellLocales) {
    $localesDst = Join-Path $Staging 'locales'
    New-Item -ItemType Directory -Force -Path $localesDst | Out-Null
    Copy-Item -Recurse -Force "$shellLocales\*" $localesDst
}

$CefRelease = Join-Path $CefRoot 'Release'
if (Test-Path $CefRelease) {
    Get-ChildItem -LiteralPath $CefRelease -File | Where-Object {
        $_.Extension -notin @('.lib', '.pdb', '.exp')
    } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Staging -Force
    }
}
$CefResources = Join-Path $CefRoot 'Resources'
if (Test-Path $CefResources) {
    Get-ChildItem -LiteralPath $CefResources | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Staging -Recurse -Force
    }
}

Copy-Item -Recurse -Force "$Staging\*" $OutputDir
Remove-Item -Recurse -Force $Staging

$requiredRuntime = @(
    'niuma.exe'
    'libcef.dll'
    'chrome_elf.dll'
    'chrome_100_percent.pak'
    'resources.pak'
    'icudtl.dat'
)
$missingRuntime = @()
foreach ($name in $requiredRuntime) {
    if (-not (Test-Path -LiteralPath (Join-Path $OutputDir $name))) {
        $missingRuntime += $name
    }
}
$localeZh = Join-Path $OutputDir 'locales\zh-CN.pak'
$localeEn = Join-Path $OutputDir 'locales\en-US.pak'
if (-not (Test-Path -LiteralPath $localeZh) -and -not (Test-Path -LiteralPath $localeEn)) {
    $missingRuntime += 'locales/zh-CN.pak or locales/en-US.pak'
}
if ($missingRuntime.Count -gt 0) {
    throw "Packed CEF runtime missing: $($missingRuntime -join ', '). Run: pnpm cef:download"
}

$StageComplianceScript = Join-Path $Root 'scripts\shared\package\stage-compliance.ps1'
& $StageComplianceScript -DestDir $OutputDir -RepoRoot $Root

$SignScript = Join-Path $Root 'scripts\shared\sign\sign-windows.ps1'
$packedExe = Join-Path $OutputDir 'niuma.exe'
if ((Test-Path $SignScript) -and (Test-Path $packedExe)) {
    & $SignScript -FilePath $packedExe
}

Write-Step "Done: $OutputDir"
Get-ChildItem $OutputDir | Select-Object Name, Length | Format-Table -AutoSize
