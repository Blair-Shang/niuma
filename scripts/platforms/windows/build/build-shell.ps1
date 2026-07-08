#Requires -Version 5.1
<#
.SYNOPSIS
  构建 NiuMa Windows CEF Shell（Layer 3）；可选复制 web/dist。
.NOTES
  进度信息走 Write-Host；返回值仅为 niuma.exe 绝对路径（供调用方捕获）。
  矩阵产物：build/shell-<platform>-<arch>/<Configuration>/niuma.exe
#>
param(
    [ValidateSet('windows')]
    [string]$Platform = 'windows',

    [ValidateSet('x64', 'arm64')]
    [string]$Arch = 'x64',

    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [switch]$SkipWebBuild,
    [switch]$SkipServices
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ge 6) {
    $PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
}

$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
. (Join-Path $Root 'scripts\shared\lib\matrix.ps1')
. (Join-Path $Root 'scripts\shared\lib\version.ps1')

Invoke-EmitBuildInfo -RepoRoot $Root | Out-Null
$cmakeVersionArgs = Get-CMakeVersionArgs -RepoRoot $Root

$CefRoot = Join-Path $Root 'third_party/cef'
$BuildDir = Get-ShellBuildDir -RepoRoot $Root -Platform $Platform -Arch $Arch
$ShellDir = Join-Path $Root 'shell'
$Exe = Get-ShellExePath -RepoRoot $Root -Platform $Platform -Arch $Arch -Configuration $Configuration
$StageServicesScript = Join-Path $Root 'scripts\shared\package\stage-services.ps1'
$GenerateIconScript = Join-Path $Root 'scripts\platforms\windows\build\generate-app-icon.ps1'
$cmakeArch = if ($Arch -eq 'arm64') { 'ARM64' } else { 'x64' }

function Write-Step {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Invoke-LoggedCommand {
    param(
        [string]$Label,
        [scriptblock]$Command
    )
    if ($Label) {
        Write-Step $Label
    }
    $prevErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Command 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                $text = $_.ToString()
                if ($text -and $text -notmatch '^System\.Management\.Automation\.RemoteException') {
                    Write-Host $text -ForegroundColor Yellow
                }
            } elseif ($_ -and $_ -notmatch '^System\.Management\.Automation\.RemoteException') {
                Write-Host $_
            }
        }
    } finally {
        $ErrorActionPreference = $prevErrorAction
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $Label"
    }
}

function Find-CMake {
    $cmd = Get-Command cmake -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        "${env:ProgramFiles}\CMake\bin\cmake.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    return $null
}

function Find-VsInstance {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) { return $null }
    $path = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($path) { return $path.Trim() }
    return $null
}

function Find-VsGenerator {
    $cmake = Find-CMake
    if (-not $cmake) { return $null }
    $help = & $cmake --help 2>&1 | Out-String
    foreach ($gen in @(
            'Visual Studio 17 2022',
            'Visual Studio 18 2026',
            'Visual Studio 16 2019'
        )) {
        if ($help -match [regex]::Escape($gen)) { return $gen }
    }
    return $null
}

function Remove-StaleShellResource {
    param([string]$Config)
    $ico = Join-Path $ShellDir 'resources/app.ico'
    if (-not (Test-Path $ico)) { return }
    $icoTime = (Get-Item $ico).LastWriteTime
    $resources = @(
        (Join-Path $BuildDir "niuma.dir/$Config/niuma.res")
        (Join-Path $BuildDir "$Config/niuma.res")
    )
    foreach ($res in $resources) {
        if ((Test-Path $res) -and (Get-Item $res).LastWriteTime -lt $icoTime) {
            Remove-Item $res -Force -ErrorAction SilentlyContinue
            Write-Host "    removed stale resource: $res" -ForegroundColor Gray
        }
    }
}

if (-not (Test-Path (Join-Path $CefRoot 'CMakeLists.txt'))) {
    throw "CEF not found at $CefRoot. Run: pnpm setup:desktop"
}

Write-Step "==> generate app icon ($Platform-$Arch)"
& $GenerateIconScript
if (-not $?) {
    throw 'generate-app-icon failed'
}

Remove-StaleShellResource -Config $Configuration

$cmake = Find-CMake
if (-not $cmake) {
    throw 'cmake not found. Install: winget install Kitware.CMake'
}

if (-not $SkipWebBuild) {
    Push-Location $Root
    try {
        Invoke-LoggedCommand '==> build:web' { pnpm build:web }
    } finally {
        Pop-Location
    }
} else {
    Write-Host '==> skip build:web (hot reload)' -ForegroundColor Gray
}

$generator = Find-VsGenerator
$vsInstance = Find-VsInstance
if (-not $generator -or -not $vsInstance) {
    throw 'MSVC not found. Run: pnpm setup:desktop (installs C++ Build Tools)'
}

$CefRootForward = ($CefRoot -replace '\\', '/')

Write-Step "==> cmake configure ($generator, $Platform-$Arch)"
Write-Host "    instance: $vsInstance" -ForegroundColor Gray
Write-Host "    build dir: $BuildDir" -ForegroundColor Gray
$cacheFile = Join-Path $BuildDir 'CMakeCache.txt'
$needsReconfigure = -not (Test-Path $cacheFile)
if (-not $needsReconfigure) {
    $vcxproj = Join-Path $BuildDir 'niuma.vcxproj'
    if (Test-Path $vcxproj) {
        $projText = Get-Content $vcxproj -Raw
        if ($projText -match 'copy_if_different [^\s]+/libcef\.dll /libcef\.dll') {
            Write-Host '    stale CMake cache (CEF copy paths) — reconfiguring' -ForegroundColor Yellow
            $needsReconfigure = $true
        }
    }
}
if ($needsReconfigure) {
    $prevErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $cmake -B $BuildDir -S $ShellDir -G $generator -A $cmakeArch `
            -DCEF_ROOT="$CefRootForward" `
            -DCMAKE_GENERATOR_INSTANCE="$vsInstance" `
            @cmakeVersionArgs 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                $text = $_.ToString()
                if ($text -and $text -notmatch '^System\.Management\.Automation\.RemoteException') {
                    Write-Host $text -ForegroundColor Yellow
                }
            } elseif ($_ -and $_ -notmatch '^System\.Management\.Automation\.RemoteException') {
                Write-Host $_
            }
        }
    } finally {
        $ErrorActionPreference = $prevErrorAction
    }
    if ($LASTEXITCODE -ne 0) { throw 'cmake configure failed' }
} else {
    Write-Host '    refreshing version defines in CMake cache' -ForegroundColor Gray
    & $cmake -B $BuildDir -S $ShellDir @cmakeVersionArgs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'cmake version refresh failed' }
}

Invoke-LoggedCommand "==> cmake build $Configuration" {
    & $cmake --build $BuildDir --config $Configuration
}

if (-not (Test-Path $Exe)) {
    throw "niuma.exe not found at $Exe"
}

$CefDll = Join-Path (Split-Path $Exe) 'libcef.dll'
if (-not (Test-Path $CefDll)) {
    throw "libcef.dll missing next to niuma.exe. Delete $BuildDir and run: pnpm build:shell"
}

$installDir = Split-Path $Exe
if (-not $SkipServices) {
    & $StageServicesScript -InstallDir $installDir -Platform $Platform -Arch $Arch -Configuration $Configuration
} else {
    Write-Host '==> skip stage-services (SkipServices)' -ForegroundColor Gray
}

Sync-LegacyShellBuild -RepoRoot $Root -Platform $Platform -Arch $Arch -Configuration $Configuration

Write-Host "Built: $Exe" -ForegroundColor Green
Write-Output $Exe
