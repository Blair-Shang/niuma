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
if (Test-Path $ServicesBinSrc) {
    New-Item -ItemType Directory -Force -Path $ServicesBinDst | Out-Null
    Copy-Item -Recurse -Force "$ServicesBinSrc\*" $ServicesBinDst
}

$PluginsSrc = Join-Path $Root 'plugins'
$PluginsDst = Join-Path $Staging 'plugins'
if (Test-Path $PluginsSrc) {
    Copy-Item -Recurse -Force $PluginsSrc $PluginsDst
}

$NiumaExe = Join-Path $ShellBuild 'niuma.exe'
if (Test-Path $NiumaExe) {
    Copy-Item -Force $NiumaExe $Staging
} else {
    Write-Warning "niuma.exe not found at $NiumaExe — pack web-only skeleton"
}

$CefRelease = Join-Path $CefRoot 'Release'
if (Test-Path $CefRelease) {
    Copy-Item -Force "$CefRelease\*" $Staging
}
$CefResources = Join-Path $CefRoot 'Resources'
if (Test-Path $CefResources) {
    $LocalesDst = Join-Path $Staging 'locales'
    New-Item -ItemType Directory -Force -Path $LocalesDst | Out-Null
    Copy-Item -Recurse -Force (Join-Path $CefResources 'locales/*') $LocalesDst -ErrorAction SilentlyContinue
    Copy-Item -Force (Join-Path $CefResources 'icudtl.dat') $Staging -ErrorAction SilentlyContinue
}

Copy-Item -Recurse -Force "$Staging\*" $OutputDir
Remove-Item -Recurse -Force $Staging

$StageComplianceScript = Join-Path $Root 'scripts\shared\package\stage-compliance.ps1'
& $StageComplianceScript -DestDir $OutputDir -RepoRoot $Root

Write-Step "Done: $OutputDir"
Get-ChildItem $OutputDir | Select-Object Name, Length | Format-Table -AutoSize
